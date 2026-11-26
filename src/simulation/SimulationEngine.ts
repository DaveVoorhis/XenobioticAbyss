import * as THREE from 'three';
import {
  CAPS,
  DEFAULT_ENV_PARAMS,
  ECOSYSTEM_PRESETS,
  TANK,
  type EcosystemPresetId,
  type EnvironmentParameters,
} from '../core/config';
import { EventBus, type FragmentKind, type LogCategory } from '../core/EventBus';
import { SpatialHashGrid } from '../core/SpatialHashGrid';
import {
  clamp,
  clampToTankRadius,
  clampXZToTankRadius,
  getSeabedHeight,
  isFiniteVec3,
  randomWeightedPointInReef,
  randRange,
  safeNormalize,
  safeOrientToward,
} from '../core/math';
import {
  createAnimalGenome,
  normalizeAnimalGenome,
  recombineAnimalGenomes,
} from '../genetics/AnimalGenetics';
import {
  createPlantGenome,
  mutatePlantGenome,
  normalizePlantGenome,
} from '../genetics/PlantGenetics';
import {
  SpeciesRegistry,
  allocateEntityId,
  resetIdCounters,
  syncIdCounters,
} from '../genetics/taxonomy';
import type {
  AnimalBodyPlan,
  AnimalDiet,
  AnimalGenome,
  PlantForm,
  PlantGenome,
  PlantMetabolism,
} from '../genetics/types';
import { AnimalBehaviorSystem } from './systems/AnimalBehaviorSystem';
import { LifecycleSystem } from './systems/LifecycleSystem';
import { PlantEcologySystem } from './systems/PlantEcologySystem';
import {
  computeStageMaxHp,
  computeStageScale,
  getInitialMaturityForStage,
  getInstarRank,
  getIntermediateStage,
  getLifeStageFromMaturity,
  getStageDisplayLabel,
} from './lifecycle';
import type {
  AnimalEntity,
  AnimalLifeStage,
  CorpseEntity,
  EggEntity,
  Entity,
  FoodPelletEntity,
  NutrientPatch,
  PlantEntity,
  PopulationSample,
  PropaguleEntity,
  SimulationSnapshot,
} from './types';

export interface SeedPresetOptions {
  /**
   * When true, initial fauna emerge in staggered waves directly out of the
   * hydrothermal Genesis Vent rather than appearing pre-scattered in the reef.
   */
  emergeFromVent?: boolean;
}

interface PendingVentSpawn {
  delay: number;
  genome: AnimalGenome;
  stage: AnimalLifeStage;
  azimuth: number;
  waveStart: boolean;
  spawnEgg: boolean;
}

export interface SimulationContext {
  readonly simTime: number;
  readonly env: EnvironmentParameters;
  readonly events: EventBus;
  readonly animals: AnimalEntity[];
  readonly plants: PlantEntity[];
  readonly eggs: EggEntity[];
  readonly propagules: PropaguleEntity[];
  readonly corpses: CorpseEntity[];
  readonly foodPellets: FoodPelletEntity[];
  readonly nutrientPatches: NutrientPatch[];
  readonly animalGrid: SpatialHashGrid<AnimalEntity>;
  readonly plantGrid: SpatialHashGrid<PlantEntity>;
  readonly foodGrid: SpatialHashGrid<Entity>;
  spawnAnimal(
    genome: AnimalGenome,
    position: THREE.Vector3,
    initialStage?: boolean | AnimalLifeStage
  ): AnimalEntity | null;
  spawnPlant(genome: PlantGenome, x: number, z: number, initialGrowth?: number): PlantEntity | null;
  spawnEgg(genome: AnimalGenome, position: THREE.Vector3): EggEntity | null;
  spawnPropagule(genome: PlantGenome, position: THREE.Vector3, isSeed: boolean): PropaguleEntity | null;
  spawnTornMorsel(
    position: THREE.Vector3,
    velocity: THREE.Vector3,
    colorHex: number,
    origin: FragmentKind,
    nutrients?: number,
    scaleMult?: number,
    sourceSpecies?: string
  ): FoodPelletEntity | null;
  spawnNutrientPatch(x: number, z: number, strength?: number): void;
  transitionAnimalToCorpse(animal: AnimalEntity, cause?: string): CorpseEntity | null;
  disposeEntity(entity: Entity): void;
  enforceFiniteTransform(entity: Entity): void;
  log(message: string, category: LogCategory, toneClass?: string): void;
}

export class SimulationEngine implements SimulationContext {
  simTime = 0;
  simSpeed = 1.0;
  readonly env: EnvironmentParameters = { ...DEFAULT_ENV_PARAMS };
  readonly events: EventBus;
  readonly speciesRegistry = new SpeciesRegistry();

  readonly animals: AnimalEntity[] = [];
  readonly plants: PlantEntity[] = [];
  readonly eggs: EggEntity[] = [];
  readonly propagules: PropaguleEntity[] = [];
  readonly corpses: CorpseEntity[] = [];
  readonly foodPellets: FoodPelletEntity[] = [];
  readonly nutrientPatches: NutrientPatch[] = [];

  readonly animalGrid = new SpatialHashGrid<AnimalEntity>(3.2);
  readonly plantGrid = new SpatialHashGrid<PlantEntity>(3.2);
  readonly foodGrid = new SpatialHashGrid<Entity>(3.2);

  readonly history: PopulationSample[] = [];
  genesisCountdown = 18.0;
  ventPulseEnergy = 0.0;

  private genesisToggle = 0;
  private lastHistoryT = 0;
  private lastSpeciesRecomputeT = 0;
  private readonly pendingVentSpawns: PendingVentSpawn[] = [];
  private ventSpawnTimer = 0;
  private ventInitialBuildUp = false;
  private ventAzimuthCursor = 0;

  private readonly animalBehavior = new AnimalBehaviorSystem();
  private readonly plantEcology = new PlantEcologySystem();
  private readonly lifecycle = new LifecycleSystem();

  constructor(events: EventBus = new EventBus()) {
    this.events = events;
    TANK.ventPos.y = getSeabedHeight(TANK.ventPos.x, TANK.ventPos.z);
  }

  isInitialVentGenesisActive(): boolean {
    return this.pendingVentSpawns.length > 0;
  }

  log(message: string, category: LogCategory, toneClass = 'text-cyan-100'): void {
    this.events.emit('log', { message, category, toneClass });
  }

