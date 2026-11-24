import * as THREE from 'three';
import { TANK } from './config';

export function clamp(v: number, min: number, max: number): number {
  if (!Number.isFinite(v)) return min;
  return v < min ? min : v > max ? max : v;
}

export function safeRatio(num: number, den: number): number {
  if (!Number.isFinite(num) || !Number.isFinite(den) || Math.abs(den) < 1e-6) return 0;
  return clamp(num / den, 0, 1);
}

export function randRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

export function randInt(min: number, maxInclusive: number): number {
  return Math.floor(min + Math.random() * (maxInclusive - min + 1));
}

export function randChoice<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * Far safety ceiling clamping a 3D position's horizontal (x, z) coordinates inside
 * the distant open-water bound (`TANK.maxRadius - margin`) to prevent runaway drift.
 */
export function clampToTankRadius(pos: THREE.Vector3, margin = 0.6): void {
  if (!Number.isFinite(pos.x)) pos.x = 0;
  if (!Number.isFinite(pos.z)) pos.z = 0;
  const maxR = Math.max(0.5, TANK.maxRadius - margin);
  const rSq = pos.x * pos.x + pos.z * pos.z;
  if (rSq > maxR * maxR) {
    const inv = maxR / Math.sqrt(rSq);
    pos.x *= inv;
    pos.z *= inv;
  }
}

/**
 * Far safety clamp for an (x, z) pair inside the distant open-water bound.
 */
export function clampXZToTankRadius(x: number, z: number, margin = 0.6): [number, number] {
  const sx = Number.isFinite(x) ? x : 0;
  const sz = Number.isFinite(z) ? z : 0;
  const maxR = Math.max(0.5, TANK.maxRadius - margin);
  const rSq = sx * sx + sz * sz;
  if (rSq > maxR * maxR) {
    const inv = maxR / Math.sqrt(rSq);
    return [sx * inv, sz * inv];
  }
  return [sx, sz];
}

/**
 * Area-uniform random horizontal point inside the cylindrical aquarium disk.
 */
export function randomPointInTankDisk(margin = 1.0): { x: number; z: number } {
  const maxR = Math.max(0.5, TANK.radius - margin);
  const r = Math.sqrt(Math.random()) * maxR;
  const theta = Math.random() * Math.PI * 2;
  return { x: Math.cos(theta) * r, z: Math.sin(theta) * r };
}

/**
 * Smooth ecological weighting (0 inside `coreRadius`, ramping smoothly past `radius`
 * toward `maxRadius`) used to softly bias creatures and drifting life back toward the reef
 * without any visible wall or abrupt bounce.
 */
export function computeHorizontalBoundWeight(x: number, z: number): number {
  const r = Math.hypot(x, z);
  if (r <= TANK.coreRadius) return 0;
  const span = Math.max(1.0, TANK.radius - TANK.coreRadius);
  const t = (r - TANK.coreRadius) / span;
  // Smooth quadratic ramp inside [coreRadius..radius], accelerating smoothly beyond radius
  return t <= 1.0 ? t * t : 1.0 + (t - 1.0) * (1.8 + (t - 1.0) * 1.4);
}

/**
 * Organic placement/habitat suitability weight for flora (1.0 inside the lush reef oasis,
 * tapering smoothly down toward 0 past the invisible horizontal reef boundary).
 */
export function computePlantPlacementWeight(x: number, z: number): number {
  const r = Math.hypot(x, z);
  if (r <= TANK.coreRadius * 0.85) return 1.0;
  const excess = r - TANK.coreRadius * 0.85;
  const sigma = Math.max(2.5, (TANK.radius - TANK.coreRadius * 0.85) * 0.72);
  return Math.exp(-(excess * excess) / (2.0 * sigma * sigma));
}

/**
 * Samples an organic center-weighted reef position: lush density across the focal reef core,
 * tapering smoothly outward with strong weighting against straying beyond the soft horizon.
 */
export function randomWeightedPointInReef(
  coreR = TANK.coreRadius,
  outerR = TANK.radius
): { x: number; z: number } {
  // Blend two uniform samples for natural bell-like radial tapering without center clumping
  const u = Math.sqrt(Math.random());
  const v = Math.random();
  const r = Math.min(outerR, u * coreR * (0.68 + 0.52 * v));
  const theta = Math.random() * Math.PI * 2;
  return { x: Math.cos(theta) * r, z: Math.sin(theta) * r };
}

export function isFiniteVec3(v: THREE.Vector3 | null | undefined): boolean {
  return !!(v && Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z));
}

export function safeNormalize(v: THREE.Vector3): boolean {
  if (!isFiniteVec3(v)) {
    v.set(0, 0, 1);
    return false;
  }
  const lenSq = v.lengthSq();
  if (lenSq < 1e-8) return false;
  v.divideScalar(Math.sqrt(lenSq));
  return true;
}

const _oMat = new THREE.Matrix4();
const _oRight = new THREE.Vector3();
const _oUp = new THREE.Vector3();
const _oFwd = new THREE.Vector3();
const _oQuat = new THREE.Quaternion();
const _wUp = new THREE.Vector3(0, 1, 0);
const _altUp = new THREE.Vector3(0, 0, 1);

