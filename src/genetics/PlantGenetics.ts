import * as THREE from 'three';
import { clamp, randChoice, randInt, randRange } from '../core/math';
import {
  PLANT_DEFENSES,
  PLANT_FORMS,
  PLANT_LEAF_MORPHOLOGIES,
  PLANT_METABOLISMS,
  PLANT_PROPAGATIONS,
  PLANT_ROOT_SYSTEMS,
  PLANT_SURFACE_TEXTURES,
  allocateSpeciesId,
  generateSpeciesName,
} from './taxonomy';
import type {
  PlantDefense,
  PlantForm,
  PlantGenome,
  PlantLeafMorphology,
  PlantMetabolism,
  PlantPropagation,
  PlantRootSystem,
  PlantSurfaceTexture,
} from './types';

function pickInitialLeafMorphology(form: PlantForm): PlantLeafMorphology {
  if (form === 'ribbon_seagrass') return Math.random() < 0.65 ? 'serrated_frond' : 'broad_blade';
  if (form === 'crystal_sponge') return Math.random() < 0.7 ? 'crystalline_lattice' : 'succulent_lobe';
  if (form === 'coral_fan') return Math.random() < 0.55 ? 'crystalline_lattice' : 'feathered_plume';
  if (form === 'bioluminescent_bulb') return Math.random() < 0.6 ? 'succulent_lobe' : 'broad_blade';
  return randChoice(PLANT_LEAF_MORPHOLOGIES);
}

function pickInitialSurfaceTexture(form: PlantForm): PlantSurfaceTexture {
  if (form === 'coral_fan') return 'porous_coral';
  if (form === 'crystal_sponge') return Math.random() < 0.6 ? 'crystalline' : 'porous_coral';
  if (form === 'tendril_anemone') return 'velvet_biofilm';
  if (form === 'spore_stalk') return Math.random() < 0.55 ? 'velvet_biofilm' : 'spined_bark';
  return randChoice(PLANT_SURFACE_TEXTURES);
}

function pickInitialRootSystem(form: PlantForm, propagation: PlantPropagation): PlantRootSystem {
  if (propagation === 'Rhizome_Runners') return 'deep_rhizome';
  if (form === 'spiral_kelp') return Math.random() < 0.6 ? 'pneumatocyst_float' : 'holdfast_anchor';
  if (form === 'spore_stalk') return Math.random() < 0.6 ? 'symbiotic_mycelia' : 'deep_rhizome';
  return randChoice(PLANT_ROOT_SYSTEMS);
}

export function createPlantGenome(
  forcedMetabolism: PlantMetabolism | null = null,
  forcedForm: PlantForm | null = null
): PlantGenome {
  const form = forcedForm ?? randChoice(PLANT_FORMS);
  const metabolism: PlantMetabolism =
    forcedMetabolism ??
    (form === 'tendril_anemone'
      ? 'Carnivorous_Flora'
      : form === 'spore_stalk' && Math.random() < 0.5
      ? 'Detritivore_Fungi'
      : form === 'crystal_sponge' && Math.random() < 0.55
      ? 'Chemosynthetic'
      : randChoice(PLANT_METABOLISMS));

  const propagation: PlantPropagation =
    form === 'ribbon_seagrass' && Math.random() < 0.55
      ? 'Rhizome_Runners'
      : randChoice(PLANT_PROPAGATIONS);

  const leafMorphology = pickInitialLeafMorphology(form);
  const defense: PlantDefense =
    metabolism === 'Carnivorous_Flora'
      ? randChoice(['alkaloid_toxin', 'biolum_flash', 'mucus_sheath'])
      : randChoice(PLANT_DEFENSES);
  const rootSystem = pickInitialRootSystem(form, propagation);
  const surfaceTexture = pickInitialSurfaceTexture(form);

  const hue =
    metabolism === 'Photosynthetic'
      ? randRange(0.24, 0.46)
      : metabolism === 'Chemosynthetic'
      ? randRange(0.48, 0.64)
      : metabolism === 'Mixotrophic'
      ? randRange(0.36, 0.56)
      : metabolism === 'Detritivore_Fungi'
      ? randRange(0.06, 0.18)
      : randRange(0.83, 0.98);

  const baseColor = new THREE.Color().setHSL(hue, randRange(0.54, 0.85), randRange(0.24, 0.44));
  const accentColor = new THREE.Color().setHSL(
    (hue + randRange(0.04, 0.1)) % 1.0,
    randRange(0.55, 0.86),
    randRange(0.36, 0.56)
  );
  const glowColor = new THREE.Color().setHSL(
    (hue + randRange(0.09, 0.22)) % 1.0,
    randRange(0.78, 0.98),
    randRange(0.54, 0.72)
  );

  const toxicity =
    defense === 'alkaloid_toxin'
      ? randRange(0.52, 0.94)
      : defense === 'calcified_thorns'
      ? randRange(0.22, 0.52)
      : randRange(0.0, 0.24);

  const nutrientEfficiency =
    rootSystem === 'deep_rhizome' || rootSystem === 'symbiotic_mycelia' || metabolism === 'Detritivore_Fungi'
      ? randRange(1.05, 1.32)
      : randRange(0.82, 1.16);

  const canopySpread =
    form === 'coral_fan' || form === 'ribbon_seagrass'
      ? randRange(0.95, 1.32)
      : randRange(0.8, 1.24);

  const biolumIntensity =
    metabolism === 'Chemosynthetic' || form === 'bioluminescent_bulb' || defense === 'biolum_flash'
      ? randRange(0.82, 1.3)
      : randRange(0.45, 0.96);

  const maxHeight =
    form === 'spiral_kelp'
      ? randRange(1.55, 2.55)
      : form === 'ribbon_seagrass'
      ? randRange(1.2, 2.05)
      : form === 'crystal_sponge'
      ? randRange(0.92, 1.68)
      : randRange(0.82, 1.55);

  const frondCount =
    form === 'tendril_anemone'
      ? randInt(7, 10)
      : form === 'ribbon_seagrass'
      ? randInt(6, 10)
      : form === 'crystal_sponge'
      ? randInt(4, 7)
      : randInt(4, 8);

  return {
    speciesId: allocateSpeciesId(),
    parentSpeciesId: null,
    speciesName: generateSpeciesName(),
    generation: 1,
    form,
    metabolism,
    propagation,
    leafMorphology,
    defense,
    rootSystem,
    surfaceTexture,
    maxHeight,
    frondCount,
    canopySpread,
    toxicity,
    nutrientEfficiency,
    biolumIntensity,
    maxAge: randRange(160, 245),
    baseHex: baseColor.getHex(),
    accentHex: accentColor.getHex(),
    glowHex: glowColor.getHex(),
    swayFreq: randRange(0.82, 1.42),
  };
}