  clearAll(): void {
    const all: Entity[] = [
      ...this.animals,
      ...this.plants,
      ...this.eggs,
      ...this.propagules,
      ...this.corpses,
      ...this.foodPellets,
    ];
    for (const e of all) {
      e.alive = false;
      this.events.emit('entity:disposed', { entity: e });
    }
    this.animals.length = 0;
    this.plants.length = 0;
    this.eggs.length = 0;
    this.propagules.length = 0;
    this.corpses.length = 0;
    this.foodPellets.length = 0;
    this.nutrientPatches.length = 0;
    this.history.length = 0;
    this.speciesRegistry.clear();
    resetIdCounters();
    this.simTime = 0;
    this.lastHistoryT = 0;
    this.lastSpeciesRecomputeT = 0;
    this.genesisCountdown = this.env.genesisInterval * 0.82;
    this.ventPulseEnergy = 0.0;
    this.pendingVentSpawns.length = 0;
    this.ventSpawnTimer = 0;
    this.ventInitialBuildUp = false;
    this.events.emit('ecosystem:reset', {});
  }

  seedPreset(
    presetId: EcosystemPresetId = 'balanced_reef',
    options: SeedPresetOptions = {}
  ): void {
    this.clearAll();
    const presetMeta = ECOSYSTEM_PRESETS.find((p) => p.id === presetId) ?? ECOSYSTEM_PRESETS[0];
    this.env.timeOfDay = presetMeta.timeOfDay;
    this.env.currentStrength = presetMeta.currentStrength;

    let plantSpecs: Array<{ met: PlantMetabolism; form: PlantForm; n: number }>;
    let animalSpecs: Array<{ diet: AnimalDiet; plan: AnimalBodyPlan; n: number }>;

    if (presetId === 'abyssal_predators') {
      plantSpecs = [
        { met: 'Chemosynthetic', form: 'bioluminescent_bulb', n: 5 },
        { met: 'Chemosynthetic', form: 'crystal_sponge', n: 5 },
        { met: 'Detritivore_Fungi', form: 'spore_stalk', n: 4 },
        { met: 'Carnivorous_Flora', form: 'tendril_anemone', n: 5 },
        { met: 'Mixotrophic', form: 'spiral_kelp', n: 4 },
      ];
      animalSpecs = [
        { diet: 'Herbivore', plan: 'fusiform_swimmer', n: 6 },
        { diet: 'Filter_Feeder', plan: 'radial_medusa', n: 5 },
        { diet: 'Scavenger', plan: 'armored_trilopod', n: 6 },
        { diet: 'Omnivore', plan: 'segmented_eel', n: 5 },
        { diet: 'Carnivore', plan: 'fusiform_swimmer', n: 5 },
        { diet: 'Carnivore', plan: 'winged_manta', n: 4 },
      ];
    } else if (presetId === 'bioluminescent_garden') {
      plantSpecs = [
        { met: 'Photosynthetic', form: 'spiral_kelp', n: 6 },
        { met: 'Photosynthetic', form: 'ribbon_seagrass', n: 6 },
        { met: 'Chemosynthetic', form: 'bioluminescent_bulb', n: 6 },
        { met: 'Mixotrophic', form: 'crystal_sponge', n: 5 },
        { met: 'Detritivore_Fungi', form: 'spore_stalk', n: 5 },
        { met: 'Photosynthetic', form: 'coral_fan', n: 4 },
        { met: 'Carnivorous_Flora', form: 'tendril_anemone', n: 3 },
      ];
      animalSpecs = [
        { diet: 'Filter_Feeder', plan: 'radial_medusa', n: 8 },
        { diet: 'Herbivore', plan: 'winged_manta', n: 6 },
        { diet: 'Herbivore', plan: 'fusiform_swimmer', n: 6 },
        { diet: 'Scavenger', plan: 'armored_trilopod', n: 4 },
        { diet: 'Omnivore', plan: 'segmented_eel', n: 4 },
        { diet: 'Carnivore', plan: 'fusiform_swimmer', n: 2 },
      ];
    } else {
      plantSpecs = [
        { met: 'Photosynthetic', form: 'spiral_kelp', n: 5 },
        { met: 'Photosynthetic', form: 'ribbon_seagrass', n: 5 },
        { met: 'Mixotrophic', form: 'coral_fan', n: 4 },
        { met: 'Detritivore_Fungi', form: 'spore_stalk', n: 4 },
        { met: 'Chemosynthetic', form: 'bioluminescent_bulb', n: 4 },
        { met: 'Chemosynthetic', form: 'crystal_sponge', n: 4 },
        { met: 'Carnivorous_Flora', form: 'tendril_anemone', n: 4 },
      ];
      animalSpecs = [
        { diet: 'Herbivore', plan: 'fusiform_swimmer', n: 6 },
        { diet: 'Herbivore', plan: 'winged_manta', n: 4 },
        { diet: 'Filter_Feeder', plan: 'radial_medusa', n: 5 },
        { diet: 'Omnivore', plan: 'segmented_eel', n: 4 },
        { diet: 'Scavenger', plan: 'armored_trilopod', n: 4 },
        { diet: 'Carnivore', plan: 'fusiform_swimmer', n: 4 },
        { diet: 'Carnivore', plan: 'winged_manta', n: 3 },
      ];
    }

    for (const ps of plantSpecs) {
      const g = createPlantGenome(ps.met, ps.form);
      for (let k = 0; k < ps.n; k++) {
        let px: number;
        let pz: number;
        if (ps.met === 'Chemosynthetic') {
          [px, pz] = clampXZToTankRadius(
            TANK.ventPos.x + randRange(-4.4, 4.4),
            TANK.ventPos.z + randRange(-3.8, 3.8),
            1.4
          );
        } else {
          // Center-weighted reef placement: lush flora in core reef, tapering softly toward invisible horizon
          const pt = randomWeightedPointInReef(TANK.coreRadius, TANK.radius);
          px = pt.x;
          pz = pt.z;
        }
        this.spawnPlant(g, px, pz, randRange(0.55, 1.0));
      }
    }

    if (options.emergeFromVent) {
      const reefCenterAzimuth = Math.atan2(-TANK.ventPos.z, -TANK.ventPos.x);
      const waveCount = Math.max(1, animalSpecs.length);
      for (let w = 0; w < animalSpecs.length; w++) {
        const as = animalSpecs[w];
        const g = createAnimalGenome(as.diet, as.plan);
        const waveAzimuth =
          reefCenterAzimuth + (w / waveCount) * Math.PI * 2 + randRange(-0.22, 0.22);
        for (let k = 0; k < as.n; k++) {
          let stage: AnimalLifeStage = 'adult';
          let spawnEgg = false;
          if (k === as.n - 1) {
            stage = getIntermediateStage(g);
          } else if (as.n >= 4 && k === as.n - 2) {
            if (g.reproduction === 'Egg_Layer') {
              spawnEgg = true;
              stage = 'adult';
            } else {
              stage = 'spawn';
            }
          }
          const delay =
            w === 0 && k === 0
              ? 0.35
              : k === 0
              ? randRange(0.42, 0.56)
              : randRange(0.15, 0.22);
          this.pendingVentSpawns.push({
            delay,
            genome: g,
            stage,
            azimuth: waveAzimuth,
            waveStart: k === 0,
            spawnEgg,
          });
        }
      }

      this.ventSpawnTimer = this.pendingVentSpawns[0]?.delay ?? 0;
      this.ventInitialBuildUp = this.pendingVentSpawns.length > 0;
      this.ventPulseEnergy = this.pendingVentSpawns.length > 0 ? 0.65 : 0.0;
      this.genesisCountdown = this.env.genesisInterval;

      this.speciesRegistry.recomputeCounts(this.animals, this.plants, this.simTime);
      this.log(
        `${presetMeta.name} seeded — ${this.pendingVentSpawns.length} fauna emerging from the Genesis Vent (${this.plants.length} flora).`,
        'genesis',
        'text-cyan-200'
      );
      this.recordHistory();
    } else {
      for (const as of animalSpecs) {
        const g = createAnimalGenome(as.diet, as.plan);
        const center = randomWeightedPointInReef(TANK.coreRadius * 0.85, TANK.coreRadius + 1.8);
        const cy = randRange(3.2, TANK.waterY - 2.4);
        for (let k = 0; k < as.n; k++) {
          const p = new THREE.Vector3(
            center.x + randRange(-2.3, 2.3),
            clamp(cy + randRange(-1.5, 1.5), 2.2, TANK.waterY - 1.5),
            center.z + randRange(-2.3, 2.3)
          );
          clampToTankRadius(p, 1.2);
          let stage: AnimalLifeStage = 'adult';
          if (k === as.n - 1) {
            stage = getIntermediateStage(g);
          } else if (as.n >= 4 && k === as.n - 2) {
            if (g.reproduction === 'Egg_Layer') {
              const eggPos = p.clone();
              eggPos.y = getSeabedHeight(eggPos.x, eggPos.z) + randRange(0.25, 1.4);
              const egg = this.spawnEgg(g, eggPos);
              if (egg) egg.age = randRange(0, egg.incubateDuration * 0.55);
              stage = 'adult';
            } else {
              stage = 'spawn';
            }
          }
          this.spawnAnimal(g, p, stage);
        }
      }

      this.speciesRegistry.recomputeCounts(this.animals, this.plants, this.simTime);
      this.log(
        `${presetMeta.name} seeded (${this.animals.length} fauna, ${this.plants.length} flora).`,
        'system',
        'text-cyan-200'
      );
      this.recordHistory();
    }
  }

