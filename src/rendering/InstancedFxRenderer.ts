import * as THREE from 'three';
import { CAPS } from '../core/config';
import type { FragmentKind } from '../core/EventBus';
import { clamp, getSeabedHeight, isFiniteVec3, randRange, safeNormalize, sampleWaterCurrent } from '../core/math';
import type { FoodPelletEntity, NutrientPatch } from '../simulation/types';
import { getGeometryLibrary } from './GeometryLibrary';
import { enhanceMaterialWithUnderwaterCaustics, type SharedShaderUniforms } from './Shaders';
import { getProceduralTextures } from './TextureLibrary';

interface ParticleSlot {
  active: boolean;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  age: number;
  maxAge: number;
  color: THREE.Color;
  baseScale: number;
}

interface FragmentSlot {
  active: boolean;
  kind: FragmentKind;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  rot: THREE.Euler;
  rotVel: THREE.Vector3;
  age: number;
  maxAge: number;
  color: THREE.Color;
  baseScale: number;
  stretchX: number;
  stretchY: number;
  stretchZ: number;
  suctionActive: boolean;
  suctionTarget: THREE.Vector3;
}

interface ShockwaveSlot {
  mesh: THREE.Mesh;
  material: THREE.MeshBasicMaterial;
  age: number;
  maxAge: number;
  maxScale: number;
}

/**
 * High-performance pooled InstancedMesh renderer for burst particles,
 * fine buccal-suction tear shreds, persistent intact sinking/resting/dissolving
 * torn flesh & flora pieces, sinking nutrient pellets, seabed nutrient patches,
 * and hydrothermal shockwaves.
 */
export class InstancedFxRenderer {
  private readonly particleMesh: THREE.InstancedMesh;
  private readonly particles: ParticleSlot[] = [];

  private readonly fleshMesh: THREE.InstancedMesh;
  private readonly floraMesh: THREE.InstancedMesh;
  private readonly maxFleshInstances: number;
  private readonly maxFloraInstances: number;
  private readonly fragments: FragmentSlot[] = [];

  private readonly pelletMesh: THREE.InstancedMesh;
  private readonly nutrientMesh: THREE.InstancedMesh;

  private readonly shockwaves: ShockwaveSlot[] = [];
  private readonly scene: THREE.Scene;

  private readonly _dummy = new THREE.Object3D();
  private readonly _color = new THREE.Color();
  private readonly _fleshDissolveTint = new THREE.Color(0x5a6e72);
  private readonly _floraDissolveTint = new THREE.Color(0x4f6d64);
  private readonly _pelletDissolveTint = new THREE.Color(0x63736b);
  private readonly _cur = new THREE.Vector3();
  private readonly _toMouth = new THREE.Vector3();

