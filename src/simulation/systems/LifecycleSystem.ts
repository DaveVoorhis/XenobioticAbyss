import * as THREE from 'three';
import { CAPS, TANK } from '../../core/config';
import {
  clamp,
  clampToTankRadius,
  computeHorizontalBoundWeight,
  computePlantPlacementWeight,
  getSeabedHeight,
  randRange,
  safeRatio,
  sampleWaterCurrent,
} from '../../core/math';
import { getIntermediateStage } from '../lifecycle';
import type { SimulationContext } from '../SimulationEngine';

export class LifecycleSystem {
  private readonly _cur = new THREE.Vector3();
  private readonly _rollQ = new THREE.Quaternion();
  private readonly _alignQ = new THREE.Quaternion();
  private readonly _targetQ = new THREE.Quaternion();
  private readonly _spinAxis = new THREE.Vector3();
  private readonly _bedNormal = new THREE.Vector3();
  private readonly _flatAxis = new THREE.Vector3();
  private readonly _axisZ = new THREE.Vector3(0, 0, 1);
  private readonly _axisX = new THREE.Vector3(1, 0, 0);

  update(ctx: SimulationContext, dt: number): void {
    this.updateEggs(ctx, dt);
    this.updatePropagules(ctx, dt);
    this.updateFoodPellets(ctx, dt);
    this.updateCorpses(ctx, dt);
    this.updateNutrientPatches(ctx, dt);
  }

  private updateEggs(ctx: SimulationContext, dt: number): void {
    for (let i = ctx.eggs.length - 1; i >= 0; i--) {
      const e = ctx.eggs[i];
      if (!e.alive) {
        ctx.eggs.splice(i, 1);
        continue;
      }
      e.age += dt;
      const prog = clamp(e.age / Math.max(1.0, e.incubateDuration), 0, 1);
      e.state = prog > 0.76 ? 'Hatching Soon' : 'Incubating';
      const fl = getSeabedHeight(e.position.x, e.position.z) + 0.12;
      if (e.position.y > fl) {
        sampleWaterCurrent(
          e.position.x,
          e.position.y,
          e.position.z,
          ctx.simTime,
          ctx.env.currentStrength,
          this._cur
        );
        e.position.x += this._cur.x * 0.22 * dt;
        e.position.z += this._cur.z * 0.22 * dt;
        clampToTankRadius(e.position, 0.8);
        e.position.y = Math.max(fl, e.position.y - 0.42 * dt);
      }
      // Egg swells gradually as the embryo develops inside, pulsing faster right before hatch
      const pulseFreq = 3.2 + prog * 4.5;
      const baseEggScale = 0.78 + prog * 0.34;
      e.scale = baseEggScale + Math.sin(ctx.simTime * pulseFreq + e.id) * (0.04 + prog * 0.05);
      ctx.enforceFiniteTransform(e);

      if (e.age >= e.incubateDuration) {
        if (ctx.animals.length < CAPS.maxAnimals) {
          // Eggs hatch directly into Larva (soft-bodied/chordate) or Instar (arthropod/carapaced)
          const hatchStage = getIntermediateStage(e.genome);
          const hatchling = ctx.spawnAnimal(
            e.genome,
            e.position.clone().add(new THREE.Vector3(0, 0.32, 0)),
            hatchStage
          );
          if (hatchling) hatchling.moltAnim = 0.85;
          ctx.events.emit('fx:burst', {
            position: e.position,
            colorHex: e.genome.glowHex,
            count: 8,
            speed: 1.45,
          });
        }
        ctx.disposeEntity(e);
        ctx.eggs.splice(i, 1);
      }
    }
  }

