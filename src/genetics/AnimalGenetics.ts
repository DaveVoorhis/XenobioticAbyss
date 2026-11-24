import * as THREE from 'three';
import { clamp, randChoice, randInt, randRange } from '../core/math';
import {
  ANIMAL_APPENDAGES,
  ANIMAL_BODY_PLANS,
  ANIMAL_COMBATS,
  ANIMAL_DIETS,
  ANIMAL_INTEGUMENTS,
  ANIMAL_PARTS,
  ANIMAL_PHYSIOLOGIES,
  ANIMAL_REPROS,
  ANIMAL_SENSORIES,
  ANIMAL_SOCIALS,
  SKIN_PATTERNS,
  allocateSpeciesId,
  generateSpeciesName,
} from './taxonomy';
import type {
  AnimalBodyPlan,
  AnimalCombat,
  AnimalDiet,
  AnimalFunctionalPart,
  AnimalGenome,
  AnimalIntegument,
  AnimalPhysiology,
  AnimalSensory,
  DepthPreference,
} from './types';

function pickDepthPreference(diet: AnimalDiet, bodyPlan: AnimalBodyPlan): DepthPreference {
  if (diet === 'Scavenger' || bodyPlan === 'armored_trilopod') return 'benthic';
  if (bodyPlan === 'radial_medusa' || diet === 'Filter_Feeder') {
    return Math.random() < 0.6 ? 'surface' : 'midwater';
  }
  return randChoice(['surface', 'midwater', 'benthic']);
}

function pickInitialIntegument(bodyPlan: AnimalBodyPlan): AnimalIntegument {
  if (bodyPlan === 'armored_trilopod') {
    return Math.random() < 0.72 ? 'chitin_carapace' : 'spined_dermal';
  }
  if (bodyPlan === 'radial_medusa') {
    return Math.random() < 0.72 ? 'translucent_gel' : 'smooth_mucus';
  }
  return randChoice(ANIMAL_INTEGUMENTS);
}

function pickInitialSensory(diet: AnimalDiet, bodyPlan: AnimalBodyPlan): AnimalSensory {
  if (diet === 'Scavenger') {
    return Math.random() < 0.65 ? 'chemo_barbels' : randChoice(ANIMAL_SENSORIES);
  }
  if (diet === 'Carnivore') {
    return randChoice(['binocular_optics', 'electroreception', 'thermal_pits', 'lateral_sonar']);
  }
  if (bodyPlan === 'segmented_eel') {
    return Math.random() < 0.55 ? 'electroreception' : randChoice(ANIMAL_SENSORIES);
  }
  return randChoice(ANIMAL_SENSORIES);
}

function pickInitialPhysiology(diet: AnimalDiet): AnimalPhysiology {
  if (diet === 'Herbivore') {
    return randChoice(['ectothermic', 'toxin_resistant', 'photosymbiotic', 'ectothermic']);
  }
  if (diet === 'Carnivore') {
    return randChoice(['hyper_metabolic', 'ectothermic', 'thermophilic', 'toxin_resistant']);
  }
  if (diet === 'Filter_Feeder') {
    return randChoice(['photosymbiotic', 'ectothermic', 'thermophilic']);
  }
  return randChoice(ANIMAL_PHYSIOLOGIES);
}

function computeDerivedMaxHp(
  sizeScale: number,
  integument: AnimalIntegument,
  functionalPart: AnimalFunctionalPart,
  armorDensity: number
): number {
  let mult = 1.0 + armorDensity * 0.34;
  if (integument === 'chitin_carapace') mult += 0.2;
  else if (integument === 'plated_scales') mult += 0.1;
  else if (integument === 'translucent_gel') mult -= 0.12;
  if (functionalPart === 'armored_scutes') mult += 0.16;
  return Math.round((54 + sizeScale * 74) * clamp(mult, 0.72, 1.85));
}

