import * as THREE from 'three';
import { TANK } from '../core/config';
import {
  clampXZToTankRadius,
  getSeabedHeight,
  randRange,
  randomPointInTankDisk,
  randomWeightedPointInReef,
  sampleWaterCurrent,
} from '../core/math';
import {
  createGodRayMaterial,
  createVentBasaltMaterial,
  createVentCoreMaterial,
  createVentPlumeMaterial,
  createWaterSurfaceMaterial,
  enhanceMaterialWithUnderwaterCaustics,
  type SharedShaderUniforms,
} from './Shaders';
import { getProceduralTextures, hasCanvasSupport } from './TextureLibrary';

export interface EnvironmentRig {
  ventLight: THREE.PointLight;
  ventCore: THREE.Mesh;
  ventPlumeMat: THREE.ShaderMaterial;
  sunLight: THREE.DirectionalLight;
  hemiLight: THREE.HemisphereLight;
  fillLight: THREE.DirectionalLight;
  waterPlaneY: number;
  update(realDt: number, currentStrength: number, ventPulseEnergy: number, daylight: number, timeOfDay: number): void;
}

/**
 * Sculpted terraced basalt apron mound seamlessly anchoring the Genesis Vent into the seabed.
 * Encodes per-vertex `aVentMeta` = (heightNorm, innerThroatMask, rimLedgeMask).
 */
function buildVentMoundGeometry(): THREE.BufferGeometry {
  const stations = 18;
  const pts: THREE.Vector2[] = [];
  const profileMeta: Array<[number, number, number]> = [];
  for (let i = 0; i <= stations; i++) {
    const t = i / stations; // 0 = outer seabed skirt -> 1 = chimney base collar
    const eased = Math.pow(THREE.MathUtils.clamp(1.0 - t, 0, 1), 1.35);
    const r = 0.85 + eased * 1.85;
    const y = -0.18 + Math.sin(t * Math.PI * 0.5) * 0.72 + Math.sin(t * Math.PI * 4.0) * 0.035;
    pts.push(new THREE.Vector2(r, y));
    const terraceMask = Math.max(0, Math.cos(t * Math.PI * 4.0)) * 0.45;
    profileMeta.push([t * 0.24, 0.0, terraceMask]);
  }
  const geo = new THREE.LatheGeometry(pts, 48);
  const pos = geo.attributes.position;
  const ventMeta = new Float32Array(pos.count * 3);
  const stride = pts.length;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    let y = pos.getY(i);
    const z = pos.getZ(i);
    const r = Math.hypot(x, z);
    const ang = Math.atan2(z, x);
    const outer = THREE.MathUtils.clamp((r - 0.85) / 1.85, 0, 1);
    // Organic radial volcanic lava ridges & mineral step terraces
    const buttress =
      1.0 +
      Math.sin(ang * 5.0 + 0.4) * 0.14 * outer +
      Math.cos(ang * 9.0 - r * 1.6) * 0.07 * outer +
      Math.sin(ang * 15.0 + y * 5.0) * 0.03;
    y += Math.sin(ang * 7.0 + r * 3.1) * 0.055 * (1.0 - outer * 0.5);
    pos.setXYZ(i, x * buttress, y, z * buttress);

    const m = profileMeta[i % stride];
    ventMeta[i * 3] = m[0];
    ventMeta[i * 3 + 1] = m[1];
    ventMeta[i * 3 + 2] = m[2];
  }
  geo.setAttribute('aVentMeta', new THREE.BufferAttribute(ventMeta, 3));
  geo.computeVertexNormals();
  return geo;
}

/**
 * High-resolution double-walled volcanic hydrothermal smoker chimney with pagoda mineral
 * flange ledges, fluted basalt ribs, jagged rocky crown rim, and recessed inner throat cavity.
 * Encodes per-vertex `aVentMeta` = (heightNorm, innerThroatMask, rimLedgeMask) so both the
 * main chimney and side spires get accurate calcite rims and deep glowing throats.
 */
function buildVentChimneyGeometry(
  height: number,
  baseRadius: number,
  topRadius: number,
  seed: number
): THREE.BufferGeometry {
  const outerSteps = 22;
  const lipSteps = 5;
  const innerSteps = 10;
  const pts: THREE.Vector2[] = [];
  const profileMeta: Array<[number, number, number]> = [];

  // 1. Outer fluted volcanic wall rising from base -> jagged mineral crown
  for (let i = 0; i <= outerSteps; i++) {
    const t = i / outerSteps;
    const y = -0.12 + t * (height + 0.12);
    const baseTaper = THREE.MathUtils.lerp(baseRadius, topRadius, Math.pow(t, 0.72));
    // Hydrothermal beehive/pagoda mineral precipitation flanges jutting horizontally
    const f1 = Math.exp(-Math.pow((t - 0.34) * 11.0, 2));
    const f2 = Math.exp(-Math.pow((t - 0.64) * 12.0, 2));
    const f3 = Math.exp(-Math.pow((t - 0.88) * 13.0, 2));
    const r = Math.max(0.06, baseTaper + f1 * topRadius * 0.34 + f2 * topRadius * 0.28 + f3 * topRadius * 0.18);
    pts.push(new THREE.Vector2(r, y));
    profileMeta.push([t, 0.0, Math.min(1.0, f1 + f2 + f3)]);
  }

  // 2. Thick craggy crater lip rolling inward
  const innerTopR = Math.max(0.05, topRadius * 0.68);
  for (let i = 1; i <= lipSteps; i++) {
    const u = i / lipSteps;
    const ang = u * Math.PI;
    const r = THREE.MathUtils.lerp(topRadius, innerTopR, u);
    const y = height + Math.sin(ang) * topRadius * 0.12;
    pts.push(new THREE.Vector2(r, y));
    profileMeta.push([1.0, u * 0.45, 1.0 - u * 0.35]);
  }

  // 3. Recessed inner throat cavity descending deep into the glowing core
  for (let i = 1; i <= innerSteps; i++) {
    const u = i / innerSteps;
    const y = height - u * (height * 0.56);
    const r = Math.max(0.04, innerTopR * (1.0 - u * 0.28));
    pts.push(new THREE.Vector2(r, y));
    profileMeta.push([1.0 - u * 0.25, 0.45 + u * 0.55, 0.0]);
  }

  const geo = new THREE.LatheGeometry(pts, 48);
  const pos = geo.attributes.position;
  const ventMeta = new Float32Array(pos.count * 3);
  const stride = pts.length;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    let y = pos.getY(i);
    const z = pos.getZ(i);
    const ang = Math.atan2(z, x);
    const hNorm = THREE.MathUtils.clamp(y / Math.max(0.1, height), 0, 1);

    // Fluted vertical volcanic ribs + craggy basalt rock distortion
    const rib =
      1.0 +
      Math.sin(ang * 7.0 + seed + hNorm * 2.2) * 0.085 +
      Math.cos(ang * 13.0 - seed * 1.4 + hNorm * 6.5) * 0.042 +
      Math.sin(ang * 19.0 + y * 5.2) * 0.018;

    // Asymmetric rocky crown serrations near the top lip (replaces smooth mechanical torus!)
    const crownMask = THREE.MathUtils.smoothstep(hNorm, 0.72, 1.0);
    const crownJagged =
      (Math.sin(ang * 4.0 + seed) * 0.085 +
        Math.cos(ang * 9.0 - seed * 0.8) * 0.052 +
        Math.sin(ang * 15.0 + seed * 1.7) * 0.025) *
      height *
      crownMask;

    // Slight natural geological lean/curve up the chimney stack
    const leanX = Math.sin(hNorm * Math.PI * 0.75 + seed) * topRadius * 0.10 * hNorm;
    const leanZ = Math.cos(hNorm * Math.PI * 0.65 - seed) * topRadius * 0.08 * hNorm;

    y += crownJagged;
    pos.setXYZ(i, x * rib + leanX, y, z * rib + leanZ);

    const m = profileMeta[i % stride];
    ventMeta[i * 3] = m[0];
    ventMeta[i * 3 + 1] = m[1];
    ventMeta[i * 3 + 2] = m[2];
  }
  geo.setAttribute('aVentMeta', new THREE.BufferAttribute(ventMeta, 3));
  geo.computeVertexNormals();
  return geo;
}

