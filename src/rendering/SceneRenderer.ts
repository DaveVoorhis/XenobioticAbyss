import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TANK } from '../core/config';
import {
  clamp,
  clampXZToTankRadius,
  computeDaylightFactor,
  disableFrustumCulling,
  getSeabedHeight,
  isFiniteVec3,
} from '../core/math';
import type { SimulationEngine } from '../simulation/SimulationEngine';
import type { Entity } from '../simulation/types';
import {
  createAnimalRig,
  updateAnimalRig,
  updateCorpseRig,
  type ArticulatedAnimalRig,
} from './AnimalMeshBuilder';
import { CreatureEyeSystem } from './CreatureEyeSystem';
import { buildAquariumEnvironment, type EnvironmentRig } from './EnvironmentBuilder';
import { getGeometryLibrary } from './GeometryLibrary';
import { InstancedFxRenderer } from './InstancedFxRenderer';
import { createPlantRig, updatePlantRig, type PlantRig } from './PlantMeshBuilder';
import {
  createSharedUniforms,
  enhanceMaterialWithUnderwaterCaustics,
  type SharedShaderUniforms,
} from './Shaders';
import { getProceduralTextures, hasCanvasSupport } from './TextureLibrary';
import { UnderwaterPostFX } from './UnderwaterPostFX';

interface SimpleRig {
  group: THREE.Group;
  materials: THREE.Material[];
  embryoMesh?: THREE.Mesh;
}

/**
 * Generates a lightweight procedural underwater IBL environment cubemap via PMREMGenerator
 * so wet animal scales, iridescence, glassy eye corneas, chitin carapaces, and translucent
 * flora petals reflect realistic caustic overhead highlights and deep turquoise water tones.
 */
function buildUnderwaterEnvMap(renderer: THREE.WebGLRenderer): THREE.Texture {
  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();

  const envScene = new THREE.Scene();
  const domeGeo = new THREE.SphereGeometry(20, 48, 32);
  const domeMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        float y = vDir.y;
        vec3 nadir = vec3(0.055, 0.105, 0.125); // Subtle warm carbonate seabed bounce
        vec3 deepWater = vec3(0.025, 0.14, 0.24);
        vec3 horizon = vec3(0.065, 0.34, 0.48);
        vec3 zenith = vec3(0.42, 0.88, 0.98);
        vec3 snellSky = vec3(0.95, 1.15, 1.22);
        vec3 col = y < 0.0
          ? mix(horizon, mix(deepWater, nadir, smoothstep(0.25, 0.95, -y)), pow(-y, 0.58))
          : mix(horizon, zenith, pow(y, 0.55));

        // Snell's Window bright sky aperture overhead + crisp refracted solar catchlight
        float snell = smoothstep(0.62, 0.76, y);
        col = mix(col, snellSky, snell * 0.68);
        vec3 sunDir = normalize(vec3(0.30, 0.91, 0.27));
        float sunDot = max(dot(normalize(vDir), sunDir), 0.0);
        col += vec3(2.8, 3.1, 3.0) * pow(sunDot, 48.0);
        col += vec3(0.55, 0.92, 1.0) * pow(sunDot, 6.0) * 0.45;

        // Layered overhead chromatic caustic ripples for gleaming wet scale & cornea highlights
        if (y > 0.12) {
          float c1 = sin(vDir.x * 11.0 + vDir.z * 8.0) * sin(vDir.z * 13.0 - vDir.x * 7.0);
          float c2 = sin(vDir.x * 19.0 - vDir.z * 15.0 + 1.4) * sin(vDir.z * 17.0 + vDir.x * 11.0);
          float caustic = (smoothstep(0.32, 0.95, c1) * 0.75 + smoothstep(0.45, 0.98, c2) * 0.55)
            * smoothstep(0.12, 0.72, y);
          col += vec3(0.72, 1.05, 1.15) * caustic * 1.15;
        }
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
  envScene.add(new THREE.Mesh(domeGeo, domeMat));

  const rt = pmrem.fromScene(envScene, 0.04);
  domeGeo.dispose();
  domeMat.dispose();
  pmrem.dispose();
  return rt.texture;
}