  private launchAnimalFromVent(
    genome: AnimalGenome,
    stage: AnimalLifeStage,
    azimuth: number
  ): AnimalEntity | null {
    const jitterR = randRange(0.03, 0.22);
    const jitterAng = randRange(0, Math.PI * 2);
    const pos = new THREE.Vector3(
      TANK.ventPos.x + Math.cos(jitterAng) * jitterR,
      TANK.ventPos.y + randRange(2.05, 2.34),
      TANK.ventPos.z + Math.sin(jitterAng) * jitterR
    );
    const heading = azimuth + randRange(-0.34, 0.34);
    const launchDir = new THREE.Vector3(
      Math.cos(heading),
      randRange(0.82, 1.38),
      Math.sin(heading)
    ).normalize();
    const launchSpeed = Math.max(1.4, genome.speed * 1.05);
    const launchVel = launchDir.multiplyScalar(launchSpeed);

    const a = this.spawnAnimal(genome, pos, stage, launchVel);
    if (!a) return null;
    a.wanderDir
      .set(Math.cos(heading), randRange(-0.08, 0.26), Math.sin(heading))
      .normalize();
    a.wanderTimer = randRange(3.2, 5.2);
    a.attackCooldown = 2.0;
    a.moltAnim = 0.72;
    return a;
  }

  private updateInitialVentGenesis(dt: number): void {
    if (this.pendingVentSpawns.length === 0) return;

    if (this.ventInitialBuildUp) {
      this.ventPulseEnergy = Math.min(0.95, this.ventPulseEnergy + dt * 1.1);
    } else {
      this.ventPulseEnergy = Math.max(this.ventPulseEnergy, 0.78);
    }

    this.ventSpawnTimer -= dt;
    while (this.pendingVentSpawns.length > 0 && this.ventSpawnTimer <= 0) {
      const item = this.pendingVentSpawns.shift()!;
      this.ventInitialBuildUp = false;
      this.ventPulseEnergy = 1.0;

      const origin = new THREE.Vector3(TANK.ventPos.x, TANK.ventPos.y + 2.25, TANK.ventPos.z);
      if (item.waveStart) {
        this.events.emit('fx:shockwave', { position: origin, colorHex: 0x48f5ff });
        this.events.emit('fx:burst', {
          position: origin,
          colorHex: item.genome.glowHex,
          count: 14,
          speed: 2.5,
        });
        this.events.emit('audio:cue', { type: 'biogenesis' });
        this.log(
          `Genesis Vent: ${item.genome.speciesName} (${item.genome.bodyPlan.replace(/_/g, ' ')}, ${item.genome.diet})`,
          'genesis',
          'text-cyan-300'
        );
      } else {
        this.events.emit('fx:burst', {
          position: origin,
          colorHex: item.genome.glowHex,
          count: 5,
          speed: 1.85,
        });
      }

      this.launchAnimalFromVent(item.genome, item.stage, item.azimuth);

      if (item.spawnEgg && this.eggs.length < CAPS.maxEggs) {
        const eggPos = new THREE.Vector3(
          TANK.ventPos.x + Math.cos(item.azimuth) * randRange(0.65, 1.15),
          TANK.ventPos.y + 2.38,
          TANK.ventPos.z + Math.sin(item.azimuth) * randRange(0.65, 1.15)
        );
        const egg = this.spawnEgg(item.genome, eggPos);
        if (egg) egg.age = randRange(0, egg.incubateDuration * 0.55);
      }

      if (this.pendingVentSpawns.length > 0) {
        this.ventSpawnTimer += this.pendingVentSpawns[0].delay;
      } else {
        this.ventSpawnTimer = 0;
        this.genesisCountdown = this.env.genesisInterval;
        this.speciesRegistry.recomputeCounts(this.animals, this.plants, this.simTime);
      }
    }
  }