/**
 * Organic flaring open-ended tube for volumetric hydrothermal plumes (uv.y = 0 at orifice -> 1 at top).
 */
function buildVentPlumeGeometry(bottomR: number, topR: number, height: number): THREE.BufferGeometry {
  const geo = new THREE.CylinderGeometry(topR, bottomR, height, 28, 20, true);
  geo.translate(0, height * 0.5, 0);
  return geo;
}

/**
 * Curved abyssal parchment tube for chemosynthetic hydrothermal vent tubeworm colonies.
 */
function buildVentTubewormStalk(): THREE.BufferGeometry {
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0.03, 0.16, 0.015),
    new THREE.Vector3(0.075, 0.34, -0.01),
    new THREE.Vector3(0.055, 0.52, 0.02),
  ]);
  const geo = new THREE.TubeGeometry(curve, 14, 0.022, 8, false);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    const t = THREE.MathUtils.clamp(y / 0.52, 0, 1);
    const ring = 1.0 + Math.sin(t * Math.PI * 12.0) * 0.08;
    const center = curve.getPointAt(t);
    const dx = pos.getX(i) - center.x;
    const dz = pos.getZ(i) - center.z;
    const taper = 0.68 + 0.45 * t;
    pos.setXYZ(i, center.x + dx * taper * ring, y, center.z + dz * taper * ring);
  }
  geo.computeVertexNormals();
  return geo;
}

/**
 * Faceted mineral crystal prism (hexagonal shaft + pyramidal apex) for hydrothermal veins.
 */
function buildMineralCrystalGeometry(): THREE.BufferGeometry {
  const pts = [
    new THREE.Vector2(0.095, 0.0),
    new THREE.Vector2(0.09, 0.54),
    new THREE.Vector2(0.004, 0.78),
  ];
  const geo = new THREE.LatheGeometry(pts, 6);
  geo.computeVertexNormals();
  return geo;
}

/**
 * High-resolution organically stratified, water-eroded volcanic reef boulder with
 * layered sedimentary ledges, weathered crevices, and baked crevice/algal vertex AO.
 */
function buildSculptedReefRockGeometry(seed: number): THREE.BufferGeometry {
  const geo = new THREE.SphereGeometry(1.0, 28, 20);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const ang = Math.atan2(z, x);
    const horiz = Math.hypot(x, z);

    // Multi-octave geological strata, fracture planes & water-worn erosion pockets
    const strata = Math.sin(y * 7.5 + Math.sin(ang * 2.0 + seed) * 1.4) * 0.085;
    const blockA = Math.sin(x * 2.6 + seed * 1.7) * Math.cos(z * 2.4 - seed * 1.1) * 0.16;
    const blockB = Math.sin((x + z) * 4.3 - y * 3.2 + seed) * 0.075;
    const micro = Math.cos(ang * 7.0 + y * 9.0 + seed * 2.1) * 0.032;
    const topFlatten = y > 0.35 ? -(y - 0.35) * 0.24 : 0;
    const baseFlare = y < -0.1 ? Math.abs(y + 0.1) * 0.22 : 0;

    const disp = Math.max(0.55, 1.0 + strata + blockA + blockB + micro + baseFlare);
    const nx = x * disp;
    const ny = y * (0.94 + blockA * 0.45) + topFlatten;
    const nz = z * disp;
    pos.setXYZ(i, nx, ny, nz);

    // Vertex-colored geological shading: dark wet basalt crevices -> subtle algae/mineral top patina
    const crevice = THREE.MathUtils.clamp((disp - 0.78) / 0.44, 0, 1);
    const up = THREE.MathUtils.clamp(y * 0.65 + 0.5, 0, 1);
    const ao = 0.56 + crevice * 0.38;
    const rCol = ao * THREE.MathUtils.lerp(0.72, 0.96, up);
    const gCol = ao * THREE.MathUtils.lerp(0.84, 1.08, up);
    const bCol = ao * THREE.MathUtils.lerp(0.92, 1.02, up * (1.0 - horiz * 0.12));
    colors[i * 3] = rCol;
    colors[i * 3 + 1] = gCol;
    colors[i * 3 + 2] = bCol;
  }

  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  return geo;
}

/**
 * Smooth water-worn seabed pebble / calcified coral rubble stone for instanced scatter.
 */
function buildSeabedPebbleGeometry(): THREE.BufferGeometry {
  const geo = new THREE.SphereGeometry(0.16, 12, 9);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const d = 1.0 + Math.sin(x * 16.0 + z * 11.0) * 0.14 + Math.cos(y * 14.0 - x * 9.0) * 0.1;
    pos.setXYZ(i, x * d * 1.25, y * d * 0.58, z * d * 0.96);
  }
  geo.computeVertexNormals();
  return geo;
}

/**
 * Feathery scalloped hydrothermal tubeworm branchial gill plume crown (replaces plain cone!).
 */