/**
 * Ensures older snapshot plant genomes missing new recombinant loci
 * hydrate cleanly with valid botanical defaults.
 */
export function normalizePlantGenome(raw: PlantGenome): PlantGenome {
  return {
    ...raw,
    leafMorphology: raw.leafMorphology ?? pickInitialLeafMorphology(raw.form),
    defense: raw.defense ?? 'none',
    rootSystem: raw.rootSystem ?? pickInitialRootSystem(raw.form, raw.propagation),
    surfaceTexture: raw.surfaceTexture ?? pickInitialSurfaceTexture(raw.form),
    canopySpread: Number.isFinite(raw.canopySpread) ? clamp(raw.canopySpread, 0.72, 1.4) : 1.0,
    toxicity: Number.isFinite(raw.toxicity) ? clamp(raw.toxicity, 0, 1) : 0.1,
    nutrientEfficiency: Number.isFinite(raw.nutrientEfficiency)
      ? clamp(raw.nutrientEfficiency, 0.72, 1.4)
      : 1.0,
    biolumIntensity: Number.isFinite(raw.biolumIntensity)
      ? clamp(raw.biolumIntensity, 0.35, 1.38)
      : raw.metabolism === 'Chemosynthetic'
      ? 0.92
      : 0.62,
  };
}

export interface PlantMutationResult {
  genome: PlantGenome;
  speciated: boolean;
}

/**
 * Sexual cross-pollination & asexual mutation recombination for flora.
 * Recombines discrete anatomical/ecological traits and blends quantitative
 * traits & pigments across parentA and optional pollen-donor parentB.
 */
