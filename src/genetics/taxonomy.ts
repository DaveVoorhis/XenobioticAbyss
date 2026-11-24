import { randChoice } from '../core/math';
import type {
  AnimalAppendage,
  AnimalBodyPlan,
  AnimalCombat,
  AnimalDiet,
  AnimalFunctionalPart,
  AnimalGenome,
  AnimalIntegument,
  AnimalPhysiology,
  AnimalReproduction,
  AnimalSensory,
  AnimalSocial,
  PlantDefense,
  PlantForm,
  PlantGenome,
  PlantLeafMorphology,
  PlantMetabolism,
  PlantPropagation,
  PlantRootSystem,
  PlantSurfaceTexture,
  SkinPattern,
  SpeciesRecord,
} from './types';

export const ANIMAL_BODY_PLANS: readonly AnimalBodyPlan[] = [
  'segmented_eel',
  'fusiform_swimmer',
  'radial_medusa',
  'armored_trilopod',
  'winged_manta',
];

export const ANIMAL_APPENDAGES: readonly AnimalAppendage[] = [
  'pectoral_wings',
  'dorsal_crest',
  'trailing_tentacles',
  'stalked_eyes',
  'sensory_barbels',
  'ventral_keels',
  'feather_plumes',
];

export const ANIMAL_PARTS: readonly AnimalFunctionalPart[] = [
  'bioluminescent_lure',
  'chitin_spines',
  'mandibles',
  'stalked_eyes',
  'dorsal_crest',
  'electro_organs',
  'armored_scutes',
  'venom_barbs',
];

export const ANIMAL_DIETS: readonly AnimalDiet[] = [
  'Herbivore',
  'Carnivore',
  'Omnivore',
  'Scavenger',
  'Filter_Feeder',
];

export const ANIMAL_SOCIALS: readonly AnimalSocial[] = [
  'Schooling_Boids',
  'Solitary',
  'Territorial',
  'Pack_Hunter',
];

export const ANIMAL_COMBATS: readonly AnimalCombat[] = [
  'Ambush',
  'Melee_Ram',
  'Venom_Spines',
  'Evasive_Dart',
  'Electric_Pulse',
  'Ink_Cloud',
  'Armor_Brace',
];

export const ANIMAL_REPROS: readonly AnimalReproduction[] = [
  'Egg_Layer',
  'Live_Birth',
  'Binary_Fission',
];

export const SKIN_PATTERNS: readonly SkinPattern[] = [
  'striped',
  'spotted',
  'iridescent',
  'photophore',
  'marbled',
  'chevron',
  'ocellated',
  'abyssal_veins',
];

export const ANIMAL_INTEGUMENTS: readonly AnimalIntegument[] = [
  'smooth_mucus',
  'plated_scales',
  'chitin_carapace',
  'translucent_gel',
  'spined_dermal',
];

export const ANIMAL_SENSORIES: readonly AnimalSensory[] = [
  'binocular_optics',
  'electroreception',
  'chemo_barbels',
  'lateral_sonar',
  'thermal_pits',
];

export const ANIMAL_PHYSIOLOGIES: readonly AnimalPhysiology[] = [
  'ectothermic',
  'thermophilic',
  'photosymbiotic',
  'toxin_resistant',
  'hyper_metabolic',
];

export const PLANT_FORMS: readonly PlantForm[] = [
  'spiral_kelp',
  'bioluminescent_bulb',
  'coral_fan',
  'tendril_anemone',
  'spore_stalk',
  'ribbon_seagrass',
  'crystal_sponge',
];

export const PLANT_METABOLISMS: readonly PlantMetabolism[] = [
  'Photosynthetic',
  'Chemosynthetic',
  'Carnivorous_Flora',
  'Mixotrophic',
  'Detritivore_Fungi',
];

export const PLANT_PROPAGATIONS: readonly PlantPropagation[] = [
  'Drifting_Spores',
  'Weighted_Seeds',
  'Budding',
  'Rhizome_Runners',
  'Explosive_Pods',
];

export const PLANT_LEAF_MORPHOLOGIES: readonly PlantLeafMorphology[] = [
  'broad_blade',
  'serrated_frond',
  'feathered_plume',
  'succulent_lobe',
  'crystalline_lattice',
];

export const PLANT_DEFENSES: readonly PlantDefense[] = [
  'none',
  'alkaloid_toxin',
  'calcified_thorns',
  'mucus_sheath',
  'biolum_flash',
];

export const PLANT_ROOT_SYSTEMS: readonly PlantRootSystem[] = [
  'holdfast_anchor',
  'deep_rhizome',
  'symbiotic_mycelia',
  'pneumatocyst_float',
];

export const PLANT_SURFACE_TEXTURES: readonly PlantSurfaceTexture[] = [
  'veined',
  'porous_coral',
  'velvet_biofilm',
  'crystalline',
  'spined_bark',
];

const GENUS_A = [
  'Xeno', 'Lumi', 'Bathya', 'Velo', 'Aureli', 'Nautil', 'Phos',
  'Spiro', 'Thalas', 'Chitin', 'Manta', 'Viri', 'Pelagi', 'Glauc',
  'Abysso', 'Cryo', 'Cteno', 'Vesper', 'Electro', 'Pyro', 'Myco', 'Sili',
];

const GENUS_B = [
  'ris', 'morph', 'poda', 'nema', 'soma', 'dora', 'stoma',
  'phyta', 'cera', 'zoa', 'phora', 'vex', 'branchia', 'ptera', 'derma', 'phylla',
];

const EPITHETS = [
  'velox', 'lucens', 'abyssi', 'ferox', 'tenera', 'stellata', 'vorax',
  'cerulea', 'viridis', 'noctis', 'spina', 'mirabilis', 'profunda',
  'aurea', 'pelagica', 'scintilla', 'radiata', 'umbrosa', 'toxica', 'vitrea',
  'electrica', 'armata', 'rhizoma', 'chrysalis',
];

