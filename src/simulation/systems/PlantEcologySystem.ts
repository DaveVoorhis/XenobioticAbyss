import * as THREE from 'three';
import { CAPS, TANK } from '../../core/config';
import {
  clamp,
  computeDaylightFactor,
  computePlantPlacementWeight,
  randRange,
  safeNormalize,
  safeRatio,
} from '../../core/math';
import { recombinePlantGenomes } from '../../genetics/PlantGenetics';
import type { AnimalEntity, PlantEntity } from '../types';
import type { SimulationContext } from '../SimulationEngine';

export class PlantEcologySystem {
  private readonly _qAnimals: AnimalEntity[] = [];
  private readonly _qPlants: PlantEntity[] = [];
  private readonly _pullDir = new THREE.Vector3();
  private readonly _oralPos = new THREE.Vector3();
  private readonly _scrapVel = new THREE.Vector3();

  update(ctx: SimulationContext, dt: number): void {
    const daylight = computeDaylightFactor(ctx.env.timeOfDay);

    for (let i = ctx.plants.length - 1; i >= 0; i--) {
      const p = ctx.plants[i];
      if (!p.alive) {
        ctx.plants.splice(i, 1);
        continue;
      }

      const g = p.genome;
      p.age += dt;
      const swayBoost = 1.0 + ctx.env.currentStrength * 0.45;
      p.swayPhase = (p.swayPhase + dt * g.swayFreq * swayBoost) % (Math.PI * 200);
      p.snareAnim = Math.max(0, p.snareAnim - dt * 1.15);
      p.rustleAnim = Math.max(0, p.rustleAnim - dt * 1.9);

      if (p.wilting) {
        p.wiltAge += dt;
        p.stage = 'Wilting';
        p.state = 'Decomposing';
        const prog = clamp(p.wiltAge / Math.max(0.1, p.wiltDuration), 0, 1);
        p.wiltTilt = prog * 0.68;
        p.opacity = clamp(1.0 - prog, 0, 1);
        p.scale = Math.max(0.02, (1.0 - prog * 0.86) * p.growth * g.maxHeight * 0.56);

        if (Math.random() < dt * 1.4) {
          ctx.events.emit('fx:burst', {
            position: p.position.clone().add(new THREE.Vector3(0, 0.3, 0)),
            colorHex: 0x42e8a8,
            count: 1,
            speed: 0.55,
          });
        }
        if (prog >= 1.0) {
          ctx.spawnNutrientPatch(p.position.x, p.position.z, 0.9);
          ctx.disposeEntity(p);
          ctx.plants.splice(i, 1);
        }
        continue;
      }

      if (p.biomass <= 1.0 || p.age >= g.maxAge) {
        p.wilting = true;
        p.wiltAge = 0;
        continue;
      }

      const nutEff = g.nutrientEfficiency ?? 1.0;
      const lightMult =
        (g.leafMorphology === 'broad_blade' ? 1.2 : g.leafMorphology === 'crystalline_lattice' ? 0.92 : 1.0) *
        (g.rootSystem === 'pneumatocyst_float' ? 1.14 : 1.0);

      let gain = 0;
      if (g.metabolism === 'Photosynthetic') {
        gain = (0.65 + 2.35 * daylight) * lightMult;
      } else if (g.metabolism === 'Chemosynthetic') {
        const vd = Math.hypot(p.position.x - TANK.ventPos.x, p.position.z - TANK.ventPos.z);
        gain = (1.45 + 3.5 * Math.exp(-(vd * vd) / 38.0)) * nutEff;
      } else if (g.metabolism === 'Mixotrophic') {
        // Hybrid generalist: harvests both sunlight and background geothermal/mineral flux
        const vd = Math.hypot(p.position.x - TANK.ventPos.x, p.position.z - TANK.ventPos.z);
        gain = (0.85 + 1.45 * daylight) * lightMult + 1.55 * Math.exp(-(vd * vd) / 56.0) * nutEff;
      } else if (g.metabolism === 'Detritivore_Fungi') {
        // Thrives by recycling decomposing seabed patches, nearby carcasses, and dissolving seabed scraps
        gain = 1.15 * nutEff;
        let foundDetritus = false;
        for (let c = 0; c < ctx.corpses.length; c++) {
          const co = ctx.corpses[c];
          if (!co.alive) continue;
          if (p.position.distanceToSquared(co.position) < 12.0) {
            gain += 2.2 * nutEff;
            foundDetritus = true;
            break;
          }
        }
        if (!foundDetritus) {
          for (let f = 0; f < ctx.foodPellets.length; f++) {
            const pel = ctx.foodPellets[f];
            if (!pel.alive || pel.phase === 'sinking') continue;
            if (p.position.distanceToSquared(pel.position) < 9.0) {
              gain += (pel.phase === 'dissolving' ? 1.45 : 0.75) * nutEff;
              break;
            }
          }
        }
      } else {
        // Carnivorous Flora (tendril_anemone): actively pulls snared prey inward & tears intact chunks!
        gain = 1.05;
        p.snareCooldown = Math.max(0, p.snareCooldown - dt);
        if (p.snareCooldown <= 0) {
          this._oralPos.set(p.position.x, p.position.y + 0.58 * p.scale, p.position.z);
          const snareRadius = 1.65 * clamp(g.canopySpread ?? 1.0, 0.8, 1.35);
          const near = ctx.animalGrid.query(
            this._oralPos.x,
            this._oralPos.y,
            this._oralPos.z,
            snareRadius,
            this._qAnimals
          );
          for (let j = 0; j < near.length; j++) {
            const v = near[j];
            if (!v.alive || v.scale > 0.62) continue;
            const preyResist =
              (v.genome.physiology === 'toxin_resistant' ? 0.65 : 1.0) *
              (1.0 - clamp((v.genome.armorDensity ?? 0) * 0.35, 0, 0.35));
            v.hp -= 16 * (0.85 + (g.toxicity ?? 0.3) * 0.45) * preyResist;
            v.hitFlash = 0.32;
            v.thrashAnim = 0.85;

            // Physically yank struggling prey inward toward the anemone's oral disc!
            this._pullDir.subVectors(this._oralPos, v.position);
            if (safeNormalize(this._pullDir)) {
              v.velocity.multiplyScalar(0.25).addScaledVector(this._pullDir, 2.1);
            }

            p.biomass = Math.min(p.maxBiomass, p.biomass + 24);
            p.snareCooldown = 3.2;
            p.snareAnim = 1.0;
            p.rustleAnim = 0.85;
            p.state = 'Snaring Prey';

            ctx.events.emit('fx:fragments', {
              position: v.position.clone(),
              colorHex: v.genome.baseHex,
              accentHex: v.genome.accentHex,
              kind: 'flesh',
              count: 5,
              speed: 1.45,
              suctionTarget: this._oralPos.clone(),
            });
            ctx.events.emit('fx:burst', {
              position: v.position.clone(),
              colorHex: 0xff52b4,
              count: 6,
              speed: 1.4,
            });
            ctx.events.emit('audio:cue', { type: 'strike' });

            // Rip loose 1-2 intact edible flesh chunks that drift/sink around the anemone for scavengers!
            const pieceCount = v.hp <= 0 ? 2 : 1;
            for (let s = 0; s < pieceCount; s++) {
              this._scrapVel.set(randRange(-0.9, 0.9), randRange(0.25, 0.72), randRange(-0.9, 0.9));
              ctx.spawnTornMorsel(
                v.position,
                this._scrapVel,
                s % 2 === 0 ? v.genome.baseHex : v.genome.accentHex,
                'flesh',
                randRange(10, 16),
                clamp(0.75 + v.genome.sizeScale * 0.4, 0.75, 1.2),
                v.genome.speciesName
              );
            }

            if (v.hp <= 0) {
              ctx.log(
                `${g.speciesName} snared ${v.genome.speciesName}`,
                'predation',
                'text-fuchsia-300'
              );
              ctx.transitionAnimalToCorpse(v, `snared by ${g.speciesName}`);
            }
            break;
          }
        }
      }

      // Morphological & defense physiological bonuses / maintenance trade-offs
      if (g.leafMorphology === 'feathered_plume') {
        gain += 0.38 * ctx.env.currentStrength * nutEff;
      }
      if (g.defense === 'mucus_sheath') {
        gain += 0.22;
      }
      // Evolutionary maintenance cost of producing alkaloid toxins or heavy calcified thorns
      const defenseTax =
        (g.toxicity ?? 0) * 0.24 +
        (g.defense === 'calcified_thorns' ? 0.16 : g.defense === 'alkaloid_toxin' ? 0.14 : 0);
      gain = Math.max(0.18, gain - defenseTax);
      // Subtle reef-core habitat fertility weighting (lush reef heart, sparse distant sand)
      const habitatWeight = computePlantPlacementWeight(p.position.x, p.position.z);
      gain *= 0.58 + 0.42 * habitatWeight;

      // Absorb decomposing seabed nutrient patches (deep_rhizome reaches 1.75x farther!)
      const patchRangeSq = g.rootSystem === 'deep_rhizome' ? 19.0 : 6.8;
      const patchMult = g.metabolism === 'Detritivore_Fungi' ? 2.25 : 1.0;
      for (let j = 0; j < ctx.nutrientPatches.length; j++) {
        const np = ctx.nutrientPatches[j];
        if (!np.alive) continue;
        if (p.position.distanceToSquared(np.position) < patchRangeSq) {
          gain += 1.65 * nutEff * patchMult;
          np.nutrients = Math.max(0, np.nutrients - 1.35 * dt);
          break;
        }
      }

      // Symbiotic mycelia root networks exchange minerals with neighboring flora
      if (g.rootSystem === 'symbiotic_mycelia') {
        const neighbors = ctx.plantGrid.query(
          p.position.x,
          p.position.y,
          p.position.z,
          4.2,
          this._qPlants
        );
        let kin = 0;
        for (let k = 0; k < neighbors.length; k++) {
          if (neighbors[k] !== p && neighbors[k].alive && !neighbors[k].wilting) kin++;
        }
        gain += Math.min(kin, 3) * 0.32 * nutEff;
      }

      p.biomass = clamp(p.biomass + gain * dt, 0, p.maxBiomass);
      p.growth = clamp(p.growth + dt * 0.023 * (p.biomass / 60), 0.16, 1.0);
      p.stage = p.growth < 0.36 ? 'Sprout' : p.growth < 0.72 ? 'Sapling' : 'Mature';
      if (p.snareCooldown <= 2.3) p.state = g.metabolism.replace(/_/g, ' ');

      const heightFloatMult = g.rootSystem === 'pneumatocyst_float' ? 1.12 : 1.0;
      p.scale = Math.max(
        0.09,
        p.growth *
          g.maxHeight *
          heightFloatMult *
          0.56 *
          (0.55 + 0.45 * safeRatio(p.biomass, p.maxBiomass))
      );

      p.seedCooldown -= dt;
      if (
        p.seedCooldown <= 0 &&
        p.stage === 'Mature' &&
        p.biomass > 72 &&
        ctx.plants.length < CAPS.maxPlants
      ) {
        p.seedCooldown = randRange(23, 37);
        p.biomass -= 18;
        p.offspringCount++;

        // Cross-pollination: find a nearby mature plant to sexually recombine traits with!
        let pollenDonor: PlantEntity | null = null;
        const nearbyFlora = ctx.plantGrid.query(
          p.position.x,
          p.position.y,
          p.position.z,
          6.8,
          this._qPlants
        );
        for (let k = 0; k < nearbyFlora.length; k++) {
          const cand = nearbyFlora[k];
          if (cand === p || !cand.alive || cand.wilting || cand.stage !== 'Mature') continue;
          if (cand.genome.speciesId === g.speciesId || cand.genome.form === g.form) {
            pollenDonor = cand;
            break;
          }
        }

        const { genome: cg, speciated } = recombinePlantGenomes(
          g,
          pollenDonor?.genome ?? null,
          ctx.env.mutationRateMultiplier
        );
        if (speciated) {
          ctx.log(
            `${pollenDonor ? 'Hybrid flora' : 'Flora mutation'}: ${cg.speciesName}`,
            'speciation',
            'text-emerald-300'
          );
        }

        if (g.propagation === 'Budding') {
          let bx = p.position.x + randRange(-1.85, 1.85);
          let bz = p.position.z + randRange(-1.85, 1.85);
          const br = Math.hypot(bx, bz);
          if (br > TANK.coreRadius && br > 1e-4) {
            // Bias peripheral buds subtly back toward nutrient-rich reef sediment
            const pull = Math.min(1.1, (br - TANK.coreRadius) * 0.35);
            bx -= (bx / br) * pull;
            bz -= (bz / br) * pull;
          }
          if (Math.random() <= computePlantPlacementWeight(bx, bz)) {
            ctx.spawnPlant(cg, bx, bz, 0.22);
          }
        } else if (g.propagation === 'Rhizome_Runners') {
          // Stolon runner spreads into fresh territory, weighted against leaving the reef oasis
          const ang = randRange(0, Math.PI * 2);
          const dist = randRange(1.7, 3.1);
          let rx = p.position.x + Math.cos(ang) * dist;
          let rz = p.position.z + Math.sin(ang) * dist;
          const rr = Math.hypot(rx, rz);
          if (rr > TANK.coreRadius && rr > 1e-4) {
            const pull = Math.min(1.6, (rr - TANK.coreRadius) * 0.45);
            rx -= (rx / rr) * pull;
            rz -= (rz / rr) * pull;
          }
          if (Math.random() <= computePlantPlacementWeight(rx, rz)) {
            ctx.spawnPlant(cg, rx, rz, 0.24);
          }
        } else if (g.propagation === 'Explosive_Pods') {
          // Launches a cluster of buoyant spores outward from the canopy
          const top = p.position.clone().add(new THREE.Vector3(0, g.maxHeight * p.growth * 0.65, 0));
          ctx.events.emit('fx:burst', {
            position: top.clone(),
            colorHex: g.glowHex,
            count: 9,
            speed: 2.0,
          });
          const pods = 2;
          for (let s = 0; s < pods; s++) {
            const offset = new THREE.Vector3(randRange(-0.45, 0.45), randRange(0.05, 0.3), randRange(-0.45, 0.45));
            ctx.spawnPropagule(cg, top.clone().add(offset), false);
          }
        } else {
          const top = p.position.clone().add(new THREE.Vector3(0, g.maxHeight * p.growth * 0.62, 0));
          ctx.spawnPropagule(cg, top, g.propagation === 'Weighted_Seeds');
        }
      }
    }
  }
}
