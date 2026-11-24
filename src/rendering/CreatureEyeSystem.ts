import * as THREE from 'three';
import { TANK } from '../core/config';
import {
  clamp,
  clampToTankRadius,
  getSeabedHeight,
  isFiniteVec3,
  safeNormalize,
  safeRatio,
} from '../core/math';
import type { AnimalGenome } from '../genetics/types';
import type { SimulationEngine } from '../simulation/SimulationEngine';
import type { AnimalEntity, CorpseEntity, Entity } from '../simulation/types';

export type EyeViewMode = 'off' | 'pip' | 'fullscreen';
export type EyeOpticsMode = 'biological' | 'natural';

export interface VisionProfile {
  label: string;
  fov: number;
  tint: string;
  vig: string;
  iris: string | null;
  contrast: number;
  sat: number;
  bri: number;
  hex: boolean;
  brackets: boolean;
}

export interface PerceptionMarker {
  worldPos: THREE.Vector3;
  yOff: number;
  dist: number;
  category: 'threat' | 'prey' | 'mate' | 'kin' | 'flora';
  label: string;
  isPrimary: boolean;
}

export class CreatureEyeSystem {
  readonly camera: THREE.PerspectiveCamera;
  mode: EyeViewMode = 'off';
  opticsMode: EyeOpticsMode = 'biological';
  sensoryEnabled = true;

  private readonly camPos = new THREE.Vector3();
  private readonly camQuat = new THREE.Quaternion();
  private initialized = false;

  readonly perceptionCache: PerceptionMarker[] = [];