/**
 * Singularity-safe smooth orientation aligning local +Z with `dir`.
 * Also supports optional bank angle around forward axis during sharp turns.
 */
export function safeOrientToward(
  quat: THREE.Quaternion,
  dir: THREE.Vector3,
  alpha: number,
  bankAngle = 0
): void {
  if (!quat || !isFiniteVec3(dir)) return;
  _oFwd.copy(dir);
  if (!safeNormalize(_oFwd)) return;

  const upRef = Math.abs(_oFwd.dot(_wUp)) > 0.96 ? _altUp : _wUp;
  _oRight.crossVectors(upRef, _oFwd);
  if (!safeNormalize(_oRight)) return;
  _oUp.crossVectors(_oFwd, _oRight);
  safeNormalize(_oUp);

  if (Math.abs(bankAngle) > 1e-4) {
    const c = Math.cos(bankAngle);
    const s = Math.sin(bankAngle);
    const rx = _oRight.x * c + _oUp.x * s;
    const ry = _oRight.y * c + _oUp.y * s;
    const rz = _oRight.z * c + _oUp.z * s;
    const ux = _oUp.x * c - _oRight.x * s;
    const uy = _oUp.y * c - _oRight.y * s;
    const uz = _oUp.z * c - _oRight.z * s;
    _oRight.set(rx, ry, rz);
    _oUp.set(ux, uy, uz);
  }

  _oMat.makeBasis(_oRight, _oUp, _oFwd);
  _oQuat.setFromRotationMatrix(_oMat);
  if (Number.isFinite(_oQuat.x) && Number.isFinite(_oQuat.w)) {
    quat.slerp(_oQuat, clamp(alpha, 0, 1));
  }
}

/**
 * Deterministic sculpted sandy seabed heightfield with hydrothermal mound,
 * rolling submarine sand ripples, and natural open-ocean reef undulations.
 */
export function getSeabedHeight(x: number, z: number): number {
  if (!Number.isFinite(x) || !Number.isFinite(z)) return 0.65;
  const dx = x - TANK.ventPos.x;
  const dz = z - TANK.ventPos.z;
  const ventDistSq = dx * dx + dz * dz;
  const ventMound = 1.32 * Math.exp(-ventDistSq / 10.8);

  const dunes =
    0.36 * Math.sin(x * 0.27 + 0.5) * Math.cos(z * 0.33 - 0.2) +
    0.19 * Math.sin(x * 0.54 - z * 0.42) +
    0.09 * Math.cos((x + z) * 0.72) +
    0.045 * Math.sin(x * 1.45 + z * 0.65);

  // Gentle open-ocean submarine sandbank swells continuing seamlessly into the blurred distance
  const distantSwell =
    0.52 * Math.sin(x * 0.085 + 0.8) * Math.cos(z * 0.092 - 0.5) +
    0.26 * Math.cos((x - z) * 0.055);

  return 0.72 + dunes + distantSwell + ventMound;
}

/**
 * Smooth divergence-like 3D underwater current field + buoyant thermal updraft
 * right above the hydrothermal genesis vent.
 */
export function sampleWaterCurrent(
  x: number,
  y: number,
  z: number,
  time: number,
  strength: number,
  out: THREE.Vector3
): THREE.Vector3 {
  if (strength <= 1e-4) {
    return out.set(0, 0, 0);
  }
  const t = time * 0.28;
  // Smooth reef-centered oceanic gyre (attenuates softly at large radii) + gentle swell
  const rSqHoriz = x * x + z * z;
  const gyreDamp = 1.0 / (1.0 + rSqHoriz / 324.0);
  const gyreX = -z * 0.045 * gyreDamp + Math.sin(y * 0.35 + t) * 0.32;
  const gyreZ = x * 0.045 * gyreDamp + Math.cos(x * 0.25 - t * 0.85) * 0.28;
  const gyreY = Math.sin(x * 0.28 + z * 0.24 + t * 0.7) * 0.08;

  // Hydrothermal vent thermal updraft
  const dx = x - TANK.ventPos.x;
  const dz = z - TANK.ventPos.z;
  const rSq = dx * dx + dz * dz;
  const plumeUp = Math.exp(-rSq / 4.2) * clamp((TANK.waterY - y) / TANK.waterY, 0.1, 1.0) * 1.15;

  return out.set(gyreX * strength, (gyreY + plumeUp) * strength, gyreZ * strength);
}

/**
 * Computes solar daylight factor (0 = abyssal midnight, 1 = high noon)
 * from normalized timeOfDay (0..1, 0.5 = noon).
 */
export function computeDaylightFactor(timeOfDay: number): number {
  const angle = (timeOfDay - 0.25) * Math.PI * 2;
  const raw = Math.sin(angle); // -1 at midnight, +1 at noon
  return clamp((raw + 0.25) / 1.25, 0, 1);
}

export function disableFrustumCulling(root: THREE.Object3D): void {
  root.frustumCulled = false;
  root.traverse((c) => {
    c.frustumCulled = false;
  });
}