function buildTubewormPlumeGeometry(): THREE.BufferGeometry {
  const pts = [
    new THREE.Vector2(0.012, 0.0),
    new THREE.Vector2(0.028, 0.03),
    new THREE.Vector2(0.056, 0.085),
    new THREE.Vector2(0.072, 0.135),
    new THREE.Vector2(0.052, 0.155),
    new THREE.Vector2(0.022, 0.115),
    new THREE.Vector2(0.006, 0.06),
  ];
  const geo = new THREE.LatheGeometry(pts, 36);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    let y = pos.getY(i);
    const z = pos.getZ(i);
    const ang = Math.atan2(z, x);
    const h = THREE.MathUtils.clamp(y / 0.155, 0, 1);
    const feather = 1.0 + Math.sin(ang * 18.0) * 0.22 * h;
    y += Math.sin(ang * 18.0) * 0.018 * h * h;
    pos.setXYZ(i, x * feather, y, z * feather);
  }
  geo.computeVertexNormals();
  return geo;
}

/**
 * High-resolution concentric polar circular disk geometry with planar world-scale UVs
 * and upward (+Y) normals. Uses a configurable radial power curve (`radialPower > 1`)
 * to concentrate vertex resolution in the foreground/midground reef while stretching
 * seamlessly out to the open-ocean horizon well past underwater optical extinction.
 */