let nextSpeciesIdCounter = 1;
let nextEntityIdCounter = 1;

export function allocateSpeciesId(): number {
  return nextSpeciesIdCounter++;
}

export function allocateEntityId(): number {
  return nextEntityIdCounter++;
}

export function syncIdCounters(minSpeciesId: number, minEntityId: number): void {
  if (minSpeciesId >= nextSpeciesIdCounter) nextSpeciesIdCounter = minSpeciesId + 1;
  if (minEntityId >= nextEntityIdCounter) nextEntityIdCounter = minEntityId + 1;
}

export function resetIdCounters(): void {
  nextSpeciesIdCounter = 1;
  nextEntityIdCounter = 1;
}

export function generateSpeciesName(): string {
  return `${randChoice(GENUS_A)}${randChoice(GENUS_B)} ${randChoice(EPITHETS)}`;
}

/**
 * Tracks phylogenetic lineage, extant/extinct status, peak populations,
 * and generation depth for all fauna and flora species in the biosphere.
 */
export class SpeciesRegistry {
  private readonly records = new Map<string, SpeciesRecord>();

  private static key(kind: 'fauna' | 'flora', speciesId: number): string {
    return `${kind === 'fauna' ? 'A' : 'P'}_${speciesId}`;
  }

  clear(): void {
    this.records.clear();
  }

  registerAnimalBirth(genome: AnimalGenome, simTime: number): SpeciesRecord {
    const k = SpeciesRegistry.key('fauna', genome.speciesId);
    let rec = this.records.get(k);
    if (!rec) {
      rec = {
        speciesId: genome.speciesId,
        parentSpeciesId: genome.parentSpeciesId,
        kind: 'fauna',
        speciesName: genome.speciesName,
        foundedAt: simTime,
        extinctAt: null,
        peakPopulation: 0,
        currentPopulation: 0,
        totalBirths: 0,
        maxGeneration: genome.generation,
        baseHex: genome.baseHex,
        glowHex: genome.glowHex,
        primaryTrait: genome.bodyPlan,
        secondaryTrait: genome.diet,
        summaryTraits: [
          genome.bodyPlan,
          genome.diet,
          genome.physiology,
          genome.integument,
          genome.sensoryOrgan,
          genome.combat,
          genome.appendage,
          genome.functionalPart,
        ],
      };
      this.records.set(k, rec);
    }
    rec.totalBirths++;
    rec.maxGeneration = Math.max(rec.maxGeneration, genome.generation);
    rec.extinctAt = null;
    return rec;
  }

  registerPlantBirth(genome: PlantGenome, simTime: number): SpeciesRecord {
    const k = SpeciesRegistry.key('flora', genome.speciesId);
    let rec = this.records.get(k);
    if (!rec) {
      rec = {
        speciesId: genome.speciesId,
        parentSpeciesId: genome.parentSpeciesId,
        kind: 'flora',
        speciesName: genome.speciesName,
        foundedAt: simTime,
        extinctAt: null,
        peakPopulation: 0,
        currentPopulation: 0,
        totalBirths: 0,
        maxGeneration: genome.generation,
        baseHex: genome.baseHex,
        glowHex: genome.glowHex,
        primaryTrait: genome.form,
        secondaryTrait: genome.metabolism,
        summaryTraits: [
          genome.form,
          genome.metabolism,
          genome.leafMorphology,
          genome.defense !== 'none' ? genome.defense : genome.rootSystem,
          genome.propagation,
          genome.surfaceTexture,
        ],
      };
      this.records.set(k, rec);
    }
    rec.totalBirths++;
    rec.maxGeneration = Math.max(rec.maxGeneration, genome.generation);
    rec.extinctAt = null;
    return rec;
  }

  recomputeCounts(
    animals: readonly { alive: boolean; genome: AnimalGenome }[],
    plants: readonly { alive: boolean; genome: PlantGenome }[],
    simTime: number
  ): void {
    for (const rec of this.records.values()) {
      rec.currentPopulation = 0;
    }
    for (const a of animals) {
      if (!a.alive) continue;
      const rec = this.records.get(SpeciesRegistry.key('fauna', a.genome.speciesId));
      if (rec) {
        rec.currentPopulation++;
        if (rec.currentPopulation > rec.peakPopulation) rec.peakPopulation = rec.currentPopulation;
        rec.extinctAt = null;
      }
    }
    for (const p of plants) {
      if (!p.alive) continue;
      const rec = this.records.get(SpeciesRegistry.key('flora', p.genome.speciesId));
      if (rec) {
        rec.currentPopulation++;
        if (rec.currentPopulation > rec.peakPopulation) rec.peakPopulation = rec.currentPopulation;
        rec.extinctAt = null;
      }
    }
    for (const rec of this.records.values()) {
      if (rec.currentPopulation === 0 && rec.extinctAt === null) {
        rec.extinctAt = simTime;
      }
    }
  }

  getAll(): SpeciesRecord[] {
    return Array.from(this.records.values());
  }

  getExtantCount(): number {
    let n = 0;
    for (const rec of this.records.values()) {
      if (rec.currentPopulation > 0) n++;
    }
    return n;
  }

  exportRecords(): SpeciesRecord[] {
    return this.getAll().map((r) => ({ ...r, summaryTraits: [...r.summaryTraits] }));
  }

  importRecords(records: SpeciesRecord[]): void {
    this.records.clear();
    for (const r of records) {
      this.records.set(SpeciesRegistry.key(r.kind, r.speciesId), {
        ...r,
        summaryTraits: [...r.summaryTraits],
      });
    }
  }
}