export class SceneRenderer {
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: THREE.WebGLRenderer;
  readonly controls: OrbitControls;
  readonly sharedUniforms: SharedShaderUniforms;
  readonly envRig: EnvironmentRig;
  readonly fx: InstancedFxRenderer;
  readonly eyeSystem: CreatureEyeSystem;
  private readonly postFx: UnderwaterPostFX;

  selectedEntity: Entity | null = null;
  followCam = false;
  feedMode = false;

  private camLerpPos: THREE.Vector3 | null = null;
  private camLerpTarget: THREE.Vector3 | null = null;

  private readonly sim: SimulationEngine;
  private readonly animalRigs = new Map<number, ArticulatedAnimalRig>();
  private readonly plantRigs = new Map<number, PlantRig>();
  private readonly simpleRigs = new Map<number, SimpleRig>();
  private readonly selectionRing: THREE.Mesh;

  private readonly pointerDownPos = new THREE.Vector2();
  private readonly _ray = new THREE.Raycaster();
  private readonly _ndc = new THREE.Vector2();
  private readonly _v1 = new THREE.Vector3();
  private readonly _waterPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -TANK.waterY);
  private readonly _midPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -4.5);
  private readonly _planeHit = new THREE.Vector3();

  constructor(container: HTMLElement, sim: SimulationEngine) {
    this.sim = sim;
    const w = Math.max(1, window.innerWidth);
    const h = Math.max(1, window.innerHeight);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x031726);
    this.scene.fog = new THREE.FogExp2(0x041e30, 0.032);

    // Wide-angle scuba diver dome-port lens immersed inside the water column
    this.camera = new THREE.PerspectiveCamera(56, w / h, 0.12, 160);
    this.camera.position.set(0, 4.9, 13.8);

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.14;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(w, h);
    container.appendChild(this.renderer.domElement);

    // Procedural Underwater IBL Environment Map for realistic wet specular & iridescent realism
    this.scene.environment = buildUnderwaterEnvMap(this.renderer);
    this.scene.environmentIntensity = 0.94;

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.065;
    this.controls.target.set(0, 5.15, -1.5);
    this.controls.minDistance = 1.8;
    this.controls.maxDistance = 23.0;
    this.controls.maxPolarAngle = Math.PI * 0.72;
    this.controls.minPolarAngle = 0.18;

    this.sharedUniforms = createSharedUniforms();
    this.envRig = buildAquariumEnvironment(this.scene, this.sharedUniforms);
    this.fx = new InstancedFxRenderer(this.scene, this.sharedUniforms);
    this.eyeSystem = new CreatureEyeSystem(w / h);
    this.postFx = new UnderwaterPostFX(this.renderer, this.sharedUniforms, w, h);

    // Selection Halo Ring
    const rGeo = new THREE.RingGeometry(0.45, 0.55, 40);
    rGeo.rotateX(-Math.PI * 0.5);
    this.selectionRing = new THREE.Mesh(
      rGeo,
      new THREE.MeshBasicMaterial({
        color: 0x5ef7ff,
        transparent: true,
        opacity: 0.88,
        side: THREE.DoubleSide,
        depthWrite: false,
      })
    );
    this.selectionRing.visible = false;
    this.selectionRing.frustumCulled = false;
    this.scene.add(this.selectionRing);

    this.bindEvents();
    this.bindPointer();
    window.addEventListener('resize', () => this.onResize());
  }

  private bindEvents(): void {
    const ev = this.sim.events;

    ev.on('fx:burst', ({ position, colorHex, count, speed }) => {
      this.fx.spawnBurst(position, colorHex, count, speed);
    });

    ev.on('fx:fragments', ({ position, colorHex, accentHex, kind, count, speed, suctionTarget, ejectDir }) => {
      this.fx.spawnFragments(position, colorHex, kind, count, speed, accentHex, suctionTarget, ejectDir);
    });

    ev.on('fx:shockwave', ({ position, colorHex, maxScale }) => {
      this.fx.spawnShockwave(position, colorHex, maxScale);
    });

    ev.on('ecosystem:reset', () => {
      this.fx.clear();
    });

    ev.on('entity:spawned', ({ entity }) => {
      this.createRigForEntity(entity);
    });

    ev.on('entity:morphed', ({ from, to }) => {
      // Seamless Animal -> Corpse transition reusing the exact same articulated Three.js mesh group!
      const rig = this.animalRigs.get(from.id);
      if (rig) {
        this.attachEntityRef(rig.group, to);
        for (const m of rig.materials) {
          m.transparent = true;
        }
      }
      if (this.selectedEntity === from) {
        this.selectedEntity = to;
        this.sim.events.emit('selection:changed', { entity: to });
      }
    });

    ev.on('entity:disposed', ({ entity }) => {
      this.disposeRigForEntity(entity);
      if (this.selectedEntity === entity) {
        const wasEye = this.eyeSystem.mode !== 'off';
        this.selectEntity(null);
        if (wasEye) {
          this.sim.events.emit('toast', { message: 'Organism dissolved — returned to tank view' });
        }
      }
    });
  }

  private bindPointer(): void {
    const dom = this.renderer.domElement;
    dom.addEventListener('pointerdown', (e) => {
      this.pointerDownPos.set(e.clientX, e.clientY);
    });
    dom.addEventListener('pointerup', (e) => {
      if (Math.hypot(e.clientX - this.pointerDownPos.x, e.clientY - this.pointerDownPos.y) < 6) {
        this.handleCanvasClick(e.clientX, e.clientY);
      }
    });
  }

  private attachEntityRef(group: THREE.Object3D, entity: Entity): void {
    group.userData.entityRef = entity;
    group.traverse((c) => {
      c.userData.entityRef = entity;
    });
  }

  private createRigForEntity(entity: Entity): void {
    if (entity.kind === 'pellet') return; // Handled by InstancedFxRenderer

    if (entity.kind === 'animal') {
      const rig = createAnimalRig(entity.genome, this.sharedUniforms);
      rig.group.position.copy(entity.position);
      rig.group.quaternion.copy(entity.quaternion);
      rig.group.scale.setScalar(entity.scale);
      this.attachEntityRef(rig.group, entity);
      this.scene.add(rig.group);
      this.animalRigs.set(entity.id, rig);
    } else if (entity.kind === 'plant') {
      const rig = createPlantRig(entity.genome, this.sharedUniforms);
      rig.group.position.copy(entity.position);
      rig.group.quaternion.copy(entity.quaternion);
      rig.group.scale.setScalar(entity.scale);
      this.attachEntityRef(rig.group, entity);
      this.scene.add(rig.group);
      this.plantRigs.set(entity.id, rig);
    } else if (entity.kind === 'egg') {
      // Translucent gelatinous outer egg chorion enclosing a sculpted curled yolk embryo
      const geo = getGeometryLibrary();
      const outerMat = new THREE.MeshPhysicalMaterial({
        color: entity.genome.baseHex,
        roughness: 0.04,
        metalness: 0.0,
        ior: 1.38,
        specularIntensity: 1.0,
        clearcoat: 1.0,
        clearcoatRoughness: 0.03,
        iridescence: 0.62,
        iridescenceIOR: 1.36,
        transparent: true,
        opacity: 0.36,
        depthWrite: true,
      });
      enhanceMaterialWithUnderwaterCaustics(outerMat, this.sharedUniforms, {
        causticStrength: 0.42,
        subsurfaceStrength: 0.58,
        subsurfaceColor: entity.genome.glowHex,
      });
      const embryoMat = new THREE.MeshPhysicalMaterial({
        color: entity.genome.glowHex,
        emissive: new THREE.Color(entity.genome.glowHex),
        emissiveIntensity: 0.72,
        roughness: 0.24,
        clearcoat: 0.55,
        clearcoatRoughness: 0.16,
        sheen: 0.4,
        vertexColors: true,
      });
      enhanceMaterialWithUnderwaterCaustics(embryoMat, this.sharedUniforms, {
        causticStrength: 0.25,
        subsurfaceStrength: 0.42,
        subsurfaceColor: entity.genome.glowHex,
      });
      const group = new THREE.Group();
      const embryoMesh = new THREE.Mesh(geo.eggEmbryo, embryoMat);
      group.add(embryoMesh);
      group.add(new THREE.Mesh(geo.egg, outerMat));
      disableFrustumCulling(group);
      group.position.copy(entity.position);
      this.attachEntityRef(group, entity);
      this.scene.add(group);
      this.simpleRigs.set(entity.id, { group, materials: [outerMat, embryoMat], embryoMesh });
    } else if (entity.kind === 'propagule') {
      const geo = getGeometryLibrary();
      const tex = hasCanvasSupport() ? getProceduralTextures() : null;
      const mat = new THREE.MeshPhysicalMaterial({
        color: entity.genome.glowHex,
        emissive: new THREE.Color(entity.genome.glowHex),
        emissiveIntensity: 0.72,
        roughness: 0.22,
        normalMap: tex ? tex.floraVeinNormal : null,
        normalScale: new THREE.Vector2(0.55, 0.55),
        clearcoat: 0.72,
        clearcoatRoughness: 0.14,
        iridescence: 0.52,
        transparent: true,
        opacity: 0.92,
        vertexColors: true,
      });
      enhanceMaterialWithUnderwaterCaustics(mat, this.sharedUniforms, {
        causticStrength: 0.5,
        subsurfaceStrength: 0.48,
        subsurfaceColor: entity.genome.glowHex,
      });
      const group = new THREE.Group();
      group.add(new THREE.Mesh(geo.spore, mat));
      disableFrustumCulling(group);
      group.position.copy(entity.position);
      this.attachEntityRef(group, entity);
      this.scene.add(group);
      this.simpleRigs.set(entity.id, { group, materials: [mat] });
    }
  }

  private disposeRigForEntity(entity: Entity): void {
    if (entity.kind === 'pellet') return;

    if (entity.kind === 'animal' || entity.kind === 'corpse') {
      const rig = this.animalRigs.get(entity.id);
      if (rig) {
        this.scene.remove(rig.group);
        for (const m of rig.materials) m.dispose();
        this.animalRigs.delete(entity.id);
      }
    } else if (entity.kind === 'plant') {
      const rig = this.plantRigs.get(entity.id);
      if (rig) {
        this.scene.remove(rig.group);
        for (const m of rig.materials) m.dispose();
        this.plantRigs.delete(entity.id);
      }
    } else {
      const rig = this.simpleRigs.get(entity.id);
      if (rig) {
        this.scene.remove(rig.group);
        for (const m of rig.materials) m.dispose();
        this.simpleRigs.delete(entity.id);
      }
    }
  }

  getGroupForEntity(entity: Entity): THREE.Group | null {
    if (entity.kind === 'animal' || entity.kind === 'corpse') {
      return this.animalRigs.get(entity.id)?.group ?? null;
    }
    if (entity.kind === 'plant') {
      return this.plantRigs.get(entity.id)?.group ?? null;
    }
    return this.simpleRigs.get(entity.id)?.group ?? null;
  }

  handleCanvasClick(clientX: number, clientY: number): void {
    if (this.eyeSystem.mode === 'fullscreen') return;
    const rect = this.renderer.domElement.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return;

    this._ndc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    this._ndc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    this._ray.setFromCamera(this._ndc, this.camera);

    // Interactive Feed Mode: click anywhere in the dive view to rain sinking nutrient pellets
    if (this.feedMode) {
      let hit = false;
      if (this._ray.ray.intersectPlane(this._waterPlane, this._planeHit)) {
        const dist = this._planeHit.distanceTo(this.camera.position);
        if (dist < 28) hit = true;
      }
      if (!hit && this._ray.ray.intersectPlane(this._midPlane, this._planeHit)) {
        hit = true;
      }
      if (hit) {
        const [x, z] = clampXZToTankRadius(this._planeHit.x, this._planeHit.z, 6.5);
        this.sim.dropFoodCluster(x, z, 6);
      } else {
        this._v1.copy(this._ray.ray.direction).multiplyScalar(11.0).add(this.camera.position);
        const [x, z] = clampXZToTankRadius(this._v1.x, this._v1.z, 6.5);
        this.sim.dropFoodCluster(x, z, 6);
      }
      return;
    }

    const targets: THREE.Object3D[] = [];
    for (const rig of this.animalRigs.values()) targets.push(rig.group);
    for (const rig of this.plantRigs.values()) targets.push(rig.group);
    for (const rig of this.simpleRigs.values()) targets.push(rig.group);

    const hits = this._ray.intersectObjects(targets, true);
    if (hits.length > 0) {
      let obj: THREE.Object3D | null = hits[0].object;
      while (obj && !obj.userData.entityRef) obj = obj.parent;
      if (obj && obj.userData.entityRef) {
        this.selectEntity(obj.userData.entityRef as Entity);
      }
    }
  }

  selectEntity(entity: Entity | null, focusCamera = false): void {
    const prev = this.selectedEntity;
    this.selectedEntity = entity;
    if (prev !== entity) this.eyeSystem.resetSmoothing();
    if (!entity) {
      this.followCam = false;
      this.selectionRing.visible = false;
    } else if (focusCamera && this.eyeSystem.mode !== 'fullscreen') {
      const offset = new THREE.Vector3(2.2, 0.85, 3.1);
      this.camLerpTarget = entity.position.clone();
      this.camLerpPos = entity.position.clone().add(offset);
      this.camLerpPos.y = clamp(
        this.camLerpPos.y,
        getSeabedHeight(this.camLerpPos.x, this.camLerpPos.z) + 0.85,
        TANK.waterY - 0.55
      );
    }
    this.sim.events.emit('selection:changed', { entity });
  }

  flyToPreset(preset: 'tank' | 'vent' | 'top' | 'reset'): void {
    this.followCam = false;
    if (preset === 'reset') this.selectEntity(null);
    if (preset === 'vent') {
      this.camLerpPos = new THREE.Vector3(
        TANK.ventPos.x + 4.8,
        TANK.ventPos.y + 3.4,
        TANK.ventPos.z + 6.4
      );
      this.camLerpTarget = new THREE.Vector3(TANK.ventPos.x, TANK.ventPos.y + 1.8, TANK.ventPos.z);
    } else if (preset === 'top') {
      this.camLerpPos = new THREE.Vector3(0, TANK.waterY - 0.9, 10.6);
      this.camLerpTarget = new THREE.Vector3(0, 2.4, -1.2);
    } else {
      this.camLerpPos = new THREE.Vector3(0, 4.9, 13.8);
      this.camLerpTarget = new THREE.Vector3(0, 5.15, -1.5);
    }
  }

  onResize(): void {
    const w = Math.max(1, window.innerWidth);
    const h = Math.max(1, window.innerHeight);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (this.eyeSystem.mode === 'fullscreen') {
      this.eyeSystem.camera.aspect = w / h;
      this.eyeSystem.camera.updateProjectionMatrix();
    }
    this.renderer.setSize(w, h);
    this.postFx.resize(w, h);
  }

  updateAndRender(
    realDt: number,
    pipViewportEl: HTMLElement | null,
    pipCanvasEl: HTMLCanvasElement | null,
    fullEyeCanvasEl: HTMLCanvasElement | null
  ): void {
    const daylight = computeDaylightFactor(this.sim.env.timeOfDay);
    this.scene.environmentIntensity = 0.38 + daylight * 0.72;
    // When simulation is paused, still allow manual Biogenesis/Phytogenesis flare to dim out
    if (this.sim.simSpeed <= 0 && this.sim.ventPulseEnergy > 0) {
      this.sim.ventPulseEnergy = Math.max(0.0, this.sim.ventPulseEnergy - realDt * 0.28);
    }

    this.envRig.update(
      realDt,
      this.sim.env.currentStrength,
      this.sim.getVentGlowLevel(),
      daylight,
      this.sim.env.timeOfDay
    );

    const t = this.sharedUniforms.uTime.value;

    // 1. Sync articulated animal rigs
    for (let i = 0; i < this.sim.animals.length; i++) {
      const a = this.sim.animals[i];
      const rig = this.animalRigs.get(a.id);
      if (rig) updateAnimalRig(rig, a, daylight, t);
    }

    // 2. Sync corpse rigs
    for (let i = 0; i < this.sim.corpses.length; i++) {
      const c = this.sim.corpses[i];
      const rig = this.animalRigs.get(c.id);
      if (rig) updateCorpseRig(rig, c);
    }

    // 3. Sync flora rigs
    for (let i = 0; i < this.sim.plants.length; i++) {
      const p = this.sim.plants[i];
      const rig = this.plantRigs.get(p.id);
      if (rig) updatePlantRig(rig, p, daylight, this.sim.env.currentStrength, t);
    }

    // 4. Sync eggs & propagules
    for (let i = 0; i < this.sim.eggs.length; i++) {
      const e = this.sim.eggs[i];
      const rig = this.simpleRigs.get(e.id);
      if (rig) {
        rig.group.position.copy(e.position);
        rig.group.scale.setScalar(e.scale);
        if (rig.embryoMesh) {
          const prog = clamp(e.age / Math.max(1.0, e.incubateDuration), 0, 1);
          const wriggleFreq = 1.3 + prog * 3.8;
          rig.embryoMesh.rotation.y = t * (0.55 + prog * 0.85) + e.id * 1.7;
          rig.embryoMesh.rotation.z = Math.sin(t * wriggleFreq + e.id) * (0.2 + prog * 0.24);
          const embryoSize = 0.54 + prog * 0.56;
          rig.embryoMesh.scale.setScalar(embryoSize * (1.0 + Math.sin(t * (2.6 + prog * 3.4) + e.id) * 0.055));
        }
      }
    }
    for (let i = 0; i < this.sim.propagules.length; i++) {
      const pr = this.sim.propagules[i];
      const rig = this.simpleRigs.get(pr.id);
      if (rig) {
        rig.group.position.copy(pr.position);
        rig.group.rotation.y = t * 1.4 + pr.id;
      }
    }

    // 5. Update InstancedMesh FX, torn fragments, pellets & nutrient patches
    this.fx.update(
      realDt,
      t,
      this.sim.foodPellets,
      this.sim.nutrientPatches,
      this.sim.env.currentStrength
    );

    // 6. Camera & Selection Halo
    if (this.eyeSystem.mode !== 'fullscreen') {
      if (this.camLerpPos && this.camLerpTarget && !this.followCam) {
        const a = 1.0 - Math.exp(-5.2 * realDt);
        this.camera.position.lerp(this.camLerpPos, a);
        this.controls.target.lerp(this.camLerpTarget, a);
        if (this.camera.position.distanceTo(this.camLerpPos) < 0.14) {
          this.camLerpPos = null;
          this.camLerpTarget = null;
        }
      }

      const sel = this.selectedEntity;
      if (sel && sel.alive && isFiniteVec3(sel.position)) {
        this.selectionRing.visible = true;
        this.selectionRing.position.copy(sel.position);
        if (sel.kind === 'plant') this.selectionRing.position.y += 0.16;
        const rS = sel.kind === 'plant' ? 1.3 : Math.max(0.7, sel.scale * 1.85);
        this.selectionRing.scale.setScalar(rS * (1.0 + Math.sin(t * 4.0) * 0.08));
        if (this.followCam) {
          this._v1.copy(sel.position);
          if (sel.kind === 'plant') this._v1.y += 0.7;
          this.controls.target.lerp(this._v1, clamp(realDt * 6.5, 0, 1));
        }
      } else {
        this.selectionRing.visible = false;
      }
      this.controls.update();

      // Keep scuba-diver camera immersed inside the water column (above sand, below surface)
      const tgtR = Math.hypot(this.controls.target.x, this.controls.target.z);
      if (tgtR > TANK.coreRadius) {
        const inv = TANK.coreRadius / tgtR;
        this.controls.target.x *= inv;
        this.controls.target.z *= inv;
      }
      const tgtBed = getSeabedHeight(this.controls.target.x, this.controls.target.z);
      this.controls.target.y = clamp(this.controls.target.y, tgtBed + 0.55, TANK.waterY - 1.1);
      const camBed = getSeabedHeight(this.camera.position.x, this.camera.position.z);
      this.camera.position.y = clamp(this.camera.position.y, camBed + 0.65, TANK.waterY - 0.32);
      const camR = Math.hypot(this.camera.position.x, this.camera.position.z);
      if (camR > TANK.maxRadius + 4.0) {
        const inv = (TANK.maxRadius + 4.0) / camR;
        this.camera.position.x *= inv;
        this.camera.position.z *= inv;
      }
    }

    // 7. Creature Eye Camera & Multi-Pass Scissor Render
    const fullW = Math.max(1, window.innerWidth);
    const fullH = Math.max(1, window.innerHeight);
    this.renderer.setScissorTest(false);
    this.renderer.setViewport(0, 0, fullW, fullH);

    const target = this.selectedEntity;
    const canEye = this.eyeSystem.canUseEyeView(target);

    if (this.eyeSystem.mode !== 'off' && canEye) {
      this.eyeSystem.updateCamera(this.sim, target, realDt);
      const filterStr = this.eyeSystem.getCssFilter(target);
      if (this.eyeSystem.mode === 'fullscreen') {
        this.renderer.domElement.style.filter = filterStr;
      } else {
        this.renderer.domElement.style.filter = '';
        if (pipViewportEl) pipViewportEl.style.backdropFilter = filterStr;
      }
    }

    if (this.eyeSystem.mode === 'fullscreen' && canEye) {
      this.eyeSystem.camera.aspect = fullW / fullH;
      this.eyeSystem.camera.updateProjectionMatrix();
      const targetGroup = this.getGroupForEntity(target);
      const prevVis = targetGroup ? targetGroup.visible : true;
      const prevRing = this.selectionRing.visible;
      try {
        if (targetGroup) targetGroup.visible = false;
        this.selectionRing.visible = false;
        this.renderer.render(this.scene, this.eyeSystem.camera);
      } finally {
        if (targetGroup) targetGroup.visible = prevVis;
        this.selectionRing.visible = prevRing;
      }
      this.eyeSystem.renderOverlay(fullEyeCanvasEl, target, t, false);
      return;
    }

    // Main Diver Render Pass with GPU Underwater Depth-of-Field Distance Blur
    const focusDist =
      this.selectedEntity && this.selectedEntity.alive && isFiniteVec3(this.selectedEntity.position)
        ? clamp(this.camera.position.distanceTo(this.selectedEntity.position), 3.5, 16.0)
        : clamp(this.camera.position.distanceTo(this.controls.target) * 0.82, 5.5, 13.0);
    this.postFx.render(this.scene, this.camera, focusDist);

    // Live Picture-in-Picture Scissor Pass
    if (this.eyeSystem.mode === 'pip' && canEye && pipViewportEl) {
      const canvasRect = this.renderer.domElement.getBoundingClientRect();
      const pipRect = pipViewportEl.getBoundingClientRect();
      const left = clamp(Math.floor(pipRect.left - canvasRect.left), 0, fullW);
      const bottom = clamp(Math.floor(canvasRect.bottom - pipRect.bottom), 0, fullH);
      const width = Math.min(Math.floor(pipRect.width), fullW - left);
      const height = Math.min(Math.floor(pipRect.height), fullH - bottom);

      if (width > 2 && height > 2) {
        this.eyeSystem.camera.aspect = width / height;
        this.eyeSystem.camera.updateProjectionMatrix();

        const targetGroup = this.getGroupForEntity(target);
        const prevVis = targetGroup ? targetGroup.visible : true;
        const prevRing = this.selectionRing.visible;
        try {
          if (targetGroup) targetGroup.visible = false;
          this.selectionRing.visible = false;
          this.renderer.setScissorTest(true);
          this.renderer.setScissor(left, bottom, width, height);
          this.renderer.setViewport(left, bottom, width, height);
          this.renderer.clearDepth();
          this.renderer.render(this.scene, this.eyeSystem.camera);
        } finally {
          if (targetGroup) targetGroup.visible = prevVis;
          this.selectionRing.visible = prevRing;
          this.renderer.setScissorTest(false);
          this.renderer.setViewport(0, 0, fullW, fullH);
        }
        this.eyeSystem.renderOverlay(pipCanvasEl, target, t, true);
      }
    }
  }
}
