import * as THREE from 'three';

export interface TankConfig {
  /** Lush focal reef oasis radius where lifeforms roam freely with zero boundary pull */
  readonly coreRadius: number;
  /** Soft invisible ecological horizon where return-weighting gently increases */
  readonly radius: number;
  /** Distant open-water safety ceiling far out in the underwater haze */
  readonly maxRadius: number;
  /** Visual seabed & water surface horizontal expanse (past optical extinction) */
  readonly worldRadius: number;
  /** Half-extent aliases matching radius for compatibility */
  readonly halfW: number;
  readonly waterY: number;
  readonly halfD: number;
  readonly ventPos: THREE.Vector3;
}

export const TANK: TankConfig = {
  coreRadius: 11.5,
  radius: 15.5,
  maxRadius: 21.5,
  worldRadius: 96.0,
  halfW: 15.5,
  waterY: 12.2,  // 12.2 units water depth
  halfD: 15.5,
  ventPos: new THREE.Vector3(-3.6, 0.0, -1.8),
};

export interface SimulationCaps {
  readonly maxAnimals: number;
  readonly maxPlants: number;
  readonly maxEggs: number;
  readonly maxPropagules: number;
  readonly maxNutrientPatches: number;
  readonly maxFoodPellets: number;
  readonly maxBurstParticles: number;
  readonly maxTornFragments: number;
  readonly maxShockwaves: number;
}

export const CAPS: SimulationCaps = {
  maxAnimals: 76,
  maxPlants: 64,
  maxEggs: 34,
  maxPropagules: 36,
  maxNutrientPatches: 32,
  maxFoodPellets: 160,
  maxBurstParticles: 360,
  maxTornFragments: 180,
  maxShockwaves: 16,
};

export interface EnvironmentParameters {
  /** 0..1 where 0 = midnight, 0.25 = dawn, 0.5 = noon, 0.75 = dusk */
  timeOfDay: number;
  dayNightAutoCycle: boolean;
  /** Real-time seconds for a full 24h solar cycle */
  dayCycleDuration: number;
  /** 0..2 multiplier on the 3D water current field */
  currentStrength: number;
  /** 0.2..3.0 multiplier on genetic mutation chance */
  mutationRateMultiplier: number;
  /** Seconds between automatic primordial hydrothermal genesis pulses */
  genesisInterval: number;
  autoGenesisEnabled: boolean;
}

export const DEFAULT_ENV_PARAMS: EnvironmentParameters = {
  timeOfDay: 0.44, // Bright late-morning sunlit reef at launch
  dayNightAutoCycle: true,
  dayCycleDuration: 150.0,
  currentStrength: 0.65,
  mutationRateMultiplier: 1.0,
  genesisInterval: 22.0,
  autoGenesisEnabled: true,
};

export type EcosystemPresetId = 'balanced_reef' | 'abyssal_predators' | 'bioluminescent_garden';

export interface EcosystemPresetMeta {
  readonly id: EcosystemPresetId;
  readonly name: string;
  readonly description: string;
  readonly timeOfDay: number;
  readonly currentStrength: number;
}

export const ECOSYSTEM_PRESETS: readonly EcosystemPresetMeta[] = [
  {
    id: 'balanced_reef',
    name: 'Balanced Hydrothermal Reef',
    description: 'Diverse herbivores, filter-feeders, scavengers, predators, and mixed flora.',
    timeOfDay: 0.44,
    currentStrength: 0.65,
  },
  {
    id: 'abyssal_predators',
    name: 'Abyssal Twilight Hunt',
    description: 'Deep twilight waters with heightened bioluminescence, swift hunters, and armored scavengers.',
    timeOfDay: 0.84,
    currentStrength: 0.9,
  },
  {
    id: 'bioluminescent_garden',
    name: 'Midnight Luminous Garden',
    description: 'Nocturnal reef bursting with glowing kelp, lanterns, drifting medusae, and gentle currents.',
    timeOfDay: 0.04,
    currentStrength: 0.4,
  },
];