  private readonly _eyeLocal = new THREE.Vector3();
  private readonly _eyeWorld = new THREE.Vector3();
  private readonly _eyeFwd = new THREE.Vector3();
  private readonly _eyeUp = new THREE.Vector3();
  private readonly _eyeDir = new THREE.Vector3();
  private readonly _eyeQuat = new THREE.Quaternion();
  private readonly _camMat = new THREE.Matrix4();
  private readonly _v1 = new THREE.Vector3();
  private readonly _v2 = new THREE.Vector3();
  private readonly _v3 = new THREE.Vector3();
  private readonly _v4 = new THREE.Vector3();
  private readonly _v5 = new THREE.Vector3();
  private readonly _proj = new THREE.Vector3();
  private readonly _qAni: AnimalEntity[] = [];
  private readonly _qPl: any[] = [];
  private readonly _qFood: Entity[] = [];

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(90, aspect, 0.04, 75);
  }

  resetSmoothing(): void {
    this.initialized = false;
  }

  canUseEyeView(entity: Entity | null): entity is AnimalEntity | CorpseEntity {
    return !!(
      entity &&
      entity.alive &&
      (entity.kind === 'animal' || entity.kind === 'corpse') &&
      isFiniteVec3(entity.position)
    );
  }

  getVisionProfile(genome: AnimalGenome | null | undefined): VisionProfile {
    if (!genome) {
      return {
        label: 'Standard Aquatic',
        fov: 90,
        tint: 'rgba(60,210,240,0.04)',
        vig: 'rgba(4,16,26,0.52)',
        iris: null,
        contrast: 1.05,
        sat: 1.08,
        bri: 1.02,
        hex: false,
        brackets: false,
      };
    }
    if (genome.bodyPlan === 'radial_medusa') {
      return {
        label: 'Radial Ocelli',
        fov: 122,
        tint: 'rgba(72,218,255,0.08)',
        vig: 'rgba(24,10,58,0.72)',
        iris: 'rgba(135,244,255,0.28)',
        contrast: 1.08,
        sat: 1.3,
        bri: 1.1,
        hex: false,
        brackets: false,
      };
    }
    if (genome.bodyPlan === 'armored_trilopod') {
      return {
        label: 'Compound Ommatidia',
        fov: 98,
        tint: 'rgba(218,184,96,0.055)',
        vig: 'rgba(7,15,20,0.68)',
        iris: 'rgba(225,198,124,0.16)',
        contrast: 1.11,
        sat: 1.06,
        bri: 1.03,
        hex: true,
        brackets: false,
      };
    }
    if (genome.sensoryOrgan === 'electroreception' || genome.functionalPart === 'electro_organs') {
      return {
        label: 'Ampullary Electro-Optic',
        fov: 106,
        tint: 'rgba(46,232,255,0.085)',
        vig: 'rgba(5,14,34,0.68)',
        iris: 'rgba(72,244,255,0.26)',
        contrast: 1.2,
        sat: 1.24,
        bri: 1.08,
        hex: false,
        brackets: true,
      };
    }
    if (genome.sensoryOrgan === 'thermal_pits') {
      return {
        label: 'Thermal Pit Infrared',
        fov: 92,
        tint: 'rgba(255,96,56,0.08)',
        vig: 'rgba(26,6,14,0.66)',
        iris: 'rgba(255,148,74,0.24)',
        contrast: 1.22,
        sat: 1.28,
        bri: 1.06,
        hex: false,
        brackets: true,
      };
    }
    if (genome.diet === 'Carnivore') {
      return {
        label: 'Binocular Predatory',
        fov: 78,
        tint: 'rgba(255,134,82,0.055)',
        vig: 'rgba(18,5,10,0.64)',
        iris: 'rgba(255,148,98,0.18)',
        contrast: 1.18,
        sat: 1.18,
        bri: 1.05,
        hex: false,
        brackets: true,
      };
    }
    if (genome.diet === 'Herbivore' || genome.diet === 'Filter_Feeder') {
      return {
        label: 'Panoramic Lateral',
        fov: 114,
        tint: 'rgba(54,224,188,0.048)',
        vig: 'rgba(4,22,26,0.55)',
        iris: 'rgba(92,238,210,0.16)',
        contrast: 1.04,
        sat: 1.14,
        bri: 1.05,
        hex: false,
        brackets: false,
      };
    }
    return {
      label: 'Adaptive Binocular',
      fov: 94,
      tint: 'rgba(85,214,244,0.045)',
      vig: 'rgba(5,18,28,0.54)',
      iris: 'rgba(120,228,255,0.14)',
      contrast: 1.08,
      sat: 1.12,
      bri: 1.03,
      hex: false,
      brackets: false,
    };
  }

  getCorpseFade(entity: AnimalEntity | CorpseEntity): number {
    if (entity.kind !== 'corpse') return 0;
    if (entity.phase === 'dying') return clamp(safeRatio(entity.dyingAge, entity.dyingDuration), 0, 1) * 0.25;
    if (entity.phase === 'sinking_corpse') return 0.25 + clamp(entity.corpseAge / 12.0, 0, 1) * 0.3;
    if (entity.phase === 'decomposing') return 0.55 + (1.0 - safeRatio(entity.nutrients, entity.maxNutrients)) * 0.25;
    return 0.8 + clamp(safeRatio(entity.dissolveAge, entity.dissolveDuration), 0, 1) * 0.2;
  }

  getCssFilter(entity: AnimalEntity | CorpseEntity): string {
    const prof = this.getVisionProfile(entity.genome);
    const fade = this.getCorpseFade(entity);
    const satM = Math.max(0.08, 1.0 - fade * 0.92);
    const briM = Math.max(0.2, 1.0 - fade * 0.76);
    if (this.opticsMode === 'biological') {
      return `contrast(${prof.contrast.toFixed(2)}) saturate(${(prof.sat * satM).toFixed(2)}) brightness(${(prof.bri * briM).toFixed(2)})`;
    }
    if (fade > 0.01) {
      return `saturate(${satM.toFixed(2)}) brightness(${briM.toFixed(2)})`;
    }
    return '';
  }

  updateCamera(
    sim: SimulationEngine,
    entity: AnimalEntity | CorpseEntity,
    realDt: number
  ): void {
    const g = entity.genome;
    const sc = Math.max(0.1, entity.scale || g.sizeScale);

    let ly = 0.10;
    let lz = 0.58;
    if (g.bodyPlan === 'segmented_eel') {
      ly = 0.08;
      lz = 0.76;
    } else if (g.bodyPlan === 'radial_medusa') {
      ly = 0.02;
      lz = 0.48;
    } else if (g.bodyPlan === 'armored_trilopod') {
      ly = 0.14;
      lz = 0.56;
    } else if (g.bodyPlan === 'winged_manta') {
      ly = 0.09;
      lz = 0.58;
    }
    if (g.appendage === 'stalked_eyes' || g.functionalPart === 'stalked_eyes') ly += 0.22;

    this._eyeLocal.set(0, ly * sc, lz * sc);
    this._eyeWorld.copy(this._eyeLocal).applyQuaternion(entity.quaternion).add(entity.position);
    clampToTankRadius(this._eyeWorld, 0.28);
    this._eyeWorld.y = clamp(
      this._eyeWorld.y,
      getSeabedHeight(this._eyeWorld.x, this._eyeWorld.z) + 0.12,
      TANK.waterY - 0.18
    );

    this._eyeFwd.set(0, 0, 1).applyQuaternion(entity.quaternion);
    this._eyeUp.set(0, 1, 0).applyQuaternion(entity.quaternion);
    if (!safeNormalize(this._eyeFwd)) this._eyeFwd.set(0, 0, 1);
    if (!safeNormalize(this._eyeUp)) this._eyeUp.set(0, 1, 0);

    this._eyeDir.copy(this._eyeFwd);
    if (
      entity.kind === 'animal' &&
      entity.activeTarget &&
      entity.activeTarget.entity.alive &&
      isFiniteVec3(entity.activeTarget.entity.position)
    ) {
      const t = entity.activeTarget.entity;
      this._v1.copy(t.position);
      if (t.kind === 'plant') this._v1.y += t.genome.maxHeight * t.growth * 0.45;
      this._v1.sub(this._eyeWorld);
      if (safeNormalize(this._v1)) {
        const dot = this._eyeFwd.dot(this._v1);
        if (entity.activeTarget.role === 'threat' && dot > -0.3) {
          this._eyeDir.lerp(this._v1, 0.14);
          safeNormalize(this._eyeDir);
        } else if (dot > 0.35) {
          this._eyeDir.lerp(this._v1, 0.26);
          safeNormalize(this._eyeDir);
        }
      }
    }

    const lookPt = this._v2.copy(this._eyeWorld).add(this._eyeDir);
    this._camMat.lookAt(this._eyeWorld, lookPt, this._eyeUp);
    this._eyeQuat.setFromRotationMatrix(this._camMat);

    if (!this.initialized || !isFiniteVec3(this.camPos)) {
      this.camPos.copy(this._eyeWorld);
      this.camQuat.copy(this._eyeQuat);
      this.initialized = true;
    } else {
      this.camPos.lerp(this._eyeWorld, 1.0 - Math.exp(-15.0 * realDt));
      this.camQuat.slerp(this._eyeQuat, 1.0 - Math.exp(-8.5 * realDt));
    }

    this.camera.position.copy(this.camPos);
    this.camera.quaternion.copy(this.camQuat);

    const prof = this.getVisionProfile(g);
    const targetFov = this.opticsMode === 'biological' ? prof.fov : 82;
    if (Math.abs(this.camera.fov - targetFov) > 0.05) {
      this.camera.fov = THREE.MathUtils.lerp(this.camera.fov, targetFov, clamp(realDt * 8.0, 0, 1));
      this.camera.updateProjectionMatrix();
    }
    this.camera.updateMatrixWorld(true);
    this.gatherPerception(sim, entity);
  }

  private gatherPerception(sim: SimulationEngine, e: AnimalEntity | CorpseEntity): void {
    const list = this.perceptionCache;
    list.length = 0;
    if (e.kind !== 'animal' || !e.alive || !isFiniteVec3(e.position)) return;

    const g = e.genome;
    const pos = e.position;
    const range = g.visionRange * 1.15;
    const activeEnt = e.activeTarget ? e.activeTarget.entity : null;

    const nearAni = sim.animalGrid.query(pos.x, pos.y, pos.z, range, this._qAni);
    for (let i = 0; i < nearAni.length; i++) {
      const o = nearAni[i];
      if (o === e || !o.alive || !isFiniteVec3(o.position)) continue;
      const dist = pos.distanceTo(o.position);
      if (!Number.isFinite(dist) || dist < 0.05) continue;

      const same = o.genome.speciesId === g.speciesId;
      let cat: PerceptionMarker['category'] | null = null;
      let lbl = '';
      if (same) {
        const isMate =
          e.lifeStage === 'adult' && o.lifeStage === 'adult' && e.energy > 72 && o.energy > 65;
        cat = isMate ? 'mate' : 'kin';
        lbl = isMate ? 'MATE' : 'KIN';
      } else {
        const pred =
          e.lifeStage === 'spawn'
            ? o.scale > e.scale * 1.32
            : e.lifeStage === 'larva' || e.lifeStage === 'instar'
            ? o.scale > e.scale * 1.38 ||
              ((o.genome.diet === 'Carnivore' || o.genome.diet === 'Omnivore') && o.scale > e.scale * 0.95)
            : (o.genome.diet === 'Carnivore' ||
                (o.genome.diet === 'Omnivore' && o.scale > e.scale * 1.05)) &&
              o.scale > e.scale * 0.72 &&
              o.lifeStage !== 'spawn';
        const maxPreyRatio = e.lifeStage === 'adult' ? 1.32 : e.lifeStage === 'spawn' ? 0 : 0.88;
        const hunt =
          maxPreyRatio > 0 &&
          ((g.diet === 'Carnivore' && o.scale <= e.scale * maxPreyRatio) ||
            (g.diet === 'Omnivore' && e.energy < 85 && o.scale <= e.scale * Math.min(0.92, maxPreyRatio)));
        if (pred) {
          cat = 'threat';
          lbl = 'THREAT';
        } else if (hunt) {
          cat = 'prey';
          lbl = 'PREY';
        } else if (
          e.lifeStage === 'adult' &&
          o.lifeStage === 'adult' &&
          g.social === 'Territorial' &&
          dist < 3.6 &&
          o.scale < e.scale * 1.25
        ) {
          cat = 'threat';
          lbl = 'RIVAL';
        }
      }
      if (cat) {
        list.push({ worldPos: o.position, yOff: 0, dist, category: cat, label: lbl, isPrimary: o === activeEnt });
      }
    }

    if (g.diet === 'Herbivore' || g.diet === 'Omnivore') {
      const nearPl = sim.plantGrid.query(pos.x, pos.y, pos.z, range, this._qPl);
      for (let i = 0; i < nearPl.length; i++) {
        const pl = nearPl[i];
        if (!pl.alive || pl.wilting || pl.biomass < 16 || !isFiniteVec3(pl.position)) continue;
        const dist = pos.distanceTo(pl.position);
        if (!Number.isFinite(dist)) continue;
        const trap = pl.genome.metabolism === 'Carnivorous_Flora';
        list.push({
          worldPos: pl.position,
          yOff: pl.genome.maxHeight * pl.growth * 0.45,
          dist,
          category: trap ? 'threat' : 'flora',
          label: trap ? 'TRAP' : 'FLORA',
          isPrimary: pl === activeEnt,
        });
      }
    }

    const nearFood = sim.foodGrid.query(pos.x, pos.y, pos.z, range, this._qFood);
    for (let i = 0; i < nearFood.length; i++) {
      const item = nearFood[i];
      if (!item.alive || !isFiniteVec3(item.position)) continue;
      let wants = false;
      if (item.kind === 'pellet') {
        if (item.origin === 'pellet') wants = true;
        else if (item.origin === 'flesh') {
          wants = g.diet === 'Scavenger' || g.diet === 'Carnivore' || g.diet === 'Omnivore';
        } else {
          wants =
            g.diet === 'Herbivore' ||
            g.diet === 'Omnivore' ||
            g.diet === 'Filter_Feeder' ||
            (g.diet === 'Scavenger' && item.phase !== 'sinking');
        }
      } else {
        wants =
          (g.diet === 'Scavenger' && item.kind === 'corpse') ||
          (g.diet === 'Omnivore' &&
            (item.kind === 'corpse' || item.kind === 'egg' || item.kind === 'propagule')) ||
          ((g.diet === 'Herbivore' || g.diet === 'Filter_Feeder') && item.kind === 'propagule') ||
          (g.diet === 'Carnivore' &&
            ((item.kind === 'corpse' && e.energy < 95) || (item.kind === 'egg' && e.energy < 65)));
      }
      if (!wants) continue;
      const dist = pos.distanceTo(item.position);
      if (!Number.isFinite(dist)) continue;
      const label =
        item.kind === 'corpse'
          ? 'CARRION'
          : item.kind === 'pellet'
          ? item.origin === 'flesh'
            ? 'FLESH'
            : item.origin === 'flora'
            ? 'SHRED'
            : 'PELLET'
          : 'FOOD';
      const category =
        item.kind === 'corpse' || (item.kind === 'pellet' && item.origin === 'flesh')
          ? 'prey'
          : 'flora';
      list.push({
        worldPos: item.position,
        yOff: 0.08,
        dist,
        category,
        label,
        isPrimary: item === activeEnt,
      });
    }

    list.sort((a, b) => (b.isPrimary ? 1 : 0) - (a.isPrimary ? 1 : 0) || a.dist - b.dist);
    if (list.length > 16) list.length = 16;
  }

  private drawHexOmmatidia(ctx: CanvasRenderingContext2D, w: number, h: number, isPiP: boolean): void {
    const r = isPiP ? 12 : 23;
    const dx = r * 1.5;
    const dy = r * 1.732;
    const cx = w * 0.5;
    const cy = h * 0.5;
    const maxR = Math.max(1, Math.hypot(cx, cy));
    ctx.save();
    ctx.lineWidth = isPiP ? 0.8 : 1.05;
    for (let col = -1; col * dx < w + r * 2; col++) {
      const x = col * dx;
      const yOff = col & 1 ? dy * 0.5 : 0;
      for (let row = -1; row * dy < h + r * 2; row++) {
        const y = row * dy + yOff;
        const nd = Math.hypot(x - cx, y - cy) / maxR;
        if (nd < 0.56) continue;
        const alpha = clamp((nd - 0.56) * 0.62, 0, 0.28);
        ctx.strokeStyle = `rgba(186, 234, 224, ${alpha.toFixed(3)})`;
        ctx.beginPath();
        for (let k = 0; k < 6; k++) {
          const ang = (Math.PI / 3) * k;
          const px = x + Math.cos(ang) * r * 0.94;
          const py = y + Math.sin(ang) * r * 0.94;
          if (k === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  renderOverlay(
    canvas: HTMLCanvasElement | null,
    entity: AnimalEntity | CorpseEntity,
    time: number,
    isPiP: boolean
  ): void {
    if (!canvas) return;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!Number.isFinite(w) || !Number.isFinite(h) || w < 4 || h < 4) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const tw = Math.max(1, Math.round(w * dpr));
    const th = Math.max(1, Math.round(h * dpr));
    if (canvas.width !== tw || canvas.height !== th) {
      canvas.width = tw;
      canvas.height = th;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const prof = this.getVisionProfile(entity.genome);
    const outerR = Math.max(2, Math.hypot(w * 0.5, h * 0.5));

    // 1. Biological Optics Overlay
    if (this.opticsMode === 'biological') {
      ctx.fillStyle = prof.tint;
      ctx.fillRect(0, 0, w, h);

      const vig = ctx.createRadialGradient(w * 0.5, h * 0.5, outerR * 0.36, w * 0.5, h * 0.5, outerR * 1.02);
      vig.addColorStop(0.0, 'rgba(0,0,0,0)');
      vig.addColorStop(0.65, 'rgba(0,0,0,0.08)');
      vig.addColorStop(1.0, prof.vig);
      ctx.fillStyle = vig;
      ctx.fillRect(0, 0, w, h);

      if (prof.iris) {
        const ir = ctx.createRadialGradient(w * 0.5, h * 0.5, outerR * 0.6, w * 0.5, h * 0.5, outerR * 0.96);
        ir.addColorStop(0.0, 'rgba(0,0,0,0)');
        ir.addColorStop(0.55, prof.iris);
        ir.addColorStop(1.0, 'rgba(0,0,0,0)');
        ctx.fillStyle = ir;
        ctx.fillRect(0, 0, w, h);
      }

      if (prof.hex) this.drawHexOmmatidia(ctx, w, h, isPiP);

      if (prof.brackets) {
        const bw = w * (isPiP ? 0.19 : 0.14);
        const bh = h * (isPiP ? 0.22 : 0.18);
        const len = isPiP ? 9 : 17;
        ctx.strokeStyle = 'rgba(255, 170, 120, 0.26)';
        ctx.lineWidth = isPiP ? 1.1 : 1.5;
        ctx.beginPath();
        ctx.moveTo(w * 0.5 - bw + len, h * 0.5 - bh);
        ctx.lineTo(w * 0.5 - bw, h * 0.5 - bh);
        ctx.lineTo(w * 0.5 - bw, h * 0.5 + bh);
        ctx.lineTo(w * 0.5 - bw + len, h * 0.5 + bh);
        ctx.moveTo(w * 0.5 + bw - len, h * 0.5 - bh);
        ctx.lineTo(w * 0.5 + bw, h * 0.5 - bh);
        ctx.lineTo(w * 0.5 + bw, h * 0.5 + bh);
        ctx.lineTo(w * 0.5 + bw - len, h * 0.5 + bh);
        ctx.stroke();
      }
    }

    // 2. Live 2D AI Sensory Perception HUD
    if (this.sensoryEnabled && entity.kind === 'animal' && entity.alive) {
      this.camera.updateMatrixWorld(true);
      const camFwd = this._v3.set(0, 0, -1).applyQuaternion(this.camera.quaternion);
      const pad = isPiP ? 14 : 28;
      ctx.font = isPiP ? '600 8px "JetBrains Mono", monospace' : '600 10px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';

      for (let i = 0; i < this.perceptionCache.length; i++) {
        const item = this.perceptionCache[i];
        if (!item || !isFiniteVec3(item.worldPos)) continue;

        this._v4.copy(item.worldPos);
        this._v4.y += item.yOff;
        const toEnt = this._v5.subVectors(this._v4, this.camera.position);
        const inFront = toEnt.dot(camFwd) > 0.0;

        this._proj.copy(this._v4).project(this.camera);
        if (!isFiniteVec3(this._proj)) continue;

        let sx = (this._proj.x * 0.5 + 0.5) * w;
        let sy = (-this._proj.y * 0.5 + 0.5) * h;
        if (!inFront || this._proj.z > 1.0) {
          sx = w - sx;
          sy = h - sy;
        }
        if (!Number.isFinite(sx) || !Number.isFinite(sy)) continue;

        const onScreen =
          inFront && this._proj.z <= 1.0 && sx >= pad && sx <= w - pad && sy >= pad && sy <= h - pad;
        let stroke = '#34f5a8';
        let fill = 'rgba(52, 245, 168, 0.22)';
        if (item.category === 'threat') {
          stroke = '#ff5468';
          fill = 'rgba(255, 84, 104, 0.28)';
        } else if (item.category === 'prey') {
          stroke = '#ffb84d';
          fill = 'rgba(255, 184, 77, 0.24)';
        } else if (item.category === 'mate' || item.category === 'kin') {
          stroke = '#5cf2ff';
          fill = 'rgba(92, 242, 255, 0.22)';
        }

        if (onScreen) {
          const baseR = clamp((isPiP ? 62 : 120) / (item.dist + 1.8), isPiP ? 7 : 12, isPiP ? 22 : 38);
          const r = baseR * (item.category === 'threat' || item.isPrimary ? 1.0 + Math.sin(time * 7.5 + i) * 0.1 : 1.0);
          ctx.save();
          ctx.strokeStyle = stroke;
          ctx.lineWidth = item.isPrimary ? (isPiP ? 1.6 : 2.1) : isPiP ? 1.0 : 1.3;
          ctx.globalAlpha = item.isPrimary ? 0.94 : clamp(0.84 - item.dist * 0.04, 0.3, 0.82);

          if (item.isPrimary) {
            const segA = time * 1.4;
            for (let s = 0; s < 4; s++) {
              const a0 = segA + s * (Math.PI * 0.5) + 0.18;
              ctx.beginPath();
              ctx.arc(sx, sy, r + (isPiP ? 2.5 : 4), a0, a0 + Math.PI * 0.32);
              ctx.stroke();
            }
          }

          ctx.beginPath();
          ctx.arc(sx, sy, r, 0, Math.PI * 2);
          ctx.stroke();
          ctx.fillStyle = fill;
          ctx.fill();

          if (!isPiP || item.isPrimary || item.category === 'threat' || i < 4) {
            ctx.fillStyle = stroke;
            ctx.fillText(
              isPiP ? `${item.label} ${item.dist.toFixed(0)}m` : `${item.label} · ${item.dist.toFixed(1)}m`,
              sx,
              sy + r + (isPiP ? 9 : 13)
            );
          }
          ctx.restore();
        } else if (item.category === 'threat') {
          const ang = Math.atan2(sy - h * 0.5, sx - w * 0.5);
          const ex = clamp(w * 0.5 + Math.cos(ang) * (w * 0.5 - pad), pad, w - pad);
          const ey = clamp(h * 0.5 + Math.sin(ang) * (h * 0.5 - pad), pad, h - pad);
          const cs = isPiP ? 6 : 10;
          ctx.save();
          ctx.translate(ex, ey);
          ctx.rotate(ang);
          ctx.strokeStyle = '#ff5468';
          ctx.fillStyle = 'rgba(255, 84, 104, 0.38)';
          ctx.lineWidth = isPiP ? 1.5 : 2.0;
          ctx.globalAlpha = 0.55 + 0.42 * Math.abs(Math.sin(time * 8.0 + i));
          ctx.beginPath();
          ctx.moveTo(cs, 0);
          ctx.lineTo(-cs * 0.75, -cs * 0.75);
          ctx.lineTo(-cs * 0.35, 0);
          ctx.lineTo(-cs * 0.75, cs * 0.75);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
          ctx.restore();
        }
      }
    }

    // 3. Progressive Death / Low-Vitality Darkening Vignette
    const deathFade = this.getCorpseFade(entity);
    const lowHp =
      entity.kind === 'animal' && entity.hp < entity.maxHp * 0.3
        ? (1.0 - safeRatio(entity.hp, entity.maxHp * 0.3)) * 0.35
        : 0;
    const fade = clamp(Math.max(deathFade, lowHp), 0, 1);
    if (fade > 0.01) {
      const inR = Math.max(1, outerR * Math.max(0.08, 0.55 - fade * 0.42));
      const dv = ctx.createRadialGradient(w * 0.5, h * 0.5, inR, w * 0.5, h * 0.5, outerR);
      dv.addColorStop(0.0, `rgba(2, 6, 12, ${(deathFade * 0.58).toFixed(3)})`);
      dv.addColorStop(1.0, `rgba(1, 4, 9, ${clamp(fade * 1.05, 0, 0.96).toFixed(3)})`);
      ctx.fillStyle = dv;
      ctx.fillRect(0, 0, w, h);
    }
  }
}