export function recombinePlantGenomes(
  parentA: PlantGenome,
  parentB: PlantGenome | null,
  mutationRateMultiplier = 1.0,
  forceSpeciation = false
): PlantMutationResult {
  const pA = normalizePlantGenome(parentA);
  const pB = parentB ? normalizePlantGenome(parentB) : pA;

  const pick = <K extends keyof PlantGenome>(k: K): PlantGenome[K] =>
    Math.random() < 0.5 ? pA[k] : pB[k];

  const mutProb = clamp(0.13 * mutationRateMultiplier, 0.02, 0.65);
  let mutations = 0;
  const mut = <T>(val: T, pool: readonly T[]): T => {
    if (Math.random() < mutProb) {
      const next = randChoice(pool);
      if (next !== val) mutations++;
      return next;
    }
    return val;
  };

  let form = mut(pick('form'), PLANT_FORMS);
  let metabolism = mut(pick('metabolism'), PLANT_METABOLISMS);
  const propagation = mut(pick('propagation'), PLANT_PROPAGATIONS);
  let leafMorphology = mut(pick('leafMorphology'), PLANT_LEAF_MORPHOLOGIES);
  let defense = mut(pick('defense'), PLANT_DEFENSES);
  const rootSystem = mut(pick('rootSystem'), PLANT_ROOT_SYSTEMS);
  const surfaceTexture = mut(pick('surfaceTexture'), PLANT_SURFACE_TEXTURES);

  if (forceSpeciation && mutations < 2 && form === pA.form && metabolism === pA.metabolism) {
    if (Math.random() < 0.65) {
      form = randChoice(PLANT_FORMS.filter((f) => f !== pA.form));
    } else {
      metabolism = randChoice(PLANT_METABOLISMS.filter((m) => m !== pA.metabolism));
      defense = randChoice(PLANT_DEFENSES.filter((d) => d !== pA.defense));
      leafMorphology = randChoice(PLANT_LEAF_MORPHOLOGIES.filter((l) => l !== pA.leafMorphology));
    }
    mutations += 2;
  }

  // Blend pigments across parents + drift
  const cMix = new THREE.Color(pA.baseHex).lerp(new THREE.Color(pB.baseHex), 0.5);
  const hsl = { h: 0, s: 0, l: 0 };
  cMix.getHSL(hsl);
  cMix.setHSL(
    (hsl.h + (forceSpeciation ? randRange(0.14, 0.28) : randRange(-0.045, 0.045)) + 1.0) % 1.0,
    clamp(hsl.s + randRange(-0.05, 0.05), 0.45, 0.9),
    clamp(hsl.l + randRange(-0.04, 0.04), 0.22, 0.52)
  );

  const accMix = new THREE.Color(pA.accentHex).lerp(new THREE.Color(pB.accentHex), 0.5);
  const gMix = new THREE.Color(pA.glowHex).lerp(new THREE.Color(pB.glowHex), 0.5);
  if (forceSpeciation) {
    const ghsl = { h: 0, s: 0, l: 0 };
    gMix.getHSL(ghsl);
    gMix.setHSL((ghsl.h + randRange(0.16, 0.3)) % 1.0, clamp(ghsl.s, 0.72, 0.98), clamp(ghsl.l, 0.5, 0.72));
  }

  const qScale = forceSpeciation ? 2.0 : 1.0;
  const maxHeight = clamp(
    (pA.maxHeight + pB.maxHeight) * 0.5 * randRange(1 - 0.08 * qScale, 1 + 0.08 * qScale),
    0.72,
    2.75
  );
  const frondCount = clamp(
    Math.round((pA.frondCount + pB.frondCount) * 0.5) + (Math.random() < mutProb ? randInt(-1, 1) : 0),
    3,
    11
  );
  const canopySpread = clamp(
    (pA.canopySpread + pB.canopySpread) * 0.5 + randRange(-0.08, 0.08) * qScale,
    0.72,
    1.4
  );
  const toxicity = clamp(
    (pA.toxicity + pB.toxicity) * 0.5 + randRange(-0.09, 0.09) * qScale,
    0,
    1
  );
  const nutrientEfficiency = clamp(
    (pA.nutrientEfficiency + pB.nutrientEfficiency) * 0.5 + randRange(-0.08, 0.08) * qScale,
    0.72,
    1.4
  );
  const biolumIntensity = clamp(
    (pA.biolumIntensity + pB.biolumIntensity) * 0.5 + randRange(-0.09, 0.09) * qScale,
    0.35,
    1.38
  );

  const majorShift =
    form !== pA.form ||
    metabolism !== pA.metabolism ||
    (defense !== pA.defense && leafMorphology !== pA.leafMorphology);
  const speciated = forceSpeciation || mutations >= 2 || majorShift;

  return {
    speciated,
    genome: {
      speciesId: speciated ? allocateSpeciesId() : pA.speciesId,
      parentSpeciesId: speciated ? pA.speciesId : pA.parentSpeciesId,
      speciesName: speciated ? generateSpeciesName() : pA.speciesName,
      generation: Math.max(pA.generation, pB.generation) + 1,
      form,
      metabolism,
      propagation,
      leafMorphology,
      defense,
      rootSystem,
      surfaceTexture,
      maxHeight,
      frondCount,
      canopySpread,
      toxicity,
      nutrientEfficiency,
      biolumIntensity,
      maxAge: clamp((pA.maxAge + pB.maxAge) * 0.5 * randRange(0.94, 1.06), 145, 275),
      baseHex: cMix.getHex(),
      accentHex: accMix.getHex(),
      glowHex: gMix.getHex(),
      swayFreq: clamp((pA.swayFreq + pB.swayFreq) * 0.5 * randRange(0.94, 1.06), 0.72, 1.65),
    },
  };
}

export function mutatePlantGenome(
  parent: PlantGenome,
  mutationRateMultiplier = 1.0,
  forceSpeciation = false
): PlantMutationResult {
  return recombinePlantGenomes(parent, null, mutationRateMultiplier, forceSpeciation);
}