  triggerBiogenesis(
    forcedDiet: AnimalDiet | null = null,
    forcedPlan: AnimalBodyPlan | null = null
  ): AnimalEntity[] {
    const g = createAnimalGenome(forcedDiet, forcedPlan);
    const origin = new THREE.Vector3(TANK.ventPos.x, TANK.ventPos.y + 2.2, TANK.ventPos.z);
    this.ventPulseEnergy = 1.0;
    this.events.emit('fx:shockwave', { position: origin, colorHex: 0x48f5ff });
    this.events.emit('fx:burst', { position: origin, colorHex: g.glowHex, count: 18, speed: 2.7 });
    this.events.emit('audio:cue', { type: 'biogenesis' });

    const room = CAPS.maxAnimals - this.animals.length;
    if (room <= 0) {
      this.log('Biogenesis pulse throttled at carrying capacity.', 'genesis', 'text-slate-300');
      return [];
    }
    const n = Math.min(3, room);
    const spawned: AnimalEntity[] = [];
    const baseAz = this.ventAzimuthCursor;
    this.ventAzimuthCursor = (this.ventAzimuthCursor + 2.39996) % (Math.PI * 2);
    for (let i = 0; i < n; i++) {
      const initStage: AnimalLifeStage =
        i === 0 ? 'adult' : i === 1 ? getIntermediateStage(g) : 'spawn';
      const a = this.launchAnimalFromVent(g, initStage, baseAz + (i / Math.max(1, n)) * Math.PI * 2);
      if (a) spawned.push(a);
    }
    if (g.reproduction === 'Egg_Layer' && this.eggs.length < CAPS.maxEggs) {
      this.spawnEgg(
        g,
        origin
          .clone()
          .add(new THREE.Vector3(randRange(-0.9, 0.9), -0.35, randRange(-0.9, 0.9)))
      );
    }
    this.log(
      `Biogenesis: ${g.speciesName} (${g.bodyPlan.replace(/_/g, ' ')}, ${g.diet})`,
      'genesis',
      'text-cyan-300'
    );
    return spawned;
  }

  triggerPhytogenesis(
    forcedMetabolism: PlantMetabolism | null = null,
    forcedForm: PlantForm | null = null
  ): PlantEntity[] {
    const g = createPlantGenome(forcedMetabolism, forcedForm);
    const origin = new THREE.Vector3(TANK.ventPos.x, TANK.ventPos.y + 1.9, TANK.ventPos.z);
    this.ventPulseEnergy = 1.0;
    this.events.emit('fx:shockwave', { position: origin, colorHex: 0x3bf5a8 });
    this.events.emit('fx:burst', { position: origin, colorHex: g.glowHex, count: 16, speed: 2.3 });
    this.events.emit('audio:cue', { type: 'phytogenesis' });

    const room = CAPS.maxPlants - this.plants.length;
    if (room <= 0) {
      this.log('Phytogenesis pulse throttled at carrying capacity.', 'genesis', 'text-slate-300');
      return [];
    }
    const n = Math.min(3, room);
    const spawned: PlantEntity[] = [];
    for (let i = 0; i < n; i++) {
      const [px, pz] = clampXZToTankRadius(
        TANK.ventPos.x + randRange(-5.6, 5.6),
        TANK.ventPos.z + randRange(-4.6, 4.6),
        1.2
      );
      const pl = this.spawnPlant(g, px, pz, 0.25);
      if (pl) spawned.push(pl);
    }
    this.log(
      `Phytogenesis: ${g.speciesName} (${g.metabolism.replace(/_/g, ' ')})`,
      'genesis',
      'text-emerald-300'
    );
    return spawned;
  }