  constructor(scene: THREE.Scene, sharedUniforms?: SharedShaderUniforms) {
    this.scene = scene;
    const geo = getGeometryLibrary();
    const tex = getProceduralTextures();
    const white = new THREE.Color(0xffffff);

    // 1. Burst / Ichor / Detritus Mist Particles (1 draw call)
    const pMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.particleMesh = new THREE.InstancedMesh(geo.particle, pMat, CAPS.maxBurstParticles);
    this.particleMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.particleMesh.setColorAt(0, white);
    this.particleMesh.frustumCulled = false;
    this.particleMesh.count = 0;
    scene.add(this.particleMesh);

    for (let i = 0; i < CAPS.maxBurstParticles; i++) {
      this.particles.push({
        active: false,
        pos: new THREE.Vector3(),
        vel: new THREE.Vector3(),
        age: 0,
        maxAge: 1,
        color: new THREE.Color(0xffffff),
        baseScale: 1,
      });
    }

    // 2. Physical Torn Flesh Chunks & Edible Meat Scraps (1 draw call)
    this.maxFleshInstances = CAPS.maxTornFragments + CAPS.maxFoodPellets;
    const fleshMat = new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      map: tex.fleshAlbedo,
      normalMap: tex.fleshNormal,
      normalScale: new THREE.Vector2(0.95, 0.95),
      vertexColors: true,
      roughness: 0.24,
      metalness: 0.04,
      clearcoat: 0.84,
      clearcoatRoughness: 0.12,
      sheen: 0.52,
      sheenColor: new THREE.Color(0xff9bb0),
    });
    if (sharedUniforms) {
      enhanceMaterialWithUnderwaterCaustics(fleshMat, sharedUniforms, {
        causticStrength: 0.42,
        subsurfaceStrength: 0.34,
        subsurfaceColor: 0xff8a7a,
        ventBounceStrength: 0.32,
      });
    }
    this.fleshMesh = new THREE.InstancedMesh(geo.tornFleshShred, fleshMat, this.maxFleshInstances);
    this.fleshMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.fleshMesh.setColorAt(0, white);
    this.fleshMesh.frustumCulled = false;
    this.fleshMesh.castShadow = true;
    this.fleshMesh.receiveShadow = true;
    this.fleshMesh.count = 0;
    scene.add(this.fleshMesh);

    // 3. Physical Fluttering Torn Kelp / Petal Shreds & Edible Flora Pieces (1 draw call)
    this.maxFloraInstances = CAPS.maxTornFragments + CAPS.maxFoodPellets;
    const floraMat = new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      map: tex.floraAlbedo,
      normalMap: tex.floraVeinNormal,
      normalScale: new THREE.Vector2(0.85, 0.85),
      vertexColors: true,
      roughness: 0.30,
      metalness: 0.02,
      clearcoat: 0.56,
      sheen: 0.56,
      sheenColor: new THREE.Color(0x9fffe0),
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.92,
    });
    if (sharedUniforms) {
      enhanceMaterialWithUnderwaterCaustics(floraMat, sharedUniforms, {
        causticStrength: 0.40,
        subsurfaceStrength: 0.52,
        subsurfaceColor: 0x7effc8,
        ventBounceStrength: 0.30,
      });
    }
    this.floraMesh = new THREE.InstancedMesh(geo.tornLeafRibbon, floraMat, this.maxFloraInstances);
    this.floraMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.floraMesh.setColorAt(0, white);
    this.floraMesh.frustumCulled = false;
    this.floraMesh.count = 0;
    scene.add(this.floraMesh);

    for (let i = 0; i < CAPS.maxTornFragments; i++) {
      this.fragments.push({
        active: false,
        kind: 'flesh',
        pos: new THREE.Vector3(),
        vel: new THREE.Vector3(),
        rot: new THREE.Euler(),
        rotVel: new THREE.Vector3(),
        age: 0,
        maxAge: 2,
        color: new THREE.Color(0xffffff),
        baseScale: 1,
        stretchX: 1,
        stretchY: 1,
        stretchZ: 1,
        suctionActive: false,
        suctionTarget: new THREE.Vector3(),
      });
    }

    // 4. User-Dropped Sinking Food Pellets (1 draw call)
    const pelletMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      normalMap: tex.rockNormal,
      normalScale: new THREE.Vector2(0.45, 0.45),
      roughness: 0.42,
      emissive: new THREE.Color(0xf59e0b),
      emissiveIntensity: 0.42,
    });
    if (sharedUniforms) {
      enhanceMaterialWithUnderwaterCaustics(pelletMat, sharedUniforms, {
        causticStrength: 0.38,
        subsurfaceStrength: 0.24,
        subsurfaceColor: 0xffc864,
        ventBounceStrength: 0.28,
      });
    }
    this.pelletMesh = new THREE.InstancedMesh(geo.pellet, pelletMat, CAPS.maxFoodPellets);
    this.pelletMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.pelletMesh.setColorAt(0, white);
    this.pelletMesh.frustumCulled = false;
    this.pelletMesh.castShadow = true;
    this.pelletMesh.receiveShadow = true;
    this.pelletMesh.count = 0;
    scene.add(this.pelletMesh);

    // 5. Seabed Nutrient Patches (1 draw call)
    const nutMat = new THREE.MeshBasicMaterial({
      color: 0x3ef2b2,
      transparent: true,
      opacity: 0.34,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.nutrientMesh = new THREE.InstancedMesh(geo.nutrientDisc, nutMat, CAPS.maxNutrientPatches);
    this.nutrientMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.nutrientMesh.frustumCulled = false;
    this.nutrientMesh.count = 0;
    scene.add(this.nutrientMesh);
  }

  clear(): void {
    for (let i = 0; i < this.particles.length; i++) this.particles[i].active = false;
    for (let i = 0; i < this.fragments.length; i++) this.fragments[i].active = false;
    this.particleMesh.count = 0;
    this.fleshMesh.count = 0;
    this.floraMesh.count = 0;
    this.pelletMesh.count = 0;
    this.nutrientMesh.count = 0;

    for (let i = this.shockwaves.length - 1; i >= 0; i--) {
      const sw = this.shockwaves[i];
      this.scene.remove(sw.mesh);
      sw.material.dispose();
    }
    this.shockwaves.length = 0;
  }

  spawnBurst(pos: THREE.Vector3, colorHex: number, count = 7, speed = 1.6): void {
    if (!isFiniteVec3(pos)) return;
    let spawned = 0;
    for (let i = 0; i < this.particles.length && spawned < count; i++) {
      const slot = this.particles[i];
      if (slot.active) continue;
      slot.active = true;
      slot.pos.copy(pos);
      slot.vel.set(randRange(-1, 1), randRange(-0.5, 1.15), randRange(-1, 1));
      safeNormalize(slot.vel);
      slot.vel.multiplyScalar(randRange(0.35, 1.0) * speed);
      slot.age = 0;
      slot.maxAge = randRange(0.55, 1.35);
      slot.color.setHex(colorHex);
      slot.baseScale = randRange(0.75, 1.35);
      spawned++;
    }
  }

  /**
   * Spawns fine buccal-suction bits pulled directly into the feeder's gulping jaws
   * plus tiny ephemeral tear spray crumbs around the bite impact.
   * Larger intact edible pieces are spawned as real persistent FoodPelletEntity objects.
   */
  spawnFragments(
    pos: THREE.Vector3,
    colorHex: number,
    kind: FragmentKind,
    count = 5,
    speed = 1.6,
    accentHex?: number,
    suctionTarget?: THREE.Vector3,
    ejectDir?: THREE.Vector3
  ): void {
    if (!isFiniteVec3(pos)) return;
    let spawned = 0;
    for (let i = 0; i < this.fragments.length && spawned < count; i++) {
      const slot = this.fragments[i];
      if (slot.active) continue;

      slot.active = true;
      slot.kind = kind === 'pellet' ? 'flesh' : kind;
      slot.pos.set(
        pos.x + randRange(-0.14, 0.14),
        pos.y + randRange(-0.12, 0.12),
        pos.z + randRange(-0.14, 0.14)
      );

      // Combine radial tear spray with optional directional tear rip impulse
      slot.vel.set(randRange(-1, 1), randRange(-0.4, 0.95), randRange(-1, 1));
      safeNormalize(slot.vel);
      if (ejectDir && isFiniteVec3(ejectDir)) {
        slot.vel.addScaledVector(ejectDir, randRange(0.25, 0.75));
        safeNormalize(slot.vel);
      }
      slot.vel.multiplyScalar(randRange(0.35, 1.0) * speed);

      slot.rot.set(randRange(0, Math.PI * 2), randRange(0, Math.PI * 2), randRange(0, Math.PI * 2));
      slot.rotVel.set(randRange(-5.5, 5.5), randRange(-5.5, 5.5), randRange(-5.5, 5.5));

      // More than half of fine shreds get sucked directly into the feeder's mouth
      const sucked = Boolean(suctionTarget && isFiniteVec3(suctionTarget) && spawned < Math.ceil(count * 0.55));
      slot.suctionActive = sucked;
      if (sucked && suctionTarget) {
        slot.suctionTarget.copy(suctionTarget);
        slot.maxAge = randRange(0.32, 0.56);
      } else {
        slot.maxAge = kind === 'flora' ? randRange(1.4, 2.3) : randRange(1.0, 1.8);
      }

      slot.age = 0;
      const useAccent = accentHex !== undefined && spawned % 2 === 1;
      slot.color.setHex(useAccent ? accentHex : colorHex);
      slot.color.offsetHSL(randRange(-0.02, 0.02), randRange(-0.05, 0.06), randRange(-0.08, 0.08));

      // Keep ephemeral spray crumbs smaller so persistent intact torn chunks stand out clearly
      slot.baseScale = sucked
        ? randRange(0.45, 0.82)
        : kind === 'pellet'
        ? randRange(0.32, 0.52)
        : randRange(0.36, 0.68);
      slot.stretchX = randRange(0.75, 1.38);
      slot.stretchY = randRange(0.68, 1.25);
      slot.stretchZ = randRange(0.75, 1.32);
      spawned++;
    }
  }

  spawnShockwave(pos: THREE.Vector3, colorHex: number, maxScale = 9.5): void {
    if (this.shockwaves.length >= CAPS.maxShockwaves || !isFiniteVec3(pos)) return;
    const geo = getGeometryLibrary();
    const mat = new THREE.MeshBasicMaterial({
      color: colorHex,
      transparent: true,
      opacity: 0.82,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(geo.shockRing, mat);
    mesh.position.copy(pos);
    mesh.frustumCulled = false;
    this.scene.add(mesh);
    this.shockwaves.push({ mesh, material: mat, age: 0, maxAge: 2.0, maxScale });
  }

  update(
    dt: number,
    time: number,
    pellets: readonly FoodPelletEntity[],
    nutrientPatches: readonly NutrientPatch[],
    currentStrength = 0.65
  ): void {
    // 1. Update burst / mist particles
    let activeCount = 0;
    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];
      if (!p.active) continue;
      p.age += dt;
      if (p.age >= p.maxAge) {
        p.active = false;
        continue;
      }
      p.pos.addScaledVector(p.vel, dt);
      p.vel.multiplyScalar(Math.exp(-2.4 * dt));
      const lifeRatio = 1.0 - p.age / p.maxAge;
      this._dummy.position.copy(p.pos);
      this._dummy.rotation.set(0, 0, 0);
      this._dummy.scale.setScalar(Math.max(0.01, p.baseScale * lifeRatio));
      this._dummy.updateMatrix();
      this.particleMesh.setMatrixAt(activeCount, this._dummy.matrix);
      this.particleMesh.setColorAt(activeCount, p.color);
      activeCount++;
    }
    this.particleMesh.count = activeCount;
    this.particleMesh.instanceMatrix.needsUpdate = true;
    if (this.particleMesh.instanceColor) this.particleMesh.instanceColor.needsUpdate = true;

    // 2. Update fine buccal-suction shreds & transient bite crumbs
    let fleshCount = 0;
    let floraCount = 0;
    for (let i = 0; i < this.fragments.length; i++) {
      const f = this.fragments[i];
      if (!f.active) continue;
      f.age += dt;
      if (f.age >= f.maxAge) {
        f.active = false;
        continue;
      }

      const lifeRatio = 1.0 - f.age / f.maxAge;
      if (f.suctionActive) {
        this._toMouth.subVectors(f.suctionTarget, f.pos);
        const d = this._toMouth.length();
        if (d < 0.08) {
          f.active = false;
          continue;
        }
        this._toMouth.divideScalar(d);
        f.vel.lerp(this._toMouth.multiplyScalar(3.6), clamp(dt * 10.0, 0, 1));
        f.pos.addScaledVector(f.vel, dt);
      } else {
        sampleWaterCurrent(f.pos.x, f.pos.y, f.pos.z, time, currentStrength, this._cur);
        const isFlora = f.kind === 'flora';
        f.vel.x += this._cur.x * (isFlora ? 0.85 : 0.45) * dt;
        f.vel.z += this._cur.z * (isFlora ? 0.85 : 0.45) * dt;
        if (isFlora) {
          f.vel.x += Math.sin(time * 4.2 + i * 1.7) * 0.45 * dt;
          f.vel.z += Math.cos(time * 3.7 + i * 1.3) * 0.45 * dt;
          f.vel.y = clamp(f.vel.y - 0.14 * dt, -0.35, 0.45);
          f.vel.multiplyScalar(Math.exp(-2.1 * dt));
        } else {
          f.vel.y = clamp(f.vel.y - 0.52 * dt, -0.85, 0.65);
          f.vel.multiplyScalar(Math.exp(-1.75 * dt));
        }
        f.pos.addScaledVector(f.vel, dt);

        const fl = getSeabedHeight(f.pos.x, f.pos.z) + 0.05;
        if (f.pos.y < fl) {
          f.pos.y = fl;
          f.vel.multiplyScalar(0.35);
          f.rotVel.multiplyScalar(0.45);
        }
      }

      f.rot.x += f.rotVel.x * dt;
      f.rot.y += f.rotVel.y * dt;
      f.rot.z += f.rotVel.z * dt;
      f.rotVel.multiplyScalar(Math.exp(-0.9 * dt));

      const fadeScale = f.suctionActive
        ? Math.pow(lifeRatio, 0.7)
        : lifeRatio < 0.4
        ? lifeRatio / 0.4
        : 1.0;
      const sc = Math.max(0.01, f.baseScale * fadeScale);

      this._dummy.position.copy(f.pos);
      this._dummy.rotation.copy(f.rot);
      this._dummy.scale.set(sc * f.stretchX, sc * f.stretchY, sc * f.stretchZ);
      this._dummy.updateMatrix();

      if (f.kind === 'flora') {
        if (floraCount < this.maxFloraInstances) {
          this.floraMesh.setMatrixAt(floraCount, this._dummy.matrix);
          this.floraMesh.setColorAt(floraCount, f.color);
          floraCount++;
        }
      } else {
        if (fleshCount < this.maxFleshInstances) {
          this.fleshMesh.setMatrixAt(fleshCount, this._dummy.matrix);
          this.fleshMesh.setColorAt(fleshCount, f.color);
          fleshCount++;
        }
      }
    }

    // 3. Sync real persistent torn flesh/flora pieces & sinking pellets using true physics quaternions
    let pelCount = 0;
    for (let i = 0; i < pellets.length; i++) {
      const pel = pellets[i];
      if (!pel.alive) continue;

      const dissolveProg =
        pel.phase === 'dissolving'
          ? clamp(pel.dissolveAge / Math.max(1.0, pel.dissolveDuration), 0, 1)
          : 0;
      // Gently flatten into seabed sediment as the resting piece very slowly dissolves
      const flattenY = 1.0 - dissolveProg * 0.46;

      this._dummy.position.copy(pel.position);
      this._dummy.quaternion.copy(pel.quaternion);
      this._color.setHex(pel.colorHex);

      if (pel.origin === 'flesh') {
        if (fleshCount < this.maxFleshInstances) {
          if (dissolveProg > 0.001) {
            this._color.lerp(this._fleshDissolveTint, dissolveProg * 0.78);
            this._color.multiplyScalar(1.0 - dissolveProg * 0.35);
          }
          this._dummy.scale.set(
            pel.scale * pel.stretch.x * 1.18,
            pel.scale * pel.stretch.y * 0.96 * flattenY,
            pel.scale * pel.stretch.z * 1.12
          );
          this._dummy.updateMatrix();
          this.fleshMesh.setMatrixAt(fleshCount, this._dummy.matrix);
          this.fleshMesh.setColorAt(fleshCount, this._color);
          fleshCount++;
        }
      } else if (pel.origin === 'flora') {
        if (floraCount < this.maxFloraInstances) {
          if (dissolveProg > 0.001) {
            this._color.lerp(this._floraDissolveTint, dissolveProg * 0.76);
            this._color.multiplyScalar(1.0 - dissolveProg * 0.34);
          }
          this._dummy.scale.set(
            pel.scale * pel.stretch.x * 1.24,
            pel.scale * pel.stretch.y * 1.24,
            pel.scale * pel.stretch.z * 1.1 * flattenY
          );
          this._dummy.updateMatrix();
          this.floraMesh.setMatrixAt(floraCount, this._dummy.matrix);
          this.floraMesh.setColorAt(floraCount, this._color);
          floraCount++;
        }
      } else if (pelCount < CAPS.maxFoodPellets) {
        if (dissolveProg > 0.001) {
          this._color.lerp(this._pelletDissolveTint, dissolveProg * 0.72);
          this._color.multiplyScalar(1.0 - dissolveProg * 0.32);
        }
        this._dummy.scale.set(pel.scale, pel.scale * flattenY, pel.scale);
        this._dummy.updateMatrix();
        this.pelletMesh.setMatrixAt(pelCount, this._dummy.matrix);
        this.pelletMesh.setColorAt(pelCount, this._color);
        pelCount++;
      }
    }

    this.fleshMesh.count = fleshCount;
    this.fleshMesh.instanceMatrix.needsUpdate = true;
    if (this.fleshMesh.instanceColor) this.fleshMesh.instanceColor.needsUpdate = true;

    this.floraMesh.count = floraCount;
    this.floraMesh.instanceMatrix.needsUpdate = true;
    if (this.floraMesh.instanceColor) this.floraMesh.instanceColor.needsUpdate = true;

    this.pelletMesh.count = pelCount;
    this.pelletMesh.instanceMatrix.needsUpdate = true;
    if (this.pelletMesh.instanceColor) this.pelletMesh.instanceColor.needsUpdate = true;

    // 4. Sync seabed nutrient patches
    let nutCount = 0;
    for (let i = 0; i < nutrientPatches.length && nutCount < CAPS.maxNutrientPatches; i++) {
      const np = nutrientPatches[i];
      if (!np.alive) continue;
      const lr = 1.0 - clamp(np.age / np.maxAge, 0, 1);
      const nr = clamp(np.nutrients / Math.max(1, np.maxNutrients), 0, 1);
      const pulse = 0.85 + 0.15 * Math.sin(time * 2.5 + np.id);
      this._dummy.position.copy(np.position);
      this._dummy.rotation.set(0, 0, 0);
      this._dummy.scale.setScalar(Math.max(0.05, np.radiusScale * (0.45 + 0.55 * nr * lr) * pulse));
      this._dummy.updateMatrix();
      this.nutrientMesh.setMatrixAt(nutCount, this._dummy.matrix);
      nutCount++;
    }
    this.nutrientMesh.count = nutCount;
    this.nutrientMesh.instanceMatrix.needsUpdate = true;

    // 5. Update shockwaves
    for (let i = this.shockwaves.length - 1; i >= 0; i--) {
      const sw = this.shockwaves[i];
      sw.age += dt;
      const prog = clamp(sw.age / sw.maxAge, 0, 1);
      sw.mesh.scale.setScalar(1.0 + prog * sw.maxScale);
      sw.material.opacity = (1.0 - prog) * 0.72;
      if (prog >= 1.0) {
        this.scene.remove(sw.mesh);
        sw.material.dispose();
        this.shockwaves.splice(i, 1);
      }
    }
  }
}