function computeDerivedSpeed(
  baseSpeed: number,
  integument: AnimalIntegument,
  physiology: AnimalPhysiology,
  armorDensity: number,
  bodyElongation: number
): number {
  let mult = 1.0 - armorDensity * 0.14 + (bodyElongation - 1.0) * 0.12;
  if (integument === 'smooth_mucus') mult += 0.08;
  else if (integument === 'chitin_carapace') mult -= 0.07;
  if (physiology === 'hyper_metabolic') mult += 0.14;
  return clamp(baseSpeed * mult, 0.95, 4.35);
}

export function createAnimalGenome(
  forcedDiet: AnimalDiet | null = null,
  forcedPlan: AnimalBodyPlan | null = null
): AnimalGenome {
  const bodyPlan = forcedPlan ?? randChoice(ANIMAL_BODY_PLANS);
  const diet = forcedDiet ?? randChoice(ANIMAL_DIETS);
  const appendage = bodyPlan === 'winged_manta' ? 'pectoral_wings' : randChoice(ANIMAL_APPENDAGES);
  const functionalPart = randChoice(ANIMAL_PARTS);
  const integument = pickInitialIntegument(bodyPlan);
  const sensoryOrgan = pickInitialSensory(diet, bodyPlan);
  const physiology = pickInitialPhysiology(diet);

  let combat: AnimalCombat = randChoice(ANIMAL_COMBATS);
  if (diet === 'Carnivore') {
    combat = randChoice(['Melee_Ram', 'Ambush', 'Electric_Pulse', 'Melee_Ram']);
  } else if (diet === 'Herbivore' || diet === 'Filter_Feeder') {
    combat = randChoice(['Evasive_Dart', 'Venom_Spines', 'Ink_Cloud', 'Armor_Brace', 'Evasive_Dart']);
  }

  const social =
    diet === 'Carnivore' && Math.random() < 0.5
      ? 'Pack_Hunter'
      : (diet === 'Herbivore' || diet === 'Filter_Feeder') && Math.random() < 0.65
      ? 'Schooling_Boids'
      : randChoice(ANIMAL_SOCIALS);

  const reproduction = randChoice(ANIMAL_REPROS);
  const skinPattern = randChoice(SKIN_PATTERNS);
  const depthPref = pickDepthPreference(diet, bodyPlan);

  const hue = Math.random();
  const baseColor = new THREE.Color().setHSL(hue, randRange(0.54, 0.86), randRange(0.32, 0.54));
  const accentColor = new THREE.Color().setHSL(
    (hue + randRange(0.06, 0.16)) % 1.0,
    randRange(0.52, 0.84),
    randRange(0.45, 0.68)
  );
  const glowColor = new THREE.Color().setHSL(
    (hue + randRange(0.14, 0.42)) % 1.0,
    randRange(0.78, 0.98),
    randRange(0.55, 0.72)
  );

  const sizeScale =
    diet === 'Carnivore'
      ? randRange(0.56, 0.9)
      : diet === 'Scavenger'
      ? randRange(0.4, 0.6)
      : randRange(0.38, 0.68);

  const bodyElongation =
    bodyPlan === 'segmented_eel'
      ? randRange(1.06, 1.34)
      : bodyPlan === 'armored_trilopod'
      ? randRange(0.84, 1.12)
      : randRange(0.82, 1.24);

  const finSpan =
    bodyPlan === 'winged_manta' ? randRange(0.95, 1.34) : randRange(0.78, 1.28);

  const armorDensity = clamp(
    (integument === 'chitin_carapace'
      ? randRange(0.55, 0.95)
      : integument === 'plated_scales'
      ? randRange(0.32, 0.68)
      : integument === 'translucent_gel'
      ? randRange(0.02, 0.22)
      : randRange(0.12, 0.48)) + (functionalPart === 'armored_scutes' ? 0.18 : 0),
    0,
    1
  );

  const toxicity = clamp(
    (combat === 'Venom_Spines' || functionalPart === 'venom_barbs'
      ? randRange(0.48, 0.92)
      : randRange(0.0, 0.32)),
    0,
    1
  );

  const metabolicEfficiency = clamp(
    physiology === 'ectothermic'
      ? randRange(1.05, 1.28)
      : physiology === 'hyper_metabolic'
      ? randRange(0.76, 0.98)
      : randRange(0.86, 1.16),
    0.72,
    1.34
  );

  const rawSpeed =
    bodyPlan === 'fusiform_swimmer'
      ? randRange(2.45, 3.65)
      : bodyPlan === 'winged_manta'
      ? randRange(1.85, 2.85)
      : bodyPlan === 'radial_medusa'
      ? randRange(1.0, 1.72)
      : randRange(1.65, 2.75);

  const speed = computeDerivedSpeed(rawSpeed, integument, physiology, armorDensity, bodyElongation);
  const maxHp = computeDerivedMaxHp(sizeScale, integument, functionalPart, armorDensity);

  const baseVision = diet === 'Carnivore' ? randRange(7.8, 10.8) : randRange(6.0, 8.8);
  const visionBonus =
    sensoryOrgan === 'electroreception' || functionalPart === 'electro_organs'
      ? 1.12
      : sensoryOrgan === 'binocular_optics'
      ? 1.08
      : 1.0;

  return {
    speciesId: allocateSpeciesId(),
    parentSpeciesId: null,
    speciesName: generateSpeciesName(),
    generation: 1,
    bodyPlan,
    appendage,
    functionalPart,
    diet,
    social,
    combat,
    reproduction,
    skinPattern,
    integument,
    sensoryOrgan,
    physiology,
    depthPref,
    sizeScale,
    bodyElongation,
    finSpan,
    armorDensity,
    toxicity,
    metabolicEfficiency,
    speed,
    visionRange: clamp(baseVision * visionBonus, 5.4, 12.6),
    maxHp,
    attackPower:
      diet === 'Carnivore'
        ? randRange(16, 25)
        : diet === 'Omnivore'
        ? randRange(10, 16)
        : randRange(5, 10),
    maxAge: randRange(135, 220),
    baseHex: baseColor.getHex(),
    accentHex: accentColor.getHex(),
    glowHex: glowColor.getHex(),
    segments: bodyPlan === 'segmented_eel' ? randInt(7, 10) : 4,
    wingFreq: bodyPlan === 'winged_manta' ? randRange(1.3, 2.2) : randRange(1.55, 2.55),
    swimFreq: randRange(2.1, 3.5),
    paddleFreq: randRange(2.5, 3.9),
    biolumIntensity: randRange(0.55, 1.1),
  };
}

