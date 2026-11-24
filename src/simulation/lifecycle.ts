import { clamp } from '../core/math';
import type { AnimalGenome } from '../genetics/types';

/**
 * Defined developmental lifecycle stages for free-living fauna.
 * Egg-laying species begin as an `EggEntity` and hatch directly into `'larva'` or `'instar'`.
 * Live-bearing & binary-fission species begin as `'spawn'` (Live Spawn), grow into `'larva'` or `'instar'`,
 * and metamorphose / molt into `'adult'`.
 */
export type AnimalLifeStage = 'spawn' | 'larva' | 'instar' | 'adult';

/** Maturity thresholds governing transitions across developmental stages. */
export const LIFECYCLE_THRESHOLDS = {
  /** Below this maturity, live-born / budded neonates are in the Live Spawn stage. */
  intermediateStart: 0.3,
  /** Instar II molt threshold for arthropod / carapaced lifeforms. */
  instar2Start: 0.45,
  /** Instar III molt threshold for arthropod / carapaced lifeforms. */
  instar3Start: 0.61,
  /** At or above this maturity, larvae metamorphose / instars complete final molt to Adult. */
  adultStart: 0.76,
} as const;

export interface StageBehaviorModifiers {
  readonly speedMult: number;
  readonly attackMult: number;
  readonly visionMult: number;
  readonly currentDragMult: number;
  readonly swimFreqMult: number;
  readonly schoolingMult: number;
  readonly metabolicMult: number;
  readonly canHunt: boolean;
  readonly maxPreyScaleRatio: number;
  readonly threatScaleRatio: number;
  readonly canTerritorial: boolean;
  readonly canBreed: boolean;
}

/**
 * Arthropod / exoskeleton lineages (armored trilopods and chitin-carapaced species)
 * undergo stepped ecdysis molts through Instar stages; soft-bodied & chordate-like
 * lineages develop through a pelagic Larva stage.
 */
export function usesInstarStage(genome: AnimalGenome): boolean {
  return genome.bodyPlan === 'armored_trilopod' || genome.integument === 'chitin_carapace';
}

export function getIntermediateStage(genome: AnimalGenome): 'instar' | 'larva' {
  return usesInstarStage(genome) ? 'instar' : 'larva';
}

export function getLifeStageFromMaturity(genome: AnimalGenome, maturity: number): AnimalLifeStage {
  if (maturity >= LIFECYCLE_THRESHOLDS.adultStart) return 'adult';
  if (maturity >= LIFECYCLE_THRESHOLDS.intermediateStart) return getIntermediateStage(genome);
  return 'spawn';
}

export function getInstarRank(maturity: number): 1 | 2 | 3 {
  if (maturity >= LIFECYCLE_THRESHOLDS.instar3Start) return 3;
  if (maturity >= LIFECYCLE_THRESHOLDS.instar2Start) return 2;
  return 1;
}

export function getInitialMaturityForStage(stage: AnimalLifeStage): number {
  if (stage === 'spawn') return 0.06;
  if (stage === 'larva' || stage === 'instar') return LIFECYCLE_THRESHOLDS.intermediateStart + 0.02;
  return 0.88;
}

export function getStageDisplayLabel(
  genome: AnimalGenome,
  lifeStage: AnimalLifeStage,
  maturity: number
): string {
  if (lifeStage === 'spawn') return 'Live Spawn';
  if (lifeStage === 'adult') return 'Adult';
  if (lifeStage === 'instar' || usesInstarStage(genome)) {
    const rank = getInstarRank(maturity);
    return rank === 1 ? 'Instar I' : rank === 2 ? 'Instar II' : 'Instar III';
  }
  return 'Larva';
}

export function getLifecyclePathSummary(genome: AnimalGenome): string {
  const birth = genome.reproduction === 'Egg_Layer' ? 'Egg' : 'Live Spawn';
  const mid = usesInstarStage(genome) ? 'Instar' : 'Larva';
  return `${birth} → ${mid} → Adult`;
}

/**
 * Computes physical body scale as a function of developmental stage & maturity.
 * - Live Spawn: tiny delicate neonate (0.28 -> 0.41x adult sizeScale)
 * - Larva: smooth pelagic growth (0.47 -> 0.76x)
 * - Instar: stepped ecdysis molt plateaus (I: 0.46..0.51, II: 0.57..0.62, III: 0.68..0.75x)
 * - Adult: full mature growth surge (0.85 -> 1.04x)
 */