  /**
   * When at pellet/scrap capacity, gracefully recycle the most-dissolved or oldest resting
   * piece on the seabed so active feeding/tearing always spawns fresh intact pieces.
   */
  private ensureFoodPelletCapacity(): boolean {
    if (this.foodPellets.length < CAPS.maxFoodPellets) return true;
    let bestIdx = -1;
    let bestScore = -1;
    for (let i = 0; i < this.foodPellets.length; i++) {
      const p = this.foodPellets[i];
      if (!p.alive) {
        bestIdx = i;
        break;
      }
      let score = p.age * 0.1;
      if (p.phase === 'dissolving') {
        score = 1000 + p.dissolveAge / Math.max(1, p.dissolveDuration) * 100;
      } else if (p.phase === 'resting') {
        score = 100 + p.restingAge;
      }
      if (score > bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }
    if (bestIdx >= 0) {
      const evicted = this.foodPellets[bestIdx];
      if (evicted.alive) {
        this.disposeEntity(evicted);
      }
      this.foodPellets.splice(bestIdx, 1);
      return true;
    }
    return false;
  }

  /**
   * Interactive user feeding: drops a cluster of sinking nutrient pellets into the tank.
   */
  dropFoodCluster(x: number, z: number, count = 6): void {
    const [clampedX, clampedZ] = clampXZToTankRadius(x, z, 1.2);
    let dropped = 0;
    for (let i = 0; i < count; i++) {
      if (!this.ensureFoodPelletCapacity()) break;
      const pos = new THREE.Vector3(
        clampedX + randRange(-1.1, 1.1),
        TANK.waterY - randRange(0.55, 1.2),
        clampedZ + randRange(-1.1, 1.1)
      );
      clampToTankRadius(pos, 0.8);
      const baseScale = randRange(0.85, 1.25);
      const nutrients = randRange(26, 36);
      const restingDuration = randRange(32, 48);
      const dissolveDuration = randRange(42, 64);
      const q = new THREE.Quaternion().setFromEuler(
        new THREE.Euler(randRange(0, Math.PI * 2), randRange(0, Math.PI * 2), randRange(0, Math.PI * 2))
      );
      const pellet: FoodPelletEntity = {
        id: allocateEntityId(),
        kind: 'pellet',
        origin: 'pellet',
        phase: 'sinking',
        alive: true,
        position: pos,
        lastValidPos: pos.clone(),
        quaternion: q,
        scale: baseScale,
        baseScale,
        stretch: new THREE.Vector3(1, 1, 1),
        velocity: new THREE.Vector3(randRange(-0.25, 0.25), randRange(-0.4, -0.1), randRange(-0.25, 0.25)),
        angularVelocity: new THREE.Vector3(randRange(-1.8, 1.8), randRange(-1.8, 1.8), randRange(-1.8, 1.8)),
        nutrients,
        maxNutrients: nutrients,
        age: 0,
        maxAge: restingDuration + dissolveDuration,
        restingAge: 0,
        restingDuration,
        dissolveAge: 0,
        dissolveDuration,
        opacity: 1.0,
        detritusTimer: randRange(3.5, 6.0),
        stage: 'Pellet',
        state: 'Sinking',
        colorHex: Math.random() < 0.5 ? 0xfbbf24 : 0x52f2a8,
      };
      this.foodPellets.push(pellet);
      this.events.emit('entity:spawned', { entity: pellet });
      dropped++;
    }
    if (dropped > 0) {
      const splashPos = new THREE.Vector3(clampedX, TANK.waterY - 0.35, clampedZ);
      this.events.emit('fx:burst', { position: splashPos, colorHex: 0xfde68a, count: 10, speed: 1.5 });
      this.events.emit('audio:cue', { type: 'feed' });
      this.log(`Dropped ${dropped} nutrient pellets into the water column.`, 'ecology', 'text-amber-200');
    }
  }

  /**
   * Inspector action: energize/heal an organism.
   */
  nourishEntity(entity: Entity): void {
    if (!entity || !entity.alive) return;
    if (entity.kind === 'animal') {
      entity.hp = entity.maxHp;
      entity.energy = entity.maxEnergy;
      this.events.emit('fx:burst', { position: entity.position, colorHex: 0x34f5a8, count: 10, speed: 1.6 });
      this.events.emit('toast', { message: `Nourished ${entity.genome.speciesName}` });
    } else if (entity.kind === 'plant' && !entity.wilting) {
      entity.biomass = entity.maxBiomass;
      entity.growth = Math.min(1.0, entity.growth + 0.2);
      this.events.emit('fx:burst', { position: entity.position, colorHex: 0x34f5a8, count: 10, speed: 1.4 });
      this.events.emit('toast', { message: `Fertilized ${entity.genome.speciesName}` });
    }
  }

  /**
   * Inspector action: induce directed mutation & spawn a new mutant offspring nearby.
   */
  induceMutation(entity: Entity): Entity | null {
    if (!entity || !entity.alive) return null;
    if (entity.kind === 'animal') {
      if (this.animals.length >= CAPS.maxAnimals) {
        this.events.emit('toast', { message: 'Fauna carrying capacity reached' });
        return null;
      }
      const { genome: mg } = recombineAnimalGenomes(entity.genome, null, 2.5, true);
      const pos = entity.position
        .clone()
        .add(new THREE.Vector3(randRange(-0.9, 0.9), randRange(-0.3, 0.4), randRange(-0.9, 0.9)));
      const child = this.spawnAnimal(mg, pos, false);
      if (child) {
        entity.offspringCount++;
        this.events.emit('fx:burst', { position: child.position, colorHex: mg.glowHex, count: 14, speed: 2.0 });
        this.events.emit('audio:cue', { type: 'speciation' });
        this.log(`Induced mutation: ${mg.speciesName} (${mg.bodyPlan.replace(/_/g, ' ')})`, 'speciation', 'text-fuchsia-300');
      }
      return child;
    } else if (entity.kind === 'plant') {
      if (this.plants.length >= CAPS.maxPlants) {
        this.events.emit('toast', { message: 'Flora carrying capacity reached' });
        return null;
      }
      const { genome: mg } = mutatePlantGenome(entity.genome, 2.5, true);
      const child = this.spawnPlant(
        mg,
        entity.position.x + randRange(-2.0, 2.0),
        entity.position.z + randRange(-2.0, 2.0),
        0.55
      );
      if (child) {
        entity.offspringCount++;
        this.events.emit('fx:burst', { position: child.position, colorHex: mg.glowHex, count: 12, speed: 1.6 });
        this.events.emit('audio:cue', { type: 'speciation' });
        this.log(`Induced flora mutation: ${mg.speciesName}`, 'speciation', 'text-emerald-300');
      }
      return child;
    }
    return null;
  }

  spawnAnimal(
    rawGenome: AnimalGenome,
    position: THREE.Vector3,
    initialStage: boolean | AnimalLifeStage = 'adult',
    initialVelocity?: THREE.Vector3
  ): AnimalEntity | null {
    if (this.animals.length >= CAPS.maxAnimals) return null;
    const genome = normalizeAnimalGenome(rawGenome);
    const pos = isFiniteVec3(position) ? position.clone() : new THREE.Vector3(0, 6, 0);
    clampToTankRadius(pos, 0.9);
    pos.y = clamp(pos.y, getSeabedHeight(pos.x, pos.z) + 0.45, TANK.waterY - 0.8);

    const lifeStage: AnimalLifeStage =
      typeof initialStage === 'boolean'
        ? initialStage
          ? getIntermediateStage(genome)
          : 'adult'
        : initialStage;
    const maturity =
      lifeStage === 'adult' ? 1.0 : getInitialMaturityForStage(lifeStage);
    const instarRank = getInstarRank(maturity);
    const maxHp = computeStageMaxHp(genome, lifeStage, maturity);
    const scale = computeStageScale(genome, lifeStage, maturity);
    const stageLabel = getStageDisplayLabel(genome, lifeStage, maturity);
    const isImmature = lifeStage !== 'adult';

    let vel: THREE.Vector3;
    if (initialVelocity && isFiniteVec3(initialVelocity) && initialVelocity.lengthSq() > 1e-6) {
      vel = initialVelocity.clone();
    } else {
      vel = new THREE.Vector3(randRange(-1, 1), randRange(-0.25, 0.25), randRange(-1, 1));
      safeNormalize(vel);
      vel.multiplyScalar(genome.speed * 0.65);
    }

    const entity: AnimalEntity = {
      id: allocateEntityId(),
      kind: 'animal',
      alive: true,
      genome,
      position: pos,
      lastValidPos: pos.clone(),
      quaternion: new THREE.Quaternion(),
      scale,
      velocity: vel,
      hp: maxHp,
      maxHp,
      energy: isImmature ? 78 : randRange(80, 108),
      maxEnergy: 120,
      age: lifeStage === 'spawn' ? 0 : lifeStage === 'adult' ? randRange(24, 44) : randRange(8, 14),
      stage: stageLabel,
      maturity,
      lifeStage,
      instarRank,
      moltAnim: 0,
      state:
        lifeStage === 'spawn'
          ? 'Sheltering'
          : lifeStage === 'instar'
          ? 'Scuttling'
          : 'Foraging',
      activeTarget: null,
      offspringCount: 0,
      reproCooldown: isImmature ? 18 : randRange(10, 22),
      attackCooldown: 0,
      biteCooldown: 0,
      hitFlash: 0,
      jawGape: 0,
      biteAnim: 0,
      thrashAnim: 0,
      lungeAnim: 0,
      chewPhase: randRange(0, Math.PI * 2),
      mouthMorselTimer: 0,
      mouthMorselMaxTimer: 1.0,
      mouthMorselColor: 0xffffff,
      mouthMorselKind: 'flesh',
      bankAngle: 0,
      wingPhase: randRange(0, Math.PI * 2),
      swimPhase: randRange(0, Math.PI * 2),
      paddlePhase: randRange(0, Math.PI * 2),
      speedRatio: 0.7,
      wanderDir: new THREE.Vector3(randRange(-1, 1), randRange(-0.22, 0.22), randRange(-1, 1)).normalize(),
      wanderTimer: randRange(1.5, 4.0),
    };
    safeOrientToward(entity.quaternion, entity.velocity, 1.0);

    this.animals.push(entity);
    this.speciesRegistry.registerAnimalBirth(genome, this.simTime);
    this.events.emit('entity:spawned', { entity });
    return entity;
  }

  spawnPlant(rawGenome: PlantGenome, x: number, z: number, initialGrowth = 0.22): PlantEntity | null {
    if (this.plants.length >= CAPS.maxPlants) return null;
    const genome = normalizePlantGenome(rawGenome);
    const [sx, sz] = clampXZToTankRadius(x, z, 1.0);
    const sy = getSeabedHeight(sx, sz) - 0.03;

    const pos = new THREE.Vector3(sx, sy, sz);
    const growth = clamp(initialGrowth, 0.16, 1.0);
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), randRange(0, Math.PI * 2));
    const maxBiomass = genome.leafMorphology === 'succulent_lobe' ? 135 : 100;