  private updatePropagules(ctx: SimulationContext, dt: number): void {
    for (let i = ctx.propagules.length - 1; i >= 0; i--) {
      const pr = ctx.propagules[i];
      if (!pr.alive) {
        ctx.propagules.splice(i, 1);
        continue;
      }
      pr.age += dt;

      sampleWaterCurrent(
        pr.position.x,
        pr.position.y,
        pr.position.z,
        ctx.simTime,
        ctx.env.currentStrength,
        this._cur
      );

      if (!pr.isSeed) {
        pr.velocity.x += (Math.sin(ctx.simTime * 0.8 + pr.id) * 0.2 + this._cur.x * 0.65) * dt;
        pr.velocity.z += (Math.cos(ctx.simTime * 0.7 + pr.id) * 0.2 + this._cur.z * 0.65) * dt;
        pr.velocity.y += (-0.12 + this._cur.y * 0.25) * dt;
      } else {
        pr.velocity.x += this._cur.x * 0.22 * dt;
        pr.velocity.z += this._cur.z * 0.22 * dt;
        pr.velocity.y -= 0.4 * dt;
      }

      // Gentle inward reef-eddy convergence when propagules drift past the soft reef horizon
      const prR = Math.hypot(pr.position.x, pr.position.z);
      const prBoundW = computeHorizontalBoundWeight(pr.position.x, pr.position.z);
      if (prBoundW > 0 && prR > 1e-4) {
        pr.velocity.x -= (pr.position.x / prR) * prBoundW * 0.75 * dt;
        pr.velocity.z -= (pr.position.z / prR) * prBoundW * 0.75 * dt;
      }

      pr.velocity.multiplyScalar(0.985);
      pr.position.addScaledVector(pr.velocity, dt);
      clampToTankRadius(pr.position, 0.9);
      pr.position.y = Math.min(TANK.waterY - 0.4, pr.position.y);
      ctx.enforceFiniteTransform(pr);

      const fl = getSeabedHeight(pr.position.x, pr.position.z) + 0.1;
      if (pr.position.y <= fl) {
        // Weight successful germination against settling beyond the invisible horizontal reef bounds
        if (
          ctx.plants.length < CAPS.maxPlants &&
          Math.random() <= computePlantPlacementWeight(pr.position.x, pr.position.z)
        ) {
          ctx.spawnPlant(pr.genome, pr.position.x, pr.position.z, 0.18);
          ctx.events.emit('fx:burst', {
            position: pr.position,
            colorHex: pr.genome.glowHex,
            count: 5,
            speed: 1.0,
          });
        }
        ctx.disposeEntity(pr);
        ctx.propagules.splice(i, 1);
      } else if (pr.age >= pr.maxAge) {
        ctx.disposeEntity(pr);
        ctx.propagules.splice(i, 1);
      }
    }
  }

  private settleFlatOnSeabed(
    q: THREE.Quaternion,
    x: number,
    z: number,
    isFlora: boolean,
    alpha: number
  ): void {
    const hL = getSeabedHeight(x - 0.16, z);
    const hR = getSeabedHeight(x + 0.16, z);
    const hD = getSeabedHeight(x, z - 0.16);
    const hU = getSeabedHeight(x, z + 0.16);
    this._bedNormal.set(hL - hR, 0.32, hD - hU).normalize();

    // Leaf ribbons lie flat when local +Z aligns with seabed normal; flesh/pellets use local +Y
    if (isFlora) this._flatAxis.set(0, 0, 1);
    else this._flatAxis.set(0, 1, 0);
    this._flatAxis.applyQuaternion(q).normalize();
    if (this._flatAxis.dot(this._bedNormal) < 0) {
      this._flatAxis.negate();
    }
    this._alignQ.setFromUnitVectors(this._flatAxis, this._bedNormal);
    this._targetQ.copy(this._alignQ).multiply(q);
    q.slerp(this._targetQ, clamp(alpha, 0, 1)).normalize();
  }