export function computeStageScale(
  genome: AnimalGenome,
  lifeStage: AnimalLifeStage,
  maturity: number
): number {
  const m = clamp(maturity, 0.0, 1.0);
  let mult: number;

  if (lifeStage === 'spawn') {
    const t = clamp(m / LIFECYCLE_THRESHOLDS.intermediateStart, 0, 1);
    mult = 0.28 + t * 0.13;
  } else if (lifeStage === 'instar') {
    if (m < LIFECYCLE_THRESHOLDS.instar2Start) {
      const t = clamp(
        (m - LIFECYCLE_THRESHOLDS.intermediateStart) /
          (LIFECYCLE_THRESHOLDS.instar2Start - LIFECYCLE_THRESHOLDS.intermediateStart),
        0,
        1
      );
      mult = 0.46 + t * 0.05;
    } else if (m < LIFECYCLE_THRESHOLDS.instar3Start) {
      const t = clamp(
        (m - LIFECYCLE_THRESHOLDS.instar2Start) /
          (LIFECYCLE_THRESHOLDS.instar3Start - LIFECYCLE_THRESHOLDS.instar2Start),
        0,
        1
      );
      mult = 0.57 + t * 0.05;
    } else {
      const t = clamp(
        (m - LIFECYCLE_THRESHOLDS.instar3Start) /
          (LIFECYCLE_THRESHOLDS.adultStart - LIFECYCLE_THRESHOLDS.instar3Start),
        0,
        1
      );
      mult = 0.68 + t * 0.07;
    }
  } else if (lifeStage === 'larva') {
    const t = clamp(
      (m - LIFECYCLE_THRESHOLDS.intermediateStart) /
        (LIFECYCLE_THRESHOLDS.adultStart - LIFECYCLE_THRESHOLDS.intermediateStart),
      0,
      1
    );
    mult = 0.47 + t * 0.29;
  } else {
    const t = clamp(
      (m - LIFECYCLE_THRESHOLDS.adultStart) / (1.0 - LIFECYCLE_THRESHOLDS.adultStart),
      0,
      1
    );
    mult = 0.85 + t * 0.19;
  }

  return Math.max(0.08, genome.sizeScale * mult);
}

/**
 * Scales max health with developmental stage so neonates & larvae are fragile while
 * adults command full physiological durability.
 */
export function computeStageMaxHp(
  genome: AnimalGenome,
  lifeStage: AnimalLifeStage,
  maturity: number
): number {
  const m = clamp(maturity, 0, 1);
  let hpMult: number;
  if (lifeStage === 'spawn') {
    const t = clamp(m / LIFECYCLE_THRESHOLDS.intermediateStart, 0, 1);
    hpMult = 0.34 + t * 0.12;
  } else if (lifeStage === 'larva' || lifeStage === 'instar') {
    const t = clamp(
      (m - LIFECYCLE_THRESHOLDS.intermediateStart) /
        (LIFECYCLE_THRESHOLDS.adultStart - LIFECYCLE_THRESHOLDS.intermediateStart),
      0,
      1
    );
    hpMult = (lifeStage === 'instar' ? 0.56 : 0.52) + t * 0.28;
  } else {
    const t = clamp(
      (m - LIFECYCLE_THRESHOLDS.adultStart) / (1.0 - LIFECYCLE_THRESHOLDS.adultStart),
      0,
      1
    );
    hpMult = 0.9 + t * 0.1;
  }
  return Math.max(16, Math.round(genome.maxHp * hpMult));
}

/**
 * Returns stage-calibrated behavioral, kinematic, and ecological capability modifiers.
 */
export function getStageBehaviorModifiers(
  lifeStage: AnimalLifeStage,
  maturity: number
): StageBehaviorModifiers {
  const m = clamp(maturity, 0, 1);

  if (lifeStage === 'spawn') {
    const t = clamp(m / LIFECYCLE_THRESHOLDS.intermediateStart, 0, 1);
    return {
      speedMult: 0.68 + t * 0.1,
      attackMult: 0.25,
      visionMult: 0.64,
      currentDragMult: 1.65,
      swimFreqMult: 1.42,
      schoolingMult: 1.65,
      metabolicMult: 0.62,
      canHunt: false,
      maxPreyScaleRatio: 0,
      threatScaleRatio: 1.32,
      canTerritorial: false,
      canBreed: false,
    };
  }

  if (lifeStage === 'larva') {
    const t = clamp(
      (m - LIFECYCLE_THRESHOLDS.intermediateStart) /
        (LIFECYCLE_THRESHOLDS.adultStart - LIFECYCLE_THRESHOLDS.intermediateStart),
      0,
      1
    );
    return {
      speedMult: 0.85 + t * 0.11,
      attackMult: 0.48 + t * 0.22,
      visionMult: 0.84 + t * 0.08,
      currentDragMult: 1.24,
      swimFreqMult: 1.18,
      schoolingMult: 1.48,
      metabolicMult: 0.8,
      canHunt: true,
      maxPreyScaleRatio: 0.88,
      threatScaleRatio: 1.42,
      canTerritorial: false,
      canBreed: false,
    };
  }

  if (lifeStage === 'instar') {
    const t = clamp(
      (m - LIFECYCLE_THRESHOLDS.intermediateStart) /
        (LIFECYCLE_THRESHOLDS.adultStart - LIFECYCLE_THRESHOLDS.intermediateStart),
      0,
      1
    );
    return {
      speedMult: 0.82 + t * 0.12,
      attackMult: 0.52 + t * 0.22,
      visionMult: 0.82 + t * 0.08,
      currentDragMult: 0.92,
      swimFreqMult: 1.24,
      schoolingMult: 1.22,
      metabolicMult: 0.78,
      canHunt: true,
      maxPreyScaleRatio: 0.86,
      threatScaleRatio: 1.38,
      canTerritorial: false,
      canBreed: false,
    };
  }

  return {
    speedMult: 1.0,
    attackMult: 1.0,
    visionMult: 1.0,
    currentDragMult: 1.0,
    swimFreqMult: 1.0,
    schoolingMult: 1.0,
    metabolicMult: 1.0,
    canHunt: true,
    maxPreyScaleRatio: 1.32,
    threatScaleRatio: 0.72,
    canTerritorial: true,
    canBreed: true,
  };
}