/**
 * Ensures older snapshot animal genomes missing newly introduced evolutionary loci
 * hydrate cleanly with deterministic biologically valid defaults.
 */
export function normalizeAnimalGenome(raw: AnimalGenome): AnimalGenome {
  const integument: AnimalIntegument =
    raw.integument ?? pickInitialIntegument(raw.bodyPlan);
  const sensoryOrgan: AnimalSensory =
    raw.sensoryOrgan ?? pickInitialSensory(raw.diet, raw.bodyPlan);
  const physiology: AnimalPhysiology =
    raw.physiology ?? pickInitialPhysiology(raw.diet);
  const bodyElongation = Number.isFinite(raw.bodyElongation) ? clamp(raw.bodyElongation, 0.72, 1.42) : 1.0;
  const finSpan = Number.isFinite(raw.finSpan) ? clamp(raw.finSpan, 0.72, 1.42) : 1.0;
  const armorDensity = Number.isFinite(raw.armorDensity)
    ? clamp(raw.armorDensity, 0, 1)
    : integument === 'chitin_carapace'
    ? 0.65
    : 0.25;
  const toxicity = Number.isFinite(raw.toxicity)
    ? clamp(raw.toxicity, 0, 1)
    : raw.combat === 'Venom_Spines'
    ? 0.65
    : 0.1;
  const metabolicEfficiency = Number.isFinite(raw.metabolicEfficiency)
    ? clamp(raw.metabolicEfficiency, 0.72, 1.34)
    : 1.0;

  return {
    ...raw,
    integument,
    sensoryOrgan,
    physiology,
    bodyElongation,
    finSpan,
    armorDensity,
    toxicity,
    metabolicEfficiency,
  };
}