  private updateFoodPellets(ctx: SimulationContext, dt: number): void {
    for (let i = ctx.foodPellets.length - 1; i >= 0; i--) {
      const p = ctx.foodPellets[i];
      if (!p.alive) {
        ctx.foodPellets.splice(i, 1);
        continue;
      }
      p.age += dt;
      const isFlora = p.origin === 'flora';
      const isFlesh = p.origin === 'flesh';
      const restClearance = isFlora ? 0.045 : isFlesh ? 0.075 : 0.085;
      const fl = getSeabedHeight(p.position.x, p.position.z) + restClearance;
      const nutRatio = clamp(safeRatio(p.nutrients, Math.max(1, p.maxNutrients)), 0.18, 1.0);
      const massScale = p.baseScale * (0.48 + 0.52 * Math.pow(nutRatio, 0.65));

      // If a scavenger/predator bite jolted a resting piece upward off the seabed, let it tumble & re-settle
      if (p.phase !== 'sinking' && (p.position.y > fl + 0.06 || p.velocity.y > 0.18)) {
        p.phase = 'sinking';
        p.state = 'Sinking';
      }

      if (p.phase === 'sinking') {
        p.state = 'Sinking';
        p.opacity = 1.0;
        p.scale = Math.max(0.12, massScale);

        sampleWaterCurrent(
          p.position.x,
          p.position.y,
          p.position.z,
          ctx.simTime,
          ctx.env.currentStrength,
          this._cur
        );

        // Torn flora ribbons flutter slowly; flesh chunks sink gently so predators & scavengers can snatch them mid-water!
        const currentMult = isFlora ? 0.78 : isFlesh ? 0.42 : 0.34;
        const sinkAccel = isFlora ? 0.17 : isFlesh ? 0.34 : 0.58;
        const maxSink = isFlora ? -0.36 : isFlesh ? -0.68 : -1.08;

        p.velocity.x += this._cur.x * currentMult * dt;
        p.velocity.z += this._cur.z * currentMult * dt;
        p.velocity.y += this._cur.y * (isFlora ? 0.32 : 0.16) * dt;
        if (isFlora) {
          p.velocity.x += Math.sin(ctx.simTime * 2.9 + p.id) * 0.28 * dt;
          p.velocity.z += Math.cos(ctx.simTime * 2.4 + p.id) * 0.28 * dt;
          p.angularVelocity.x += Math.cos(ctx.simTime * 3.1 + p.id) * 1.4 * dt;
          p.angularVelocity.z += Math.sin(ctx.simTime * 2.7 + p.id) * 1.4 * dt;
        } else if (isFlesh) {
          // Subtle hydrodynamic sway as irregular flesh chunk sinks
          p.velocity.x += Math.sin(ctx.simTime * 1.8 + p.id) * 0.08 * dt;
          p.velocity.z += Math.cos(ctx.simTime * 1.5 + p.id) * 0.08 * dt;
        }

        p.velocity.y = clamp(p.velocity.y - sinkAccel * dt, maxSink, 0.75);
        const drag = Math.exp(-(isFlora ? 2.1 : 1.55) * dt);
        p.velocity.x *= drag;
        p.velocity.z *= drag;
        p.position.addScaledVector(p.velocity, dt);

        // Integrate real 3D tumbling spin while sinking
        const angSpd = p.angularVelocity.length();
        if (angSpd > 1e-4) {
          this._spinAxis.copy(p.angularVelocity).divideScalar(angSpd);
          this._rollQ.setFromAxisAngle(this._spinAxis, angSpd * dt);
          p.quaternion.premultiply(this._rollQ).normalize();
        }
        p.angularVelocity.multiplyScalar(Math.exp(-(isFlora ? 1.15 : 0.95) * dt));

        if (p.position.y <= fl) {
          p.position.y = fl;
          p.velocity.x *= 0.28;
          p.velocity.z *= 0.28;
          p.velocity.y = 0;
          p.angularVelocity.multiplyScalar(0.25);
          p.phase = p.dissolveAge > 0 ? 'dissolving' : 'resting';
          p.state = p.phase === 'dissolving' ? 'Dissolving' : 'Resting';
        }
      } else if (p.phase === 'resting') {
        // Remains intact on the bottom unless eaten, only slowly entering dissolution after restingDuration
        p.restingAge += dt;
        p.state = 'Resting';
        p.opacity = 1.0;
        p.scale = Math.max(0.12, massScale);

        // Dampen any bite nudge sliding/tumble smoothly onto the sand
        p.velocity.multiplyScalar(Math.exp(-5.5 * dt));
        p.position.x += p.velocity.x * dt;
        p.position.z += p.velocity.z * dt;
        p.position.y = getSeabedHeight(p.position.x, p.position.z) + restClearance;
        p.angularVelocity.multiplyScalar(Math.exp(-6.0 * dt));

        const angSpd = p.angularVelocity.length();
        if (angSpd > 0.02) {
          this._spinAxis.copy(p.angularVelocity).divideScalar(angSpd);
          this._rollQ.setFromAxisAngle(this._spinAxis, angSpd * dt);
          p.quaternion.premultiply(this._rollQ).normalize();
        }
        // Smoothly settle flat against the local seabed slope
        this.settleFlatOnSeabed(p.quaternion, p.position.x, p.position.z, isFlora, dt * 3.5);

        if (p.restingAge >= p.restingDuration) {
          p.phase = 'dissolving';
          p.state = 'Dissolving';
        }
      } else {
        // Very slow dissolution on the seabed over dissolveDuration unless eaten by scavengers
        p.dissolveAge += dt;
        p.state = 'Dissolving';
        const prog = clamp(p.dissolveAge / Math.max(1.0, p.dissolveDuration), 0, 1);

        // Gradually leach remaining nutrients as the piece slowly dissolves into sediment
        const leachRate = (p.maxNutrients / Math.max(1.0, p.dissolveDuration)) * 0.72;
        p.nutrients = Math.max(0, p.nutrients - leachRate * dt);

        p.velocity.multiplyScalar(Math.exp(-6.0 * dt));
        p.position.x += p.velocity.x * dt;
        p.position.z += p.velocity.z * dt;
        const curFl = getSeabedHeight(p.position.x, p.position.z) + restClearance;
        p.position.y = curFl - prog * 0.055;
        this.settleFlatOnSeabed(p.quaternion, p.position.x, p.position.z, isFlora, dt * 2.5);

        p.scale = Math.max(0.05, massScale * (1.0 - prog * 0.68));
        p.opacity = clamp(1.0 - prog * 0.88, 0.08, 1.0);

        // Occasional delicate dissolution wisp rising off slowly decaying seabed pieces
        p.detritusTimer -= dt;
        if (p.detritusTimer <= 0) {
          p.detritusTimer = randRange(5.0, 8.5);
          ctx.events.emit('fx:burst', {
            position: p.position.clone().add(new THREE.Vector3(0, 0.06, 0)),
            colorHex: isFlora ? 0x52d6a0 : 0x6ec9b8,
            count: 1,
            speed: 0.28,
          });
        }

        if (prog >= 1.0) {
          ctx.spawnNutrientPatch(p.position.x, p.position.z, isFlesh ? 0.58 : 0.45);
          ctx.disposeEntity(p);
          ctx.foodPellets.splice(i, 1);
          continue;
        }
      }

      clampToTankRadius(p.position, 0.7);
      p.position.y = Math.min(TANK.waterY - 0.35, p.position.y);
      ctx.enforceFiniteTransform(p);
    }
  }

