export type AnimalBodyPlan =
  | 'segmented_eel'
  | 'fusiform_swimmer'
  | 'radial_medusa'
  | 'armored_trilopod'
  | 'winged_manta';

export type AnimalAppendage =
  | 'pectoral_wings'
  | 'dorsal_crest'
  | 'trailing_tentacles'
  | 'stalked_eyes'
  | 'sensory_barbels'
  | 'ventral_keels'
  | 'feather_plumes';

export type AnimalFunctionalPart =
  | 'bioluminescent_lure'
  | 'chitin_spines'
  | 'mandibles'
  | 'stalked_eyes'
  | 'dorsal_crest'
  | 'electro_organs'
  | 'armored_scutes'
  | 'venom_barbs';

export type AnimalDiet =
  | 'Herbivore'
  | 'Carnivore'
  | 'Omnivore'
  | 'Scavenger'
  | 'Filter_Feeder';

export type AnimalSocial =
  | 'Schooling_Boids'
  | 'Solitary'
  | 'Territorial'
  | 'Pack_Hunter';

export type AnimalCombat =
  | 'Ambush'
  | 'Melee_Ram'
  | 'Venom_Spines'
  | 'Evasive_Dart'
  | 'Electric_Pulse'
  | 'Ink_Cloud'
  | 'Armor_Brace';

export type AnimalReproduction =
  | 'Egg_Layer'
  | 'Live_Birth'
  | 'Binary_Fission';

export type SkinPattern =
  | 'striped'
  | 'spotted'
  | 'iridescent'
  | 'photophore'
  | 'marbled'
  | 'chevron'
  | 'ocellated'
  | 'abyssal_veins';

export type AnimalIntegument =
  | 'smooth_mucus'
  | 'plated_scales'
  | 'chitin_carapace'
  | 'translucent_gel'
  | 'spined_dermal';

export type AnimalSensory =
  | 'binocular_optics'
  | 'electroreception'
  | 'chemo_barbels'
  | 'lateral_sonar'
  | 'thermal_pits';

export type AnimalPhysiology =
  | 'ectothermic'
  | 'thermophilic'
  | 'photosymbiotic'
  | 'toxin_resistant'
  | 'hyper_metabolic';

export type DepthPreference = 'surface' | 'midwater' | 'benthic';

export interface AnimalGenome {
  speciesId: number;
  parentSpeciesId: number | null;
  speciesName: string;
  generation: number;
  bodyPlan: AnimalBodyPlan;
  appendage: AnimalAppendage;
  functionalPart: AnimalFunctionalPart;
  diet: AnimalDiet;
  social: AnimalSocial;
  combat: AnimalCombat;
  reproduction: AnimalReproduction;
  skinPattern: SkinPattern;
  integument: AnimalIntegument;
  sensoryOrgan: AnimalSensory;
  physiology: AnimalPhysiology;
  depthPref: DepthPreference;
  sizeScale: number;
  bodyElongation: number;
  finSpan: number;
  armorDensity: number;
  toxicity: number;
  metabolicEfficiency: number;
  speed: number;
  visionRange: number;
  maxHp: number;
  attackPower: number;
  maxAge: number;
  baseHex: number;
  accentHex: number;
  glowHex: number;
  segments: number;
  wingFreq: number;
  swimFreq: number;
  paddleFreq: number;
  biolumIntensity: number;
}

export type PlantForm =
  | 'spiral_kelp'
  | 'bioluminescent_bulb'
  | 'coral_fan'
  | 'tendril_anemone'
  | 'spore_stalk'
  | 'ribbon_seagrass'
  | 'crystal_sponge';

export type PlantMetabolism =
  | 'Photosynthetic'
  | 'Chemosynthetic'
  | 'Carnivorous_Flora'
  | 'Mixotrophic'
  | 'Detritivore_Fungi';

export type PlantPropagation =
  | 'Drifting_Spores'
  | 'Weighted_Seeds'
  | 'Budding'
  | 'Rhizome_Runners'
  | 'Explosive_Pods';

export type PlantLeafMorphology =
  | 'broad_blade'
  | 'serrated_frond'
  | 'feathered_plume'
  | 'succulent_lobe'
  | 'crystalline_lattice';

export type PlantDefense =
  | 'none'
  | 'alkaloid_toxin'
  | 'calcified_thorns'
  | 'mucus_sheath'
  | 'biolum_flash';

export type PlantRootSystem =
  | 'holdfast_anchor'
  | 'deep_rhizome'
  | 'symbiotic_mycelia'
  | 'pneumatocyst_float';

export type PlantSurfaceTexture =
  | 'veined'
  | 'porous_coral'
  | 'velvet_biofilm'
  | 'crystalline'
  | 'spined_bark';

export interface PlantGenome {
  speciesId: number;
  parentSpeciesId: number | null;
  speciesName: string;
  generation: number;
  form: PlantForm;
  metabolism: PlantMetabolism;
  propagation: PlantPropagation;
  leafMorphology: PlantLeafMorphology;
  defense: PlantDefense;
  rootSystem: PlantRootSystem;
  surfaceTexture: PlantSurfaceTexture;
  maxHeight: number;
  frondCount: number;
  canopySpread: number;
  toxicity: number;
  nutrientEfficiency: number;
  biolumIntensity: number;
  maxAge: number;
  baseHex: number;
  accentHex: number;
  glowHex: number;
  swayFreq: number;
}

export interface SpeciesRecord {
  speciesId: number;
  parentSpeciesId: number | null;
  kind: 'fauna' | 'flora';
  speciesName: string;
  foundedAt: number;
  extinctAt: number | null;
  peakPopulation: number;
  currentPopulation: number;
  totalBirths: number;
  maxGeneration: number;
  baseHex: number;
  glowHex: number;
  primaryTrait: string;
  secondaryTrait: string;
  summaryTraits: string[];
}