    const entity: PlantEntity = {
      id: allocateEntityId(),
      kind: 'plant',
      alive: true,
      wilting: false,
      wiltAge: 0,
      wiltDuration: randRange(6.2, 9.6),
      genome,
      position: pos,
      lastValidPos: pos.clone(),
      quaternion: q,
      scale: Math.max(0.1, growth * genome.maxHeight * 0.56),
      growth,
      biomass: (0.35 + growth * 0.65) * maxBiomass,
      maxBiomass,
      age: growth > 0.5 ? randRange(10, 32) : 0,
      stage: growth < 0.36 ? 'Sprout' : growth < 0.72 ? 'Sapling' : 'Mature',
      state: genome.metabolism.replace(/_/g, ' '),
      offspringCount: 0,
      seedCooldown: randRange(18, 34),
      snareCooldown: 0,
      snareAnim: 0,
      rustleAnim: 0,
      swayPhase: randRange(0, Math.PI * 2),
      wiltTilt: 0,
      opacity: 1.0,
    };

    this.plants.push(entity);
    this.speciesRegistry.registerPlantBirth(genome, this.simTime);
    this.events.emit('entity:spawned', { entity });
    return entity;
  }

  spawnEgg(rawGenome: AnimalGenome, position: THREE.Vector3): EggEntity | null {
    if (this.eggs.length >= CAPS.maxEggs) return null;
    const genome = normalizeAnimalGenome(rawGenome);
    const pos = isFiniteVec3(position) ? position.clone() : new THREE.Vector3(0, 3, 0);
    clampToTankRadius(pos, 0.8);
    const entity: EggEntity = {
      id: allocateEntityId(),
      kind: 'egg',
      alive: true,
      genome,
      position: pos,
      lastValidPos: pos.clone(),
      quaternion: new THREE.Quaternion(),
      scale: 0.78,
      age: 0,
      incubateDuration: randRange(10, 16),
      stage: 'Egg',
      state: 'Incubating',
      nutrients: 24,
    };
    this.eggs.push(entity);
    this.events.emit('entity:spawned', { entity });
    return entity;
  }

  spawnPropagule(rawGenome: PlantGenome, position: THREE.Vector3, isSeed: boolean): PropaguleEntity | null {
    if (this.propagules.length >= CAPS.maxPropagules) return null;
    const genome = normalizePlantGenome(rawGenome);
    const pos = isFiniteVec3(position) ? position.clone() : new THREE.Vector3(0, 3, 0);
    clampToTankRadius(pos, 0.9);
    const entity: PropaguleEntity = {
      id: allocateEntityId(),
      kind: 'propagule',
      alive: true,
      isSeed,
      genome,
      position: pos,
      lastValidPos: pos.clone(),
      quaternion: new THREE.Quaternion(),
      scale: 1.0,
      velocity: new THREE.Vector3(
        randRange(-0.7, 0.7),
        isSeed ? -0.35 : randRange(0.2, 0.65),
        randRange(-0.7, 0.7)
      ),
      age: 0,
      maxAge: randRange(13, 22),
      stage: isSeed ? 'Seed' : 'Spore',
      state: isSeed ? 'Sinking' : 'Drifting',
      nutrients: 18,
    };
    this.propagules.push(entity);
    this.events.emit('entity:spawned', { entity });
    return entity;
  }

  /**
   * Spawns a physical, intact, edible piece torn from prey, a corpse, or flora.
   * Remains intact while sinking through the water column and resting on the seabed,
   * before very slowly dissolving into seabed nutrients unless eaten.
   */
  spawnTornMorsel(
    position: THREE.Vector3,
    velocity: THREE.Vector3,
    colorHex: number,
    origin: FragmentKind,
    nutrients = 16,
    scaleMult = 1.0,
    sourceSpecies?: string
  ): FoodPelletEntity | null {
    if (!this.ensureFoodPelletCapacity()) return null;
    const pos = isFiniteVec3(position) ? position.clone() : new THREE.Vector3(0, 4, 0);
    clampToTankRadius(pos, 0.7);
    pos.y = clamp(pos.y, getSeabedHeight(pos.x, pos.z) + 0.14, TANK.waterY - 0.45);

    const vel = isFiniteVec3(velocity) ? velocity.clone() : new THREE.Vector3();
    const massFactor = clamp(0.76 + (nutrients / 22) * 0.44, 0.7, 1.45);
    const baseScale = clamp(randRange(0.84, 1.2) * massFactor * scaleMult, 0.55, 1.85);
    const stretch =
      origin === 'flesh'
        ? new THREE.Vector3(randRange(0.88, 1.48), randRange(0.58, 1.05), randRange(0.78, 1.32))
        : origin === 'flora'
        ? new THREE.Vector3(randRange(0.85, 1.35), randRange(0.95, 1.48), randRange(0.8, 1.25))
        : new THREE.Vector3(1, 1, 1);

    const spin = origin === 'flora' ? 3.8 : 3.2;
    const q = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(randRange(0, Math.PI * 2), randRange(0, Math.PI * 2), randRange(0, Math.PI * 2))
    );

    const restingDuration =
      origin === 'flesh'
        ? randRange(52, 86)
        : origin === 'flora'
        ? randRange(46, 74)
        : randRange(32, 48);
    const dissolveDuration =
      origin === 'flesh'
        ? randRange(72, 115)
        : origin === 'flora'
        ? randRange(60, 96)
        : randRange(42, 62);

    const scrap: FoodPelletEntity = {
      id: allocateEntityId(),
      kind: 'pellet',
      origin,
      phase: 'sinking',
      alive: true,
      position: pos,
      lastValidPos: pos.clone(),
      quaternion: q,
      scale: baseScale,
      baseScale,
      stretch,
      velocity: vel,
      angularVelocity: new THREE.Vector3(
        randRange(-spin, spin),
        randRange(-spin, spin),
        randRange(-spin, spin)
      ),
      nutrients,
      maxNutrients: nutrients,
      age: 0,
      maxAge: restingDuration + dissolveDuration,
      restingAge: 0,
      restingDuration,
      dissolveAge: 0,
      dissolveDuration,
      opacity: 1.0,
      detritusTimer: randRange(3.5, 6.5),
      stage: origin === 'flesh' ? 'Torn Flesh' : origin === 'flora' ? 'Torn Flora' : 'Pellet',
      state: 'Sinking',
      colorHex,
      sourceSpecies,
    };
    this.foodPellets.push(scrap);
    this.events.emit('entity:spawned', { entity: scrap });
    return scrap;
  }

  transitionAnimalToCorpse(animal: AnimalEntity, cause = 'natural causes'): CorpseEntity | null {
    if (!animal || !animal.alive) return null;
    animal.alive = false;
    const nutrients = Math.round(54 + animal.genome.sizeScale * 68);
    const corpse: CorpseEntity = {
      id: animal.id,
      kind: 'corpse',
      alive: true,
      phase: 'dying',
      genome: animal.genome,
      position: animal.position.clone(),
      lastValidPos: animal.position.clone(),
      quaternion: animal.quaternion.clone(),
      scale: Math.max(0.1, animal.scale),
      velocity: animal.velocity.clone().multiplyScalar(0.32),
      age: animal.age,
      corpseAge: 0,
      dyingAge: 0,
      dyingDuration: 1.35,
      decomposeAge: 0,
      decomposeDuration: randRange(24, 36),
      dissolveAge: 0,
      dissolveDuration: randRange(7.5, 11.0),
      initialScale: Math.max(0.1, animal.scale),
      nutrients,
      maxNutrients: nutrients,
      stage: 'Dying',
      state: 'Dying',
      cause,
      rollSign: Math.random() < 0.5 ? 1 : -1,
      detritusTimer: 0.45,
      joltAnim: 0,
      opacity: 1.0,
    };
    this.corpses.push(corpse);
    this.events.emit('entity:morphed', { from: animal, to: corpse });
    return corpse;
  }

  spawnNutrientPatch(x: number, z: number, strength = 1.0): void {
    if (this.nutrientPatches.length >= CAPS.maxNutrientPatches) {
      const oldest = this.nutrientPatches[0];
      if (oldest) {
        oldest.nutrients = Math.min(100, oldest.nutrients + 30 * strength);
        oldest.age = Math.max(0, oldest.age - 10);
      }
      return;
    }
    const [sx, sz] = clampXZToTankRadius(x, z, 0.9);
    const sy = getSeabedHeight(sx, sz) + 0.048;
    const maxN = 65 * strength;
    this.nutrientPatches.push({
      id: allocateEntityId(),
      alive: true,
      position: new THREE.Vector3(sx, sy, sz),
      radiusScale: randRange(0.75, 1.25) * strength,
      nutrients: maxN,
      maxNutrients: maxN,
      age: 0,
      maxAge: randRange(24, 38),
    });
  }

  disposeEntity(entity: Entity): void {
    if (!entity || !entity.alive) return;
    entity.alive = false;
    this.events.emit('entity:disposed', { entity });
  }

  enforceFiniteTransform(entity: Entity): void {
    if (!entity) return;
    if (!isFiniteVec3(entity.position)) entity.position.copy(entity.lastValidPos);
    else entity.lastValidPos.copy(entity.position);
    if ('velocity' in entity && !isFiniteVec3(entity.velocity)) {
      entity.velocity.set(0, 0, 0);
    }
    if (!Number.isFinite(entity.quaternion.x) || !Number.isFinite(entity.quaternion.w)) {
      entity.quaternion.identity();
    }
  }

  step(dt: number): void {
    this.simTime += dt;

    if (this.env.dayNightAutoCycle && this.env.dayCycleDuration > 1) {
      this.env.timeOfDay = (this.env.timeOfDay + dt / this.env.dayCycleDuration) % 1.0;
    }

    // Smooth post-pulse decay back to complete darkness (0.0) after a genesis eruption
    this.ventPulseEnergy = Math.max(0.0, this.ventPulseEnergy - dt * 0.28);

    this.updateInitialVentGenesis(dt);

    if (this.env.autoGenesisEnabled && !this.isInitialVentGenesisActive()) {
      this.genesisCountdown -= dt;
      if (this.genesisCountdown <= 0) {
        this.genesisCountdown = this.env.genesisInterval;
        if (this.genesisToggle % 2 === 0) this.triggerBiogenesis();
        else this.triggerPhytogenesis();
        this.genesisToggle++;
      }
    }

    // Rebuild zero-GC spatial hash grids
    this.animalGrid.clear();
    this.plantGrid.clear();
    this.foodGrid.clear();
    for (let i = 0; i < this.animals.length; i++) this.animalGrid.insert(this.animals[i]);
    for (let i = 0; i < this.plants.length; i++) this.plantGrid.insert(this.plants[i]);
    for (let i = 0; i < this.corpses.length; i++) {
      const c = this.corpses[i];
      if (c.alive && (c.phase === 'sinking_corpse' || c.phase === 'decomposing')) {
        this.foodGrid.insert(c);
      }
    }
    for (let i = 0; i < this.eggs.length; i++) this.foodGrid.insert(this.eggs[i]);
    for (let i = 0; i < this.propagules.length; i++) this.foodGrid.insert(this.propagules[i]);
    for (let i = 0; i < this.foodPellets.length; i++) this.foodGrid.insert(this.foodPellets[i]);

    this.animalBehavior.update(this, dt);
    this.plantEcology.update(this, dt);
    this.lifecycle.update(this, dt);

    if (this.simTime - this.lastSpeciesRecomputeT >= 0.75) {
      this.lastSpeciesRecomputeT = this.simTime;
      this.speciesRegistry.recomputeCounts(this.animals, this.plants, this.simTime);
    }

    if (this.simTime - this.lastHistoryT >= 2.0) {
      this.lastHistoryT = this.simTime;
      this.recordHistory();
    }
  }

  getActiveSpeciesCount(): number {
    this.speciesRegistry.recomputeCounts(this.animals, this.plants, this.simTime);
    return this.speciesRegistry.getExtantCount();
  }

  /**
   * Computes the Genesis Vent's instantaneous glow intensity (0 = dormant/off, 1 = peak pulse).
   * Awakens and builds smoothly shortly before an upcoming genesis pulse, peaks at the pulse
   * (or on manual Biogenesis/Phytogenesis), and smoothly dims back to 0 until the next event.
   */
  getVentGlowLevel(): number {
    let preCharge = 0.0;
    if (this.env.autoGenesisEnabled && this.env.genesisInterval > 0) {
      const chargeWindow = Math.min(4.8, Math.max(1.8, this.env.genesisInterval * 0.28));
      if (this.genesisCountdown <= chargeWindow) {
        const p = clamp(1.0 - Math.max(0, this.genesisCountdown) / chargeWindow, 0, 1);
        // Smooth accelerating ramp from faint ember to bright crescendo right before eruption
        preCharge = Math.pow(p, 1.75) * 0.88;
      }
    }
    // Smooth ease-out curve on post-pulse decay so the glow dims gracefully to zero
    const postGlow = Math.pow(clamp(this.ventPulseEnergy, 0, 1), 1.35);
    return clamp(Math.max(preCharge, postGlow), 0, 1);
  }

  findLivingSpecimen(kind: 'fauna' | 'flora', speciesId: number): Entity | null {
    if (kind === 'fauna') {
      return this.animals.find((a) => a.alive && a.genome.speciesId === speciesId) ?? null;
    }
    return this.plants.find((p) => p.alive && p.genome.speciesId === speciesId) ?? null;
  }

  recordHistory(): void {
    let totalBiomass = 0;
    for (let i = 0; i < this.plants.length; i++) totalBiomass += this.plants[i].biomass;
    this.history.push({
      time: this.simTime,
      animals: this.animals.length,
      plants: this.plants.length,
      species: this.getActiveSpeciesCount(),
      detritus: this.corpses.length + this.nutrientPatches.length,
      biomass: Math.round(totalBiomass / 40),
    });
    if (this.history.length > 80) this.history.shift();
  }

  exportSnapshot(): SimulationSnapshot {
    this.speciesRegistry.recomputeCounts(this.animals, this.plants, this.simTime);
    return {
      version: 2,
      savedAt: new Date().toISOString(),
      simTime: this.simTime,
      env: { ...this.env },
      speciesRecords: this.speciesRegistry.exportRecords(),
      animals: this.animals
        .filter((a) => a.alive)
        .map((a) => ({
          id: a.id,
          genome: { ...a.genome },
          pos: [a.position.x, a.position.y, a.position.z],
          vel: [a.velocity.x, a.velocity.y, a.velocity.z],
          hp: a.hp,
          energy: a.energy,
          age: a.age,
          maturity: a.maturity,
          lifeStage: a.lifeStage,
          offspringCount: a.offspringCount,
        })),
      plants: this.plants
        .filter((p) => p.alive && !p.wilting)
        .map((p) => ({
          id: p.id,
          genome: { ...p.genome },
          pos: [p.position.x, p.position.y, p.position.z],
          growth: p.growth,
          biomass: p.biomass,
          age: p.age,
          offspringCount: p.offspringCount,
        })),
    };
  }

  importSnapshot(snap: SimulationSnapshot): void {
    if (!snap || snap.version !== 2 || !Array.isArray(snap.animals) || !Array.isArray(snap.plants)) {
      throw new Error('Invalid Xenobiotic Abyss snapshot format.');
    }
    this.clearAll();
    Object.assign(this.env, DEFAULT_ENV_PARAMS, snap.env ?? {});
    this.simTime = Number.isFinite(snap.simTime) ? snap.simTime : 0;

    let maxSp = 1;
    let maxEnt = 1;
    if (Array.isArray(snap.speciesRecords)) {
      this.speciesRegistry.importRecords(snap.speciesRecords);
      for (const r of snap.speciesRecords) maxSp = Math.max(maxSp, r.speciesId);
    }

    for (const p of snap.plants) {
      const normalized = normalizePlantGenome(p.genome);
      maxSp = Math.max(maxSp, normalized.speciesId);
      maxEnt = Math.max(maxEnt, p.id);
      const ent = this.spawnPlant(normalized, p.pos[0], p.pos[2], p.growth);
      if (ent) {
        ent.biomass = clamp(p.biomass, 10, ent.maxBiomass);
        ent.age = Math.max(0, p.age);
        ent.offspringCount = p.offspringCount ?? 0;
      }
    }

    for (const a of snap.animals) {
      const normalized = normalizeAnimalGenome(a.genome);
      maxSp = Math.max(maxSp, normalized.speciesId);
      maxEnt = Math.max(maxEnt, a.id);
      const maturity = clamp(a.maturity, 0.04, 1.0);
      const resolvedStage: AnimalLifeStage =
        a.lifeStage ?? getLifeStageFromMaturity(normalized, maturity);
      const ent = this.spawnAnimal(
        normalized,
        new THREE.Vector3(a.pos[0], a.pos[1], a.pos[2]),
        resolvedStage
      );
      if (ent) {
        ent.velocity.set(a.vel[0], a.vel[1], a.vel[2]);
        ent.maturity = maturity;
        ent.lifeStage = resolvedStage;
        ent.instarRank = getInstarRank(maturity);
        ent.stage = getStageDisplayLabel(normalized, resolvedStage, maturity);
        ent.maxHp = computeStageMaxHp(normalized, resolvedStage, maturity);
        ent.hp = clamp(a.hp, 1, ent.maxHp);
        ent.scale = computeStageScale(normalized, resolvedStage, maturity);
        ent.energy = clamp(a.energy, 1, ent.maxEnergy);
        ent.age = Math.max(0, a.age);
        ent.offspringCount = a.offspringCount ?? 0;
      }
    }

    syncIdCounters(maxSp, maxEnt);
    this.speciesRegistry.recomputeCounts(this.animals, this.plants, this.simTime);
    this.recordHistory();
    this.log(
      `Loaded biosphere snapshot (${this.animals.length} fauna, ${this.plants.length} flora).`,
      'system',
      'text-cyan-200'
    );
  }
}