  private updateCorpses(ctx: SimulationContext, dt: number): void {
    for (let i = ctx.corpses.length - 1; i >= 0; i--) {
      const c = ctx.corpses[i];
      if (!c.alive) {
        ctx.corpses.splice(i, 1);
        continue;
      }
      c.corpseAge += dt;
      c.joltAnim = Math.max(0, c.joltAnim - dt * 2.5);
      const fl = getSeabedHeight(c.position.x, c.position.z) + 0.16;
      const nr = safeRatio(c.nutrients, c.maxNutrients);

      if (c.phase === 'dying') {
        c.dyingAge += dt;
        c.stage = 'Dying';
        c.state = 'Dying';
        c.velocity.multiplyScalar(Math.exp(-2.2 * dt));
        c.position.addScaledVector(c.velocity, dt);
        this._rollQ.setFromAxisAngle(this._axisZ, c.rollSign * dt * 1.15);
        c.quaternion.multiply(this._rollQ);
        c.scale = Math.max(0.08, c.initialScale * (0.55 + 0.45 * nr));
        if (c.dyingAge >= c.dyingDuration) c.phase = 'sinking_corpse';
      } else if (c.phase === 'sinking_corpse') {
        c.stage = 'Sinking Corpse';
        c.state = 'Sinking';
        c.velocity.y = clamp(c.velocity.y - 0.95 * dt, -1.3, 0.5);
        c.velocity.x *= Math.exp(-1.2 * dt);
        c.velocity.z *= Math.exp(-1.2 * dt);
        c.position.addScaledVector(c.velocity, dt);
        c.position.x += Math.sin(ctx.simTime * 1.4 + c.id) * 0.12 * dt;
        this._rollQ.setFromAxisAngle(this._axisZ, c.rollSign * dt * (0.52 + c.joltAnim * 1.4));
        c.quaternion.multiply(this._rollQ);
        this._rollQ.setFromAxisAngle(this._axisX, dt * 0.2);
        c.quaternion.multiply(this._rollQ);
        c.scale = Math.max(0.08, c.initialScale * (0.50 + 0.50 * nr));
        if (c.position.y <= fl) {
          c.position.y = fl;
          c.velocity.set(0, 0, 0);
          c.phase = 'decomposing';
        }
      } else if (c.phase === 'decomposing') {
        c.decomposeAge += dt;
        c.stage = 'Decomposing';
        c.state = 'Decomposing';
        // Allow scavenger bites to physically nudge, shift, and rock the resting corpse on the seabed!
        c.velocity.multiplyScalar(Math.exp(-4.5 * dt));
        c.position.x += c.velocity.x * dt;
        c.position.z += c.velocity.z * dt;
        c.position.y = fl + Math.max(0, c.velocity.y * 0.12);
        if (c.joltAnim > 0.05) {
          this._rollQ.setFromAxisAngle(this._axisZ, c.rollSign * dt * c.joltAnim * 1.1);
          c.quaternion.multiply(this._rollQ);
        }
        c.scale = Math.max(0.08, c.initialScale * (0.45 + 0.55 * nr));

        c.detritusTimer -= dt;
        if (c.detritusTimer <= 0) {
          c.detritusTimer = randRange(1.2, 2.2);
          ctx.events.emit('fx:burst', {
            position: c.position.clone().add(new THREE.Vector3(0, 0.12, 0)),
            colorHex: 0x62d9b8,
            count: 2,
            speed: 0.45,
          });
        }
        if (c.nutrients <= 1.0 || c.decomposeAge >= c.decomposeDuration) {
          c.phase = 'dissolving';
          c.dissolveAge = 0;
          ctx.spawnNutrientPatch(c.position.x, c.position.z, 1.15);
        }
      } else {
        c.dissolveAge += dt;
        c.stage = 'Dissolving';
        c.state = 'Dissolving';
        const prog = clamp(c.dissolveAge / Math.max(0.1, c.dissolveDuration), 0, 1);
        c.position.y = fl - prog * 0.22;
        c.scale = Math.max(0.02, c.initialScale * 0.45 * (1.0 - prog * 0.88));
        c.opacity = clamp(1.0 - prog, 0, 1);
        if (prog >= 1.0) {
          ctx.disposeEntity(c);
          ctx.corpses.splice(i, 1);
          continue;
        }
      }

      clampToTankRadius(c.position, 0.6);
      c.position.y = clamp(c.position.y, fl - 0.28, TANK.waterY - 0.45);
      ctx.enforceFiniteTransform(c);
    }
  }

  private updateNutrientPatches(ctx: SimulationContext, dt: number): void {
    for (let i = ctx.nutrientPatches.length - 1; i >= 0; i--) {
      const np = ctx.nutrientPatches[i];
      np.age += dt;
      if (np.age >= np.maxAge || np.nutrients <= 1.0) {
        np.alive = false;
        ctx.nutrientPatches.splice(i, 1);
      }
    }
  }
}