export interface AnimalRecombinationResult {
  genome: AnimalGenome;
  speciated: boolean;
}

export function recombineAnimalGenomes(
  gA: AnimalGenome,
  gB: AnimalGenome | null,
  mutationRateMultiplier = 1.0,
  forceSpeciation = false
): AnimalRecombinationResult {
  const pA = normalizeAnimalGenome(gA);
  const pB = gB ? normalizeAnimalGenome(gB) : pA;

  const pick = <K extends keyof AnimalGenome>(k: K): AnimalGenome[K] =>
    Math.random() < 0.5 ? pA[k] : pB[k];

  const baseMutProb = clamp(0.12 * mutationRateMultiplier, 0.02, 0.65);
  let mutations = 0;
  const mut = <T>(val: T, pool: readonly T[]): T => {
    if (Math.random() < baseMutProb) {
      const next = randChoice(pool);
      if (next !== val) mutations++;
      return next;
    }
    return val;
  };

  let bodyPlan = mut(pick('bodyPlan'), ANIMAL_BODY_PLANS);
  const diet = mut(pick('diet'), ANIMAL_DIETS);
  let integument = mut(pick('integument'), ANIMAL_INTEGUMENTS);
  let sensoryOrgan = mut(pick('sensoryOrgan'), ANIMAL_SENSORIES);
  let physiology = mut(pick('physiology'), ANIMAL_PHYSIOLOGIES);

  if (forceSpeciation && mutations < 2 && bodyPlan === pA.bodyPlan && diet === pA.diet) {
    // Guarantee dramatic, unmistakable evolutionary divergence on forced mutation
    if (Math.random() < 0.6) {
      bodyPlan = randChoice(ANIMAL_BODY_PLANS.filter((p) => p !== pA.bodyPlan));
    } else {
      integument = randChoice(ANIMAL_INTEGUMENTS.filter((x) => x !== pA.integument));
      physiology = randChoice(ANIMAL_PHYSIOLOGIES.filter((x) => x !== pA.physiology));
      sensoryOrgan = randChoice(ANIMAL_SENSORIES.filter((x) => x !== pA.sensoryOrgan));
    }
    mutations += 2;
  }

  const appendage =
    bodyPlan === 'winged_manta' ? 'pectoral_wings' : mut(pick('appendage'), ANIMAL_APPENDAGES);
  const functionalPart = mut(pick('functionalPart'), ANIMAL_PARTS);
  const social = mut(pick('social'), ANIMAL_SOCIALS);
  const combat = mut(pick('combat'), ANIMAL_COMBATS);
  const reproduction = mut(pick('reproduction'), ANIMAL_REPROS);
  const skinPattern = mut(pick('skinPattern'), SKIN_PATTERNS);
  const depthPref =
    Math.random() < baseMutProb ? pickDepthPreference(diet, bodyPlan) : pick('depthPref');

  // Pigment recombination + subtle drift
  const cMix = new THREE.Color(pA.baseHex).lerp(new THREE.Color(pB.baseHex), 0.5);
  const hsl = { h: 0, s: 0, l: 0 };
  cMix.getHSL(hsl);
  const hueShift = forceSpeciation ? randRange(0.12, 0.32) : randRange(-0.055, 0.055);
  cMix.setHSL(
    (hsl.h + hueShift + 1.0) % 1.0,
    clamp(hsl.s + randRange(-0.05, 0.05), 0.45, 0.9),
    clamp(hsl.l + randRange(-0.04, 0.04), 0.28, 0.64)
  );

  const accMix = new THREE.Color(pA.accentHex).lerp(new THREE.Color(pB.accentHex), 0.5);
  const gMix = new THREE.Color(pA.glowHex).lerp(new THREE.Color(pB.glowHex), 0.5);
  if (forceSpeciation) {
    const ghsl = { h: 0, s: 0, l: 0 };
    gMix.getHSL(ghsl);
    gMix.setHSL((ghsl.h + randRange(0.15, 0.35)) % 1.0, 0.9, 0.65);
  }

  // Quantitative trait recombination (mid-parent blending + evolutionary drift)
  const qScale = forceSpeciation ? 2.1 : 1.0;
  const sizeScale = clamp(
    (pA.sizeScale + pB.sizeScale) * 0.5 * randRange(1 - 0.08 * qScale, 1 + 0.08 * qScale),
    0.35,
    0.96
  );
  const bodyElongation = clamp(
    (pA.bodyElongation + pB.bodyElongation) * 0.5 + randRange(-0.09, 0.09) * qScale,
    0.72,
    1.42
  );
  const finSpan = clamp(
    (pA.finSpan + pB.finSpan) * 0.5 + randRange(-0.09, 0.09) * qScale,
    0.72,
    1.42
  );
  const armorDensity = clamp(
    (pA.armorDensity + pB.armorDensity) * 0.5 + randRange(-0.1, 0.1) * qScale,
    0,
    1
  );
  const toxicity = clamp(
    (pA.toxicity + pB.toxicity) * 0.5 + randRange(-0.1, 0.1) * qScale,
    0,
    1
  );
  const metabolicEfficiency = clamp(
    (pA.metabolicEfficiency + pB.metabolicEfficiency) * 0.5 + randRange(-0.07, 0.07) * qScale,
    0.72,
    1.34
  );

  const avgSpeed = (pA.speed + pB.speed) * 0.5 * randRange(0.94, 1.06);
  const speed = computeDerivedSpeed(avgSpeed, integument, physiology, armorDensity, bodyElongation);
  const maxHp = computeDerivedMaxHp(sizeScale, integument, functionalPart, armorDensity);

  const majorShift =
    bodyPlan !== pA.bodyPlan ||
    diet !== pA.diet ||
    (physiology !== pA.physiology && integument !== pA.integument);
  const speciated = forceSpeciation || mutations >= 2 || majorShift;

  return {
    speciated,
    genome: {
      speciesId: speciated ? allocateSpeciesId() : pA.speciesId,
      parentSpeciesId: speciated ? pA.speciesId : pA.parentSpeciesId,
      speciesName: speciated ? generateSpeciesName() : pA.speciesName,
      generation: Math.max(pA.generation, pB.generation) + 1,
      bodyPlan,
      appendage,
      functionalPart,
      diet,
      social,
      combat,
      reproduction,
      skinPattern,
      integument,
      sensoryOrgan,
      physiology,
      depthPref,
      sizeScale,
      bodyElongation,
      finSpan,
      armorDensity,
      toxicity,
      metabolicEfficiency,
      speed,
      visionRange: clamp((pA.visionRange + pB.visionRange) * 0.5 * randRange(0.95, 1.06), 5.4, 12.6),
      maxHp,
      attackPower: clamp((pA.attackPower + pB.attackPower) * 0.5 * randRange(0.92, 1.08), 5, 30),
      maxAge: clamp((pA.maxAge + pB.maxAge) * 0.5 * randRange(0.93, 1.07), 125, 250),
      baseHex: cMix.getHex(),
      accentHex: accMix.getHex(),
      glowHex: gMix.getHex(),
      segments:
        bodyPlan === 'segmented_eel'
          ? clamp(Math.round((pA.segments + pB.segments) * 0.5) + randInt(-1, 1), 6, 11)
          : 4,
      wingFreq:
        bodyPlan === 'winged_manta'
          ? clamp((pA.wingFreq + pB.wingFreq) * 0.5 * randRange(0.95, 1.05), 1.3, 2.2)
          : clamp((pA.wingFreq + pB.wingFreq) * 0.5 * randRange(0.95, 1.05), 1.55, 2.55),
      swimFreq: clamp((pA.swimFreq + pB.swimFreq) * 0.5 * randRange(0.95, 1.05), 1.9, 3.6),
      paddleFreq: clamp((pA.paddleFreq + pB.paddleFreq) * 0.5 * randRange(0.95, 1.05), 2.3, 4.0),
      biolumIntensity: clamp(
        (pA.biolumIntensity + pB.biolumIntensity) * 0.5 * randRange(0.9, 1.12),
        0.4,
        1.35
      ),
    },
  };
}
