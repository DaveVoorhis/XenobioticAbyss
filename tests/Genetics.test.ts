import { describe, expect, it } from 'vitest';
import {
  createAnimalGenome,
  normalizeAnimalGenome,
  recombineAnimalGenomes,
} from '../src/genetics/AnimalGenetics';
import {
  createPlantGenome,
  mutatePlantGenome,
  normalizePlantGenome,
  recombinePlantGenomes,
} from '../src/genetics/PlantGenetics';
import {
  ANIMAL_APPENDAGES,
  ANIMAL_COMBATS,
  ANIMAL_INTEGUMENTS,
  ANIMAL_PARTS,
  ANIMAL_PHYSIOLOGIES,
  ANIMAL_SENSORIES,
  PLANT_DEFENSES,
  PLANT_FORMS,
  PLANT_LEAF_MORPHOLOGIES,
  PLANT_METABOLISMS,
  PLANT_PROPAGATIONS,
  PLANT_ROOT_SYSTEMS,
  PLANT_SURFACE_TEXTURES,
  SKIN_PATTERNS,
  SpeciesRegistry,
} from '../src/genetics/taxonomy';

describe('Genetics & Speciation', () => {
  it('creates valid animal genomes with expanded recombinant and variant loci', () => {
    const g = createAnimalGenome('Carnivore', 'winged_manta');
    expect(g.diet).toBe('Carnivore');
    expect(g.bodyPlan).toBe('winged_manta');
    expect(g.appendage).toBe('pectoral_wings');
    expect(ANIMAL_INTEGUMENTS).toContain(g.integument);
    expect(ANIMAL_SENSORIES).toContain(g.sensoryOrgan);
    expect(ANIMAL_PHYSIOLOGIES).toContain(g.physiology);
    expect(ANIMAL_PARTS).toContain(g.functionalPart);
    expect(ANIMAL_COMBATS).toContain(g.combat);
    expect(SKIN_PATTERNS).toContain(g.skinPattern);
    expect(g.sizeScale).toBeGreaterThanOrEqual(0.35);
    expect(g.bodyElongation).toBeGreaterThanOrEqual(0.72);
    expect(g.finSpan).toBeGreaterThanOrEqual(0.72);
    expect(g.armorDensity).toBeGreaterThanOrEqual(0);
    expect(g.armorDensity).toBeLessThanOrEqual(1);
    expect(g.toxicity).toBeGreaterThanOrEqual(0);
    expect(g.toxicity).toBeLessThanOrEqual(1);
    expect(g.metabolicEfficiency).toBeGreaterThanOrEqual(0.72);
    expect(g.maxHp).toBeGreaterThan(50);
  });

  it('produces new species with parent lineage when speciation is forced', () => {
    const parent = createAnimalGenome('Herbivore', 'fusiform_swimmer');
    const { genome: mutant, speciated } = recombineAnimalGenomes(parent, null, 2.0, true);
    expect(speciated).toBe(true);
    expect(mutant.speciesId).not.toBe(parent.speciesId);
    expect(mutant.parentSpeciesId).toBe(parent.speciesId);
    expect(mutant.generation).toBe(parent.generation + 1);
  });

  it('recombines distinct animal parental traits across independent loci', () => {
    const pA = createAnimalGenome('Herbivore', 'fusiform_swimmer');
    pA.integument = 'chitin_carapace';
    pA.sensoryOrgan = 'electroreception';
    pA.physiology = 'toxin_resistant';
    pA.appendage = 'sensory_barbels';
    pA.armorDensity = 0.9;
    pA.bodyElongation = 1.3;

    const pB = createAnimalGenome('Herbivore', 'fusiform_swimmer');
    pB.integument = 'translucent_gel';
    pB.sensoryOrgan = 'thermal_pits';
    pB.physiology = 'photosymbiotic';
    pB.appendage = 'feather_plumes';
    pB.armorDensity = 0.1;
    pB.bodyElongation = 0.8;

    let sawAInteg = false;
    let sawBInteg = false;
    let sawASens = false;
    let sawBSens = false;
    for (let i = 0; i < 40; i++) {
      const { genome: child } = recombineAnimalGenomes(pA, pB, 0.1, false);
      if (child.integument === 'chitin_carapace') sawAInteg = true;
      if (child.integument === 'translucent_gel') sawBInteg = true;
      if (child.sensoryOrgan === 'electroreception') sawASens = true;
      if (child.sensoryOrgan === 'thermal_pits') sawBSens = true;
      expect(ANIMAL_APPENDAGES).toContain(child.appendage);
      expect(child.armorDensity).toBeGreaterThanOrEqual(0);
      expect(child.armorDensity).toBeLessThanOrEqual(1);
    }
    expect(sawAInteg && sawBInteg).toBe(true);
    expect(sawASens && sawBSens).toBe(true);
  });

  it('tracks extant and extinct species counts in SpeciesRegistry', () => {
    const reg = new SpeciesRegistry();
    const aGen = createAnimalGenome('Omnivore', 'segmented_eel');
    const pGen = createPlantGenome('Photosynthetic', 'spiral_kelp');

    reg.registerAnimalBirth(aGen, 0);
    reg.registerPlantBirth(pGen, 0);

    reg.recomputeCounts([{ alive: true, genome: aGen }], [{ alive: true, genome: pGen }], 5);
    expect(reg.getExtantCount()).toBe(2);

    // Animal goes extinct
    reg.recomputeCounts([], [{ alive: true, genome: pGen }], 15);
    expect(reg.getExtantCount()).toBe(1);
    const extinct = reg.getAll().find((r) => r.speciesId === aGen.speciesId);
    expect(extinct?.extinctAt).toBe(15);
  });

  it('creates, mutates, and sexually cross-pollinates expanded plant genomes cleanly', () => {
    const pA = createPlantGenome('Mixotrophic', 'ribbon_seagrass');
    expect(PLANT_FORMS).toContain(pA.form);
    expect(PLANT_METABOLISMS).toContain(pA.metabolism);
    expect(PLANT_PROPAGATIONS).toContain(pA.propagation);
    expect(PLANT_LEAF_MORPHOLOGIES).toContain(pA.leafMorphology);
    expect(PLANT_DEFENSES).toContain(pA.defense);
    expect(PLANT_ROOT_SYSTEMS).toContain(pA.rootSystem);
    expect(PLANT_SURFACE_TEXTURES).toContain(pA.surfaceTexture);

    pA.defense = 'alkaloid_toxin';
    pA.rootSystem = 'deep_rhizome';
    pA.leafMorphology = 'serrated_frond';

    const pB = createPlantGenome('Detritivore_Fungi', 'crystal_sponge');
    pB.defense = 'calcified_thorns';
    pB.rootSystem = 'pneumatocyst_float';
    pB.leafMorphology = 'crystalline_lattice';

    let sawADef = false;
    let sawBDef = false;
    let sawARoot = false;
    let sawBRoot = false;
    for (let i = 0; i < 40; i++) {
      const { genome: hybrid } = recombinePlantGenomes(pA, pB, 0.1, false);
      if (hybrid.defense === 'alkaloid_toxin') sawADef = true;
      if (hybrid.defense === 'calcified_thorns') sawBDef = true;
      if (hybrid.rootSystem === 'deep_rhizome') sawARoot = true;
      if (hybrid.rootSystem === 'pneumatocyst_float') sawBRoot = true;
      expect(hybrid.canopySpread).toBeGreaterThanOrEqual(0.72);
      expect(hybrid.nutrientEfficiency).toBeGreaterThanOrEqual(0.72);
    }
    expect(sawADef && sawBDef).toBe(true);
    expect(sawARoot && sawBRoot).toBe(true);

    const forced = mutatePlantGenome(pA, 2.0, true);
    expect(forced.speciated).toBe(true);
    expect(forced.genome.speciesId).not.toBe(pA.speciesId);
    expect(forced.genome.generation).toBe(pA.generation + 1);
  });

  it('hydrates legacy snapshot genomes missing new recombinant fields', () => {
    const rawAnimal = { ...createAnimalGenome('Herbivore', 'fusiform_swimmer') } as any;
    delete rawAnimal.integument;
    delete rawAnimal.sensoryOrgan;
    delete rawAnimal.physiology;
    delete rawAnimal.bodyElongation;
    delete rawAnimal.armorDensity;

    const normA = normalizeAnimalGenome(rawAnimal);
    expect(ANIMAL_INTEGUMENTS).toContain(normA.integument);
    expect(ANIMAL_SENSORIES).toContain(normA.sensoryOrgan);
    expect(ANIMAL_PHYSIOLOGIES).toContain(normA.physiology);
    expect(Number.isFinite(normA.bodyElongation)).toBe(true);
    expect(Number.isFinite(normA.armorDensity)).toBe(true);

    const rawPlant = { ...createPlantGenome('Photosynthetic', 'spiral_kelp') } as any;
    delete rawPlant.leafMorphology;
    delete rawPlant.defense;
    delete rawPlant.rootSystem;
    delete rawPlant.surfaceTexture;
    delete rawPlant.canopySpread;

    const normP = normalizePlantGenome(rawPlant);
    expect(PLANT_LEAF_MORPHOLOGIES).toContain(normP.leafMorphology);
    expect(PLANT_DEFENSES).toContain(normP.defense);
    expect(PLANT_ROOT_SYSTEMS).toContain(normP.rootSystem);
    expect(PLANT_SURFACE_TEXTURES).toContain(normP.surfaceTexture);
    expect(Number.isFinite(normP.canopySpread)).toBe(true);
  });
});