function buildCircularDiskGeometry(
  radius: number,
  radialRings: number,
  angularSegs: number,
  heightFn?: (x: number, z: number) => number,
  uvScale = 0.22,
  radialPower = 1.55
): THREE.BufferGeometry {
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  // Center vertex (index 0)
  const cy = heightFn ? heightFn(0, 0) : 0;
  positions.push(0, cy, 0);
  uvs.push(0.5, 0.5);

  for (let rIdx = 1; rIdx <= radialRings; rIdx++) {
    const r = Math.pow(rIdx / radialRings, radialPower) * radius;
    for (let s = 0; s <= angularSegs; s++) {
      const theta = (s / angularSegs) * Math.PI * 2;
      const x = Math.cos(theta) * r;
      const z = Math.sin(theta) * r;
      const y = heightFn ? heightFn(x, z) : 0;
      positions.push(x, y, z);
      uvs.push(0.5 + x * uvScale, 0.5 + z * uvScale);
    }
  }

  const stride = angularSegs + 1;
  // Inner cap fan (upward +Y winding)
  for (let s = 0; s < angularSegs; s++) {
    indices.push(0, 1 + s + 1, 1 + s);
  }
  // Concentric quad rings (upward +Y winding)
  for (let rIdx = 1; rIdx < radialRings; rIdx++) {
    const rowA = 1 + (rIdx - 1) * stride;
    const rowB = 1 + rIdx * stride;
    for (let s = 0; s < angularSegs; s++) {
      const p00 = rowA + s;
      const p01 = rowA + s + 1;
      const p10 = rowB + s;
      const p11 = rowB + s + 1;
      indices.push(p00, p01, p11);
      indices.push(p00, p11, p10);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/**
 * Seamless open-ocean underwater horizon dome surrounding the unbounded reef world.
 * Matches the underwater fog color exactly at the horizon so distant sandbanks and
 * the distant water surface dissolve invisibly into endless oceanic depth.
 */
function buildUnderwaterHorizonDome(sharedUniforms: SharedShaderUniforms): THREE.Mesh {
  const geo = new THREE.SphereGeometry(122, 32, 20);
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uFogColor: sharedUniforms.uFogColor,
      uDaylight: sharedUniforms.uDaylight,
      uSunDir: sharedUniforms.uSunDir,
    },
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uFogColor;
      uniform float uDaylight;
      uniform vec3 uSunDir;
      varying vec3 vDir;

      void main() {
        float y = vDir.y;
        // Exact fog color at the eye-level horizon so distant seabed & surface vanish seamlessly
        vec3 upperWater = uFogColor * vec3(1.15, 1.55, 1.68) + vec3(0.02, 0.14, 0.22) * uDaylight;
        vec3 abyssBelow = uFogColor * vec3(0.45, 0.55, 0.68);
        vec3 col = y >= 0.0
          ? mix(uFogColor, upperWater, smoothstep(0.0, 0.55, y))
          : mix(uFogColor, abyssBelow, smoothstep(0.0, 0.45, -y));
        // Subtle diffused solar bloom in the upper pelagic distance
        float sunScatter = pow(max(dot(normalize(vDir), normalize(uSunDir)), 0.0), 5.0);
        col += vec3(0.10, 0.34, 0.42) * sunScatter * uDaylight * smoothstep(-0.08, 0.42, y);
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
  const dome = new THREE.Mesh(geo, mat);
  dome.frustumCulled = false;
  return dome;
}

export function buildAquariumEnvironment(
  scene: THREE.Scene,
  sharedUniforms: SharedShaderUniforms
): EnvironmentRig {
  const tex = hasCanvasSupport() ? getProceduralTextures() : null;

  // 1. Dynamic Underwater Lighting (with Real-Time Soft PCF Shadows)
  const hemiLight = new THREE.HemisphereLight(0x7ae2ff, 0x072336, 1.18);
  scene.add(hemiLight);

  const sunLight = new THREE.DirectionalLight(0xc4f5ff, 1.65);
  sunLight.position.set(10, 28, 10);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.set(2048, 2048);
  sunLight.shadow.camera.near = 2;
  sunLight.shadow.camera.far = 62;
  sunLight.shadow.camera.left = -20;
  sunLight.shadow.camera.right = 20;
  sunLight.shadow.camera.top = 20;
  sunLight.shadow.camera.bottom = -20;
  sunLight.shadow.bias = -0.0005;
  sunLight.shadow.normalBias = 0.035;
  scene.add(sunLight);

  const fillLight = new THREE.DirectionalLight(0x1f82a8, 0.65);
  fillLight.position.set(-14, 9, -12);
  scene.add(fillLight);

  const vx = TANK.ventPos.x;
  const vz = TANK.ventPos.z;
  const vy = getSeabedHeight(vx, vz);
  TANK.ventPos.y = vy;

  const ventLight = new THREE.PointLight(0x38e8ff, 0.0, 17, 1.35);
  ventLight.position.set(vx, vy + 2.45, vz);
  scene.add(ventLight);

  // Warm deep-throat geothermal glow (dormant until a genesis pulse approaches)
  const ventWarmLight = new THREE.PointLight(0xff8c38, 0.0, 7.5, 1.6);
  ventWarmLight.position.set(vx, vy + 1.75, vz);
  scene.add(ventWarmLight);

  // 1b. Seamless Open-Ocean Underwater Horizon Dome (infinite blue depth backdrop)
  scene.add(buildUnderwaterHorizonDome(sharedUniforms));

  // 2. Horizontally Unbounded Carbonate Sandy Seabed (high-res focal reef stretching smoothly to horizon)
  const sandGeo = buildCircularDiskGeometry(
    TANK.worldRadius,
    76,
    108,
    getSeabedHeight,
    0.22,
    1.68
  );
  const posAttr = sandGeo.attributes.position;
  const sandColors = new Float32Array(posAttr.count * 3);
  const cCrest = new THREE.Color(0x98a692);
  const cTrough = new THREE.Color(0x3a5864);
  const cSandTmp = new THREE.Color();
  for (let i = 0; i < posAttr.count; i++) {
    const sx = posAttr.getX(i);
    const sz = posAttr.getZ(i);
    const sy = posAttr.getY(i);
    const ripple = 0.5 + 0.5 * Math.sin(sx * 2.6 + Math.sin(sz * 1.8) * 1.4);
    const elev = THREE.MathUtils.clamp((sy - 0.15) / 1.35, 0, 1);
    cSandTmp.copy(cTrough).lerp(cCrest, THREE.MathUtils.clamp(elev * 0.68 + ripple * 0.32, 0, 1));
    sandColors[i * 3] = cSandTmp.r;
    sandColors[i * 3 + 1] = cSandTmp.g;
    sandColors[i * 3 + 2] = cSandTmp.b;
  }
  sandGeo.setAttribute('color', new THREE.BufferAttribute(sandColors, 3));
  sandGeo.computeVertexNormals();

  const sandMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    vertexColors: true,
    roughness: 0.84,
    metalness: 0.04,
    normalMap: tex?.sandNormal ?? null,
    normalScale: new THREE.Vector2(1.15, 1.15),
  });
  enhanceMaterialWithUnderwaterCaustics(sandMat, sharedUniforms, {
    causticStrength: 0.92,
    subsurfaceStrength: 0.08,
    ventBounceStrength: 0.95,
    isSeabed: true,
  });
  const sandMesh = new THREE.Mesh(sandGeo, sandMat);
  sandMesh.receiveShadow = true;
  scene.add(sandMesh);

  // 3. Sculpted Stratified Volcanic Reef Boulders + Instanced Pebbles + Mineral Crystals
  const rockMat = new THREE.MeshStandardMaterial({
    color: 0x3b5362,
    vertexColors: true,
    roughness: 0.72,
    metalness: 0.08,
    normalMap: tex?.rockNormal ?? null,
    normalScale: new THREE.Vector2(1.35, 1.35),
  });
  enhanceMaterialWithUnderwaterCaustics(rockMat, sharedUniforms, {
    causticStrength: 0.62,
    subsurfaceStrength: 0.10,
    ventBounceStrength: 0.52,
  });
  const rockGeos = [
    buildSculptedReefRockGeometry(1.3),
    buildSculptedReefRockGeometry(3.7),
    buildSculptedReefRockGeometry(6.9),
  ];
  const crystalGeo = buildMineralCrystalGeometry();
  const crystalMat = new THREE.MeshPhysicalMaterial({
    color: 0x4df2ff,
    emissive: 0x16b8e0,
    emissiveIntensity: 0.72,
    roughness: 0.14,
    metalness: 0.12,
    clearcoat: 0.95,
    clearcoatRoughness: 0.08,
    iridescence: 0.72,
    iridescenceIOR: 1.42,
    transparent: true,
    opacity: 0.84,
  });

  // Focal reef boulders + distant atmospheric silhouette outcrops fading into the underwater distance blur
  const rocks = [
    // Inner reef basin boulders
    { x: -8.6, z: -4.8, s: 1.85, crystals: true },
    { x: -6.9, z: -3.6, s: 1.2, crystals: false },
    { x: 8.2, z: -5.2, s: 1.95, crystals: true },
    { x: 10.1, z: -2.0, s: 1.35, crystals: false },
    { x: 7.8, z: 5.4, s: 1.5, crystals: false },
    { x: -8.4, z: 5.2, s: 1.55, crystals: true },
    { x: 1.8, z: -8.6, s: 1.75, crystals: false },
    { x: -1.5, z: 7.8, s: 1.2, crystals: false },
    { x: 4.9, z: -4.6, s: 1.05, crystals: false },
    { x: -2.4, z: -9.6, s: 1.45, crystals: true },
    // Distant outer reef ridges & silhouettes softly dissolving into distance blur
    { x: -17.5, z: -13.5, s: 3.4, crystals: false },
    { x: 16.8, z: -14.8, s: 3.8, crystals: false },
    { x: 2.5, z: -21.0, s: 4.2, crystals: false },
    { x: -21.5, z: 4.2, s: 3.2, crystals: false },
    { x: 21.8, z: 3.5, s: 3.5, crystals: false },
    { x: -12.5, z: 17.8, s: 3.1, crystals: false },
    { x: 13.8, z: 16.5, s: 3.3, crystals: false },
  ];
  for (let ri = 0; ri < rocks.length; ri++) {
    const r = rocks[ri];
    const ry = getSeabedHeight(r.x, r.z);
    const m = new THREE.Mesh(rockGeos[ri % rockGeos.length], rockMat);
    m.position.set(r.x, ry + r.s * 0.28, r.z);
    m.scale.set(r.s * randRange(0.92, 1.32), r.s * randRange(0.55, 0.92), r.s * randRange(0.92, 1.25));
    m.rotation.set(randRange(-0.18, 0.18), randRange(0, Math.PI * 2), randRange(-0.18, 0.18));
    m.castShadow = true;
    m.receiveShadow = true;
    scene.add(m);

    if (r.crystals) {
      for (let c = 0; c < 3; c++) {
        const cr = new THREE.Mesh(crystalGeo, crystalMat);
        cr.position.set(r.x + randRange(-0.5, 0.5), ry + r.s * 0.42, r.z + randRange(-0.5, 0.5));
        cr.rotation.set(randRange(-0.4, 0.4), randRange(0, Math.PI * 2), randRange(-0.4, 0.4));
        cr.scale.setScalar(randRange(0.6, 1.15));
        scene.add(cr);
      }
    }
  }

  // 3b. Instanced Seabed Pebbles, Water-Worn Stones & Calcified Coral Rubble (1 draw call)
  const pebbleCount = 340;
  const pebbleGeo = buildSeabedPebbleGeometry();
  const pebbleMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.76,
    metalness: 0.06,
    normalMap: tex?.rockNormal ?? null,
    normalScale: new THREE.Vector2(0.85, 0.85),
  });
  enhanceMaterialWithUnderwaterCaustics(pebbleMat, sharedUniforms, {
    causticStrength: 0.56,
    subsurfaceStrength: 0.08,
    ventBounceStrength: 0.45,
  });
  const pebbleInst = new THREE.InstancedMesh(pebbleGeo, pebbleMat, pebbleCount);
  pebbleInst.castShadow = true;
  pebbleInst.receiveShadow = true;
  const pDummy = new THREE.Object3D();
  const pCol = new THREE.Color();
  const pebblePalette = [0x3d5460, 0x566b6b, 0x7a887a, 0x2c404c, 0x8b8e7d, 0x4c5d67];
  for (let i = 0; i < pebbleCount; i++) {
    let px: number;
    let pz: number;
    if (i < pebbleCount * 0.6) {
      const host = rocks[i % rocks.length];
      const ang = randRange(0, Math.PI * 2);
      const dist = host.s * randRange(0.75, 2.15);
      [px, pz] = clampXZToTankRadius(host.x + Math.cos(ang) * dist, host.z + Math.sin(ang) * dist, 0.7);
    } else {
      const pt = randomWeightedPointInReef(TANK.coreRadius + 2.5, TANK.maxRadius - 1.5);
      px = pt.x;
      pz = pt.z;
    }
    const py = getSeabedHeight(px, pz);
    const sc = randRange(0.35, 1.35);
    pDummy.position.set(px, py + 0.03 * sc, pz);
    pDummy.rotation.set(randRange(-0.35, 0.35), randRange(0, Math.PI * 2), randRange(-0.35, 0.35));
    pDummy.scale.set(sc * randRange(0.85, 1.35), sc * randRange(0.65, 1.1), sc * randRange(0.85, 1.25));
    pDummy.updateMatrix();
    pebbleInst.setMatrixAt(i, pDummy.matrix);
    pCol.setHex(pebblePalette[i % pebblePalette.length]).offsetHSL(0, 0, randRange(-0.04, 0.04));
    pebbleInst.setColorAt(i, pCol);
  }
  pebbleInst.instanceMatrix.needsUpdate = true;
  if (pebbleInst.instanceColor) pebbleInst.instanceColor.needsUpdate = true;
  scene.add(pebbleInst);

  // 4. Sculpted Primordial Hydrothermal Genesis Vent Architecture
  const ventGroup = new THREE.Group();
  ventGroup.position.set(vx, vy, vz);

  const ventBasaltMat = createVentBasaltMaterial(sharedUniforms);
  const ventCoreMat = createVentCoreMaterial(sharedUniforms);
  const unitCoreGeo = new THREE.SphereGeometry(1.0, 26, 18);

  // 4a. Broad terraced basalt apron mound anchoring the smoker cluster into the seabed
  const mound = new THREE.Mesh(buildVentMoundGeometry(), ventBasaltMat);
  mound.castShadow = true;
  mound.receiveShadow = true;
  ventGroup.add(mound);

  // 4b. Primary fluted hydrothermal chimney with mineral pagoda flanges & recessed throat
  const mainBaseY = 0.24;
  const mainHeight = 2.15;
  const mainTopR = 0.58;
  const mainTopY = mainBaseY + mainHeight;
  const mainChimney = new THREE.Mesh(buildVentChimneyGeometry(mainHeight, 1.28, mainTopR, 0.7), ventBasaltMat);
  mainChimney.position.y = mainBaseY;
  mainChimney.castShadow = true;
  mainChimney.receiveShadow = true;
  ventGroup.add(mainChimney);

  // 4c. Three asymmetric parasitic side ventlet spires around the main chimney
  const sideSpires = [
    { x: 1.02, z: 0.46, h: 1.38, rB: 0.56, rT: 0.24, tiltX: 0.08, tiltZ: -0.16, seed: 2.3 },
    { x: -0.94, z: 0.58, h: 1.12, rB: 0.48, rT: 0.20, tiltX: 0.12, tiltZ: 0.15, seed: 4.1 },
    { x: 0.28, z: -1.04, h: 0.96, rB: 0.46, rT: 0.19, tiltX: -0.14, tiltZ: -0.06, seed: 5.8 },
  ];
  const sideCoreMeshes: Array<{ mesh: THREE.Mesh; baseR: number }> = [];
  const sidePlumeMats: THREE.ShaderMaterial[] = [];

  for (let s = 0; s < sideSpires.length; s++) {
    const sp = sideSpires[s];
    const spireHolder = new THREE.Group();
    spireHolder.position.set(sp.x, 0.14, sp.z);
    spireHolder.rotation.set(sp.tiltX, sp.seed, sp.tiltZ);

    const spireMesh = new THREE.Mesh(buildVentChimneyGeometry(sp.h, sp.rB, sp.rT, sp.seed), ventBasaltMat);
    spireHolder.add(spireMesh);

    const miniCoreR = sp.rT * 0.64;
    const miniCore = new THREE.Mesh(unitCoreGeo, ventCoreMat);
    miniCore.scale.set(miniCoreR, miniCoreR * 0.46, miniCoreR);
    miniCore.position.y = sp.h * 0.84;
    spireHolder.add(miniCore);
    sideCoreMeshes.push({ mesh: miniCore, baseR: miniCoreR });

    const miniPlumeMat = createVentPlumeMaterial(sharedUniforms, 1.9 + s * 2.1, 0.52);
    const miniPlume = new THREE.Mesh(buildVentPlumeGeometry(sp.rT * 0.60, sp.rT * 2.15, 2.05), miniPlumeMat);
    miniPlume.position.y = sp.h * 0.88;
    spireHolder.add(miniPlume);
    sidePlumeMats.push(miniPlumeMat);

    ventGroup.add(spireHolder);
  }

  // 4d. Boiling geothermal plasma-mineral throat pool nestled snugly inside the main crater cavity
  const mainCoreBaseR = mainTopR * 0.64;
  const ventCore = new THREE.Mesh(unitCoreGeo, ventCoreMat);
  ventCore.scale.set(mainCoreBaseR, mainCoreBaseR * 0.44, mainCoreBaseR);
  ventCore.position.y = mainBaseY + mainHeight * 0.86;
  ventGroup.add(ventCore);

  // 4e. Dual-layer volumetric rising hydrothermal plumes (bright inner jet + billowing outer mist sheath)
  const ventPlumeMat = createVentPlumeMaterial(sharedUniforms, 0.0, 1.0);
  const innerPlume = new THREE.Mesh(buildVentPlumeGeometry(0.32, 1.18, 4.1), ventPlumeMat);
  innerPlume.position.y = mainTopY - 0.14;
  ventGroup.add(innerPlume);

  const outerPlumeMat = createVentPlumeMaterial(sharedUniforms, 2.7, 0.68);
  const outerPlume = new THREE.Mesh(buildVentPlumeGeometry(0.48, 1.92, 5.2), outerPlumeMat);
  outerPlume.position.y = mainTopY - 0.04;
  ventGroup.add(outerPlume);
  sidePlumeMats.push(outerPlumeMat);

  // 4f. Faceted hydrothermal mineral crystals jutting from volcanic fissures around the vent base
  const ventCrystalClusters = [
    { x: 1.32, y: 0.32, z: -0.35, count: 4 },
    { x: -1.28, y: 0.28, z: -0.45, count: 4 },
    { x: -0.25, y: 0.42, z: 1.28, count: 3 },
    { x: 0.72, y: 1.02, z: 0.72, count: 3 },
  ];
  for (const cl of ventCrystalClusters) {
    for (let k = 0; k < cl.count; k++) {
      const cr = new THREE.Mesh(crystalGeo, crystalMat);
      cr.position.set(
        cl.x + randRange(-0.22, 0.22),
        cl.y + randRange(-0.04, 0.08),
        cl.z + randRange(-0.22, 0.22)
      );
      cr.rotation.set(randRange(-0.55, 0.55), randRange(0, Math.PI * 2), randRange(-0.55, 0.55));
      cr.scale.setScalar(randRange(0.42, 0.88));
      ventGroup.add(cr);
    }
  }

  // 4g. Chemosynthetic Abyssal Vent Tubeworm Colonies swaying on the warm mineral shelves
  const tubeStalkGeo = buildVentTubewormStalk();
  const tubePlumeGeo = buildTubewormPlumeGeometry();

  const tubeStalkMat = new THREE.MeshPhysicalMaterial({
    color: 0xcfd6ce,
    roughness: 0.56,
    metalness: 0.04,
    clearcoat: 0.28,
    emissive: 0x0f2c34,
    emissiveIntensity: 0.22,
  });
  const tubePlumeWarmMat = new THREE.MeshStandardMaterial({
    color: 0xff5a6e,
    emissive: 0xff3b5c,
    emissiveIntensity: 0.85,
    roughness: 0.35,
    side: THREE.DoubleSide,
  });
  const tubePlumeCyanMat = new THREE.MeshStandardMaterial({
    color: 0x5af7ff,
    emissive: 0x1ee6ff,
    emissiveIntensity: 0.85,
    roughness: 0.35,
    side: THREE.DoubleSide,
  });

  const tubewormPivots: Array<{ pivot: THREE.Group; phase: number; baseRx: number; baseRz: number }> = [];
  const wormClusters = [
    { x: -1.18, y: 0.36, z: 0.06, n: 7 },
    { x: 0.58, y: 0.44, z: 1.05, n: 6 },
    { x: -0.42, y: 0.46, z: -1.06, n: 6 },
    { x: 1.12, y: 0.42, z: -0.78, n: 5 },
  ];
  let wormIdx = 0;
  for (const wc of wormClusters) {
    for (let w = 0; w < wc.n; w++) {
      const piv = new THREE.Group();
      const ang = (w / wc.n) * Math.PI * 2 + randRange(-0.25, 0.25);
      const rad = randRange(0.04, 0.24);
      piv.position.set(wc.x + Math.cos(ang) * rad, wc.y, wc.z + Math.sin(ang) * rad);
      piv.rotation.y = randRange(0, Math.PI * 2);
      const baseRx = randRange(-0.24, 0.24);
      const baseRz = randRange(-0.24, 0.24);
      piv.rotation.x = baseRx;
      piv.rotation.z = baseRz;
      const sc = randRange(0.58, 1.18);
      piv.scale.setScalar(sc);

      const stalk = new THREE.Mesh(tubeStalkGeo, tubeStalkMat);
      piv.add(stalk);

      const plumeMat = wormIdx % 3 === 0 ? tubePlumeCyanMat : tubePlumeWarmMat;
      const plumeTip = new THREE.Mesh(tubePlumeGeo, plumeMat);
      plumeTip.position.set(0.055, 0.50, 0.02);
      piv.add(plumeTip);

      ventGroup.add(piv);
      tubewormPivots.push({ pivot: piv, phase: wormIdx * 0.85, baseRx, baseRz });
      wormIdx++;
    }
  }

  scene.add(ventGroup);

  // 4h. Rising Luminous Thermal Sparks & Primordial Spore-Motes spiraling up the vent plume
  const sparkN = 96;
  const sparkPos = new Float32Array(sparkN * 3);
  const sparkCol = new Float32Array(sparkN * 3);
  const sparkData: Array<{ ox: number; oy: number; oz: number; speed: number; radius: number; phase: number }> = [];
  const cHot = new THREE.Color(0xff9b42);
  const cBio = new THREE.Color(0x52f7ff);
  const cTmp = new THREE.Color();

  for (let i = 0; i < sparkN; i++) {
    const useSide = i >= 66;
    const sp = sideSpires[i % sideSpires.length];
    const ox = useSide ? vx + sp.x : vx;
    const oz = useSide ? vz + sp.z : vz;
    const oy = useSide ? vy + 0.14 + sp.h * 0.92 : vy + mainTopY - 0.08;
    const phase = randRange(0, Math.PI * 2);
    const radius = useSide ? randRange(0.04, 0.20) : randRange(0.06, 0.36);
    const h = randRange(0, 5.2);
    sparkData.push({ ox, oy, oz, speed: randRange(0.85, 1.95), radius, phase });
    sparkPos[i * 3] = ox + Math.cos(phase) * radius;
    sparkPos[i * 3 + 1] = oy + h;
    sparkPos[i * 3 + 2] = oz + Math.sin(phase) * radius;

    cTmp.copy(cHot).lerp(cBio, i % 4 === 0 ? 0.25 : 0.88);
    sparkCol[i * 3] = cTmp.r;
    sparkCol[i * 3 + 1] = cTmp.g;
    sparkCol[i * 3 + 2] = cTmp.b;
  }
  const sparkGeo = new THREE.BufferGeometry();
  sparkGeo.setAttribute('position', new THREE.BufferAttribute(sparkPos, 3));
  sparkGeo.setAttribute('color', new THREE.BufferAttribute(sparkCol, 3));
  const ventSparksMat = new THREE.PointsMaterial({
    size: tex ? 0.21 : 0.125,
    map: tex?.marineSnowSprite ?? null,
    alphaTest: 0.01,
    vertexColors: true,
    transparent: true,
    opacity: 0.82,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const ventSparks = new THREE.Points(sparkGeo, ventSparksMat);
  scene.add(ventSparks);

  // 5. Horizontally Unbounded Animated Water Surface with Snell's Window Optics
  const surfGeo = buildCircularDiskGeometry(TANK.worldRadius, 56, 108, undefined, 0.12, 1.62);
  const surf = new THREE.Mesh(surfGeo, createWaterSurfaceMaterial(sharedUniforms));
  surf.position.y = TANK.waterY;
  scene.add(surf);

  // 6. Volumetric Sun God Rays (foreground, midground & distant open-water shafts)
  const rays = [
    { x: -6.8, z: -2.2, rT: 0.95, rB: 3.8, rotZ: -0.17, p: 0.0 },
    { x: -0.6, z: 0.6, rT: 1.15, rB: 4.3, rotZ: -0.15, p: 1.8 },
    { x: 6.2, z: -1.8, rT: 0.98, rB: 3.9, rotZ: -0.19, p: 3.5 },
    { x: 2.8, z: 4.8, rT: 0.86, rB: 3.4, rotZ: -0.14, p: 5.0 },
    { x: -3.2, z: 5.6, rT: 0.82, rB: 3.2, rotZ: -0.16, p: 6.4 },
    { x: -12.5, z: -9.5, rT: 1.25, rB: 4.8, rotZ: -0.18, p: 2.6 },
    { x: 11.8, z: -8.6, rT: 1.2, rB: 4.6, rotZ: -0.16, p: 4.3 },
    { x: 0.8, z: -13.5, rT: 1.35, rB: 5.0, rotZ: -0.17, p: 5.9 },
    { x: 12.2, z: 6.5, rT: 1.1, rB: 4.2, rotZ: -0.15, p: 1.1 },
  ];
  for (const r of rays) {
    const ray = new THREE.Mesh(
      new THREE.CylinderGeometry(r.rT, r.rB, TANK.waterY * 0.96, 16, 1, true),
      createGodRayMaterial(sharedUniforms, r.p)
    );
    ray.position.set(r.x, TANK.waterY * 0.51, r.z);
    ray.rotation.z = r.rotZ;
    scene.add(ray);
  }

  // 7. Drifting Marine Snow Spanning the Wide Diver Volume (Responds to 3D Water Current!)
  const snowN = 760;
  const snowMaxR = TANK.maxRadius + 3.5;
  const snowPos = new Float32Array(snowN * 3);
  const snowPhases = new Float32Array(snowN);
  for (let i = 0; i < snowN; i++) {
    const r = Math.sqrt(Math.random()) * snowMaxR;
    const ang = Math.random() * Math.PI * 2;
    snowPos[i * 3] = Math.cos(ang) * r;
    snowPos[i * 3 + 1] = randRange(1.0, TANK.waterY - 0.5);
    snowPos[i * 3 + 2] = Math.sin(ang) * r;
    snowPhases[i] = randRange(0, Math.PI * 2);
  }
  const snowGeo = new THREE.BufferGeometry();
  snowGeo.setAttribute('position', new THREE.BufferAttribute(snowPos, 3));
  const marineSnow = new THREE.Points(
    snowGeo,
    new THREE.PointsMaterial({
      color: 0xcaf5ff,
      size: tex ? 0.155 : 0.082,
      map: tex?.marineSnowSprite ?? null,
      alphaTest: 0.01,
      transparent: true,
      opacity: 0.52,
      depthWrite: false,
    })
  );
  scene.add(marineSnow);

  // 9. Rising Hydrothermal & Aeration Bubble Streams (main chimney + side spires!)
  const bubN = 148;
  const bubPos = new Float32Array(bubN * 3);
  const bubbleSpeeds = new Float32Array(bubN);
  const bubbleOrigins: Array<{ x: number; y: number; z: number }> = [];
  for (let i = 0; i < bubN; i++) {
    const fromMainVent = i < 74;
    const fromSideVent = i >= 74 && i < 110;
    const sp = sideSpires[i % sideSpires.length];
    const ambientPt = fromMainVent || fromSideVent ? null : randomPointInTankDisk(1.6);
    const ox = fromMainVent
      ? vx + randRange(-0.36, 0.36)
      : fromSideVent
      ? vx + sp.x + randRange(-0.12, 0.12)
      : ambientPt!.x;
    const oz = fromMainVent
      ? vz + randRange(-0.36, 0.36)
      : fromSideVent
      ? vz + sp.z + randRange(-0.12, 0.12)
      : ambientPt!.z;
    const oy = fromMainVent
      ? vy + mainTopY - 0.08
      : fromSideVent
      ? vy + 0.14 + sp.h * 0.92
      : getSeabedHeight(ox, oz) + 0.3;
    bubbleOrigins.push({ x: ox, y: oy, z: oz });
    bubPos[i * 3] = ox;
    bubPos[i * 3 + 1] = randRange(oy, TANK.waterY - 0.3);
    bubPos[i * 3 + 2] = oz;
    bubbleSpeeds[i] = randRange(1.1, 2.35);
  }
  const bubGeo = new THREE.BufferGeometry();
  bubGeo.setAttribute('position', new THREE.BufferAttribute(bubPos, 3));
  const bubbles = new THREE.Points(
    bubGeo,
    new THREE.PointsMaterial({
      color: 0xdafaff,
      size: tex ? 0.25 : 0.14,
      map: tex?.bubbleSprite ?? null,
      alphaTest: 0.01,
      transparent: true,
      opacity: 0.78,
      depthWrite: false,
    })
  );
  scene.add(bubbles);

  const curTmp = new THREE.Vector3();
  const dayBg = new THREE.Color(0x041d30);
  const duskBg = new THREE.Color(0x081529);
  const nightBg = new THREE.Color(0x010913);
  const targetFog = new THREE.Color();

  return {
    ventLight,
    ventCore,
    ventPlumeMat,
    sunLight,
    hemiLight,
    fillLight,
    waterPlaneY: TANK.waterY,
    update(realDt, currentStrength, ventPulseEnergy, daylight, timeOfDay) {
      sharedUniforms.uTime.value += realDt;
      sharedUniforms.uDaylight.value = daylight;
      const t = sharedUniforms.uTime.value;

      // Solar arc across tank
      const sunAngle = (timeOfDay - 0.25) * Math.PI * 2;
      const sunX = Math.cos(sunAngle) * 16;
      const sunY = Math.max(6, Math.sin(sunAngle) * 26 + 10);
      sunLight.position.set(sunX, sunY, 10);
      sharedUniforms.uSunDir.value.set(sunX, sunY, 10).normalize();

      // Smooth Day -> Dusk -> Abyssal Night atmosphere interpolation
      if (daylight > 0.45) {
        targetFog.copy(duskBg).lerp(dayBg, (daylight - 0.45) / 0.55);
      } else {
        targetFog.copy(nightBg).lerp(duskBg, daylight / 0.45);
      }
      sharedUniforms.uFogColor.value.copy(targetFog);
      if (scene.background instanceof THREE.Color) scene.background.copy(targetFog);
      if (scene.fog instanceof THREE.FogExp2) scene.fog.color.copy(targetFog);

      sunLight.intensity = 0.22 + daylight * 1.55;
      hemiLight.intensity = 0.36 + daylight * 0.88;
      fillLight.intensity = 0.30 + daylight * 0.42;
      crystalMat.emissiveIntensity = 0.55 + (1.0 - daylight) * 0.95;

      // Hydrothermal Genesis Vent: dark & dormant between events; awakens before a pulse,
      // peaks at genesis, and dims back to zero thereafter.
      const basePulse = THREE.MathUtils.clamp(ventPulseEnergy, 0, 1);
      const flicker = basePulse > 0.002 ? 0.90 + 0.10 * Math.sin(t * 5.2) : 0.0;
      const vg = basePulse * flicker;
      sharedUniforms.uVentPulse.value = vg;
      ventLight.intensity = vg * 7.2 * (1.3 - 0.3 * daylight);
      ventWarmLight.intensity = vg * 3.8 * (1.28 - 0.28 * daylight);

      const coreVisible = vg > 0.004;
      ventCore.visible = coreVisible;
      const coreS = mainCoreBaseR * (0.72 + vg * 0.38);
      ventCore.scale.set(coreS, coreS * 0.44, coreS);
      for (let s = 0; s < sideCoreMeshes.length; s++) {
        const entry = sideCoreMeshes[s];
        entry.mesh.visible = coreVisible;
        const sc = entry.baseR * (0.72 + vg * (0.28 + 0.10 * Math.sin(t * 3.4 + s * 1.7)));
        entry.mesh.scale.set(sc, sc * 0.46, sc);
      }

      ventPlumeMat.uniforms.uCurrent.value = currentStrength;
      for (let i = 0; i < sidePlumeMats.length; i++) {
        sidePlumeMats[i].uniforms.uCurrent.value = currentStrength;
      }

      // Gently sway chemosynthetic tubeworm plumes in the thermal updraft
      const wormAmp = 0.09 + currentStrength * 0.08 + basePulse * 0.08;
      for (let i = 0; i < tubewormPivots.length; i++) {
        const tw = tubewormPivots[i];
        tw.pivot.rotation.x = tw.baseRx + Math.sin(t * 2.1 + tw.phase) * wormAmp;
        tw.pivot.rotation.z = tw.baseRz + Math.cos(t * 1.85 + tw.phase) * wormAmp;
      }
      const wormGlow = (0.32 + vg * 0.85 + (1.0 - daylight) * 0.35) * (0.90 + 0.10 * Math.sin(t * 2.6));
      tubePlumeWarmMat.emissiveIntensity = wormGlow;
      tubePlumeCyanMat.emissiveIntensity = wormGlow * (0.92 + vg * 0.45);

      // Animate rising luminous thermal sparks & primordial motes spiraling inside the plume
      ventSparks.visible = vg > 0.006;
      ventSparksMat.opacity = Math.min(0.96, vg * 0.96 * (1.25 - 0.25 * daylight));
      const spAttr = ventSparks.geometry.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < sparkN; i++) {
        const sd = sparkData[i];
        let y = spAttr.getY(i) + sd.speed * (0.75 + basePulse * 0.95) * realDt;
        const maxH = sd.oy + 5.6;
        if (y > maxH) {
          y = sd.oy;
        }
        const hFrac = Math.max(0, (y - sd.oy) / 5.6);
        const swirlR = sd.radius * (1.0 + hFrac * 2.1);
        const ang = sd.phase + t * 1.35 + hFrac * 4.5;
        const driftX = currentStrength * 0.45 * hFrac * hFrac;
        const driftZ = currentStrength * 0.22 * hFrac * hFrac;
        spAttr.setXYZ(i, sd.ox + Math.cos(ang) * swirlR + driftX, y, sd.oz + Math.sin(ang) * swirlR + driftZ);
      }
      spAttr.needsUpdate = true;

      // Drift marine snow along 3D current field
      const snowAttr = marineSnow.geometry.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < snowAttr.count; i++) {
        let x = snowAttr.getX(i);
        let y = snowAttr.getY(i);
        let z = snowAttr.getZ(i);
        sampleWaterCurrent(x, y, z, t, currentStrength * 0.38, curTmp);
        x += (Math.sin(t * 0.35 + snowPhases[i]) * 0.08 + curTmp.x) * realDt;
        y += (-0.1 + curTmp.y * 0.25) * realDt;
        z += curTmp.z * realDt;

        if (y < 0.8) y = TANK.waterY - 0.5;
        if (y > TANK.waterY - 0.35) y = 1.0;
        const maxSnowR = snowMaxR;
        const rSq = x * x + z * z;
        if (rSq > maxSnowR * maxSnowR) {
          // Seamlessly wrap distant plankton motes back across the diver's volume
          const inv = -((maxSnowR - 0.25) / Math.sqrt(rSq));
          x *= inv;
          z *= inv;
        }
        snowAttr.setXYZ(i, x, y, z);
      }
      snowAttr.needsUpdate = true;

      // Animate rising bubbles (advected subtly with current as they rise)
      const bubAttr = bubbles.geometry.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < bubAttr.count; i++) {
        const y = bubAttr.getY(i) + bubbleSpeeds[i] * realDt;
        const o = bubbleOrigins[i];
        if (y >= TANK.waterY - 0.25) {
          bubAttr.setXYZ(i, o.x, o.y, o.z);
        } else {
          const riseFrac = Math.max(0, (y - o.y) / Math.max(1, TANK.waterY - o.y));
          bubAttr.setXYZ(
            i,
            o.x + Math.sin(t * 2.4 + i) * 0.16 + currentStrength * 0.35 * riseFrac,
            y,
            o.z + Math.cos(t * 2.1 + i * 1.3) * 0.16 + currentStrength * 0.16 * riseFrac
          );
        }
      }
      bubAttr.needsUpdate = true;
    },
  };
}
