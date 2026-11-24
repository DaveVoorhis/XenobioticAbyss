import * as THREE from 'three';

export interface GeometrySet {
  // Core animal body plans
  readonly fusiformBody: THREE.BufferGeometry;
  readonly caudalPeduncle: THREE.BufferGeometry;
  readonly forkedTailFin: THREE.BufferGeometry;
  readonly sweptFin: THREE.BufferGeometry;
  readonly dorsalSail: THREE.BufferGeometry;
  readonly operculumPlate: THREE.BufferGeometry;
  readonly fishLowerJaw: THREE.BufferGeometry;
  readonly toothRow: THREE.BufferGeometry;
  readonly gillArch: THREE.BufferGeometry;
  readonly mantaBody: THREE.BufferGeometry;
  readonly mantaWingInner: THREE.BufferGeometry;
  readonly mantaWingMid: THREE.BufferGeometry;
  readonly mantaWingTip: THREE.BufferGeometry;
  readonly cephalicLobe: THREE.BufferGeometry;
  readonly medusaBell: THREE.BufferGeometry;
  readonly medusaManubrium: THREE.BufferGeometry;
  readonly medusaGonad: THREE.BufferGeometry;
  readonly medusaOralArm: THREE.BufferGeometry;
  readonly eelHead: THREE.BufferGeometry;
  readonly eelLowerJaw: THREE.BufferGeometry;
  readonly eelFangs: THREE.BufferGeometry;
  readonly eelSegment: THREE.BufferGeometry;
  readonly eelTail: THREE.BufferGeometry;
  readonly trilopodCephalon: THREE.BufferGeometry;
  readonly trilopodPlate: THREE.BufferGeometry;
  readonly trilopodSternum: THREE.BufferGeometry;
  readonly trilopodCompoundEye: THREE.BufferGeometry;
  readonly trilopodTailFan: THREE.BufferGeometry;
  // Appendages & organs
  readonly taperedTentacle: THREE.BufferGeometry;
  readonly spineHorn: THREE.BufferGeometry;
  readonly mandibleClaw: THREE.BufferGeometry;
  readonly eyeStalk: THREE.BufferGeometry;
  readonly antenna: THREE.BufferGeometry;
  readonly eyeSocket: THREE.BufferGeometry;
  readonly eyeGlobe: THREE.BufferGeometry;
  readonly eyeCornea: THREE.BufferGeometry;
  readonly lureStem: THREE.BufferGeometry;
  readonly lureBulb: THREE.BufferGeometry;
  readonly lureFilament: THREE.BufferGeometry;
  readonly legUpper: THREE.BufferGeometry;
  readonly legLower: THREE.BufferGeometry;
  readonly sensoryBarbel: THREE.BufferGeometry;
  readonly armorScutePlate: THREE.BufferGeometry;
  readonly featherPlume: THREE.BufferGeometry;
  readonly electroNode: THREE.BufferGeometry;
  readonly ventralKeel: THREE.BufferGeometry;
  // Flora geometries
  readonly kelpStipe: THREE.BufferGeometry;
  readonly kelpBlade: THREE.BufferGeometry;
  readonly kelpBladder: THREE.BufferGeometry;
  readonly holdfastRoot: THREE.BufferGeometry;
  readonly coralBranch: THREE.BufferGeometry;
  readonly coralPolypCup: THREE.BufferGeometry;
  readonly coralPolypTip: THREE.BufferGeometry;
  readonly bulbStem: THREE.BufferGeometry;
  readonly bulbPod: THREE.BufferGeometry;
  readonly bulbInnerCore: THREE.BufferGeometry;
  readonly bulbPetal: THREE.BufferGeometry;
  readonly bulbStamen: THREE.BufferGeometry;
  readonly anemoneColumn: THREE.BufferGeometry;
  readonly anemoneOralDisc: THREE.BufferGeometry;
  readonly anemoneTentacle: THREE.BufferGeometry;
  readonly sporeStalk: THREE.BufferGeometry;
  readonly sporeAnnulus: THREE.BufferGeometry;
  readonly sporeCap: THREE.BufferGeometry;
  readonly sporeGills: THREE.BufferGeometry;
  readonly ribbonBlade: THREE.BufferGeometry;
  readonly spongeTube: THREE.BufferGeometry;
  readonly plantThorn: THREE.BufferGeometry;
  // Shared small entities & FX
  readonly sphereLow: THREE.BufferGeometry;
  readonly egg: THREE.BufferGeometry;
  readonly eggEmbryo: THREE.BufferGeometry;
  readonly spore: THREE.BufferGeometry;
  readonly pellet: THREE.BufferGeometry;
  readonly nutrientDisc: THREE.BufferGeometry;
  readonly particle: THREE.BufferGeometry;
  readonly tornFleshShred: THREE.BufferGeometry;
  readonly tornLeafRibbon: THREE.BufferGeometry;
  readonly shockRing: THREE.BufferGeometry;
}

/**
 * Attaches smooth organic RGB vertex colors to a geometry to provide anatomical
 * ambient occlusion in crevices, dorsal-ventral countershading, and translucent fin/petal edges.
 */
function applyVertexColors(
  geo: THREE.BufferGeometry,
  colorFn: (x: number, y: number, z: number, i: number) => [number, number, number]
): void {
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const [r, g, b] = colorFn(pos.getX(i), pos.getY(i), pos.getZ(i), i);
    colors[i * 3] = THREE.MathUtils.clamp(r, 0.05, 1.35);
    colors[i * 3 + 1] = THREE.MathUtils.clamp(g, 0.05, 1.35);
    colors[i * 3 + 2] = THREE.MathUtils.clamp(b, 0.05, 1.35);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
}

/**
 * Merges multiple indexed or non-indexed BufferGeometries into a single BufferGeometry
 * with clean positions, normals, and UVs.
 */
function mergeGeometriesSimple(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  let vertexOffset = 0;

  for (const g of geos) {
    const pos = g.attributes.position;
    const uv = g.attributes.uv;
    for (let i = 0; i < pos.count; i++) {
      positions.push(pos.getX(i), pos.getY(i), pos.getZ(i));
      if (uv) uvs.push(uv.getX(i), uv.getY(i));
      else uvs.push(0.5, 0.5);
    }
    if (g.index) {
      for (let i = 0; i < g.index.count; i++) {
        indices.push(g.index.getX(i) + vertexOffset);
      }
    } else {
      for (let i = 0; i < pos.count; i++) indices.push(i + vertexOffset);
    }
    vertexOffset += pos.count;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  out.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  out.setIndex(indices);
  out.computeVertexNormals();
  return out;
}

/**
 * Helper: build a smooth tapered organic tube along a 3D CatmullRom curve.
 */
function buildTaperedCurveTube(
  points: THREE.Vector3[],
  tubularSegments: number,
  radialSegments: number,
  radiusFn: (t: number, angle: number) => number
): THREE.BufferGeometry {
  const curve = new THREE.CatmullRomCurve3(points);
  const frames = curve.computeFrenetFrames(tubularSegments, false);

  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  const P = new THREE.Vector3();
  const N = new THREE.Vector3();
  const B = new THREE.Vector3();

  for (let i = 0; i <= tubularSegments; i++) {
    const t = i / tubularSegments;
    curve.getPointAt(t, P);
    N.copy(frames.normals[i]);
    B.copy(frames.binormals[i]);

    for (let j = 0; j <= radialSegments; j++) {
      const v = j / radialSegments;
      const ang = v * Math.PI * 2;
      const r = Math.max(0.0008, radiusFn(t, ang));
      const sin = Math.sin(ang);
      const cos = -Math.cos(ang);

      const vx = P.x + r * (cos * N.x + sin * B.x);
      const vy = P.y + r * (cos * N.y + sin * B.y);
      const vz = P.z + r * (cos * N.z + sin * B.z);
      positions.push(vx, vy, vz);
      uvs.push(v, t);
    }
  }

  const stride = radialSegments + 1;
  for (let i = 0; i < tubularSegments; i++) {
    for (let j = 0; j < radialSegments; j++) {
      const a = i * stride + j;
      const b = (i + 1) * stride + j;
      const c = (i + 1) * stride + (j + 1);
      const d = i * stride + (j + 1);
      indices.push(a, b, d);
      indices.push(b, c, d);
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
 * Helper: build a smooth organic double-sided hydrofoil fin mesh with airfoil thickness,
 * gentle camber, and sinusoidal fin-ray fluting.
 */
function buildHydrofoilPanel(
  uSegs: number,
  vSegs: number,
  pointFn: (u: number, v: number) => { x: number; y: number; z: number; halfThick: number }
): THREE.BufferGeometry {
  // Build top & bottom surfaces joined smoothly around the perimeter
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  const cols = uSegs + 1;
  const rows = vSegs + 1;

  // Top face (offset +normal approximation along local Y/X)
  for (let iv = 0; iv <= vSegs; iv++) {
    const v = iv / vSegs;
    for (let iu = 0; iu <= uSegs; iu++) {
      const u = iu / uSegs;
      const p = pointFn(u, v);
      positions.push(p.x, p.y + p.halfThick, p.z);
      uvs.push(u, v);
    }
  }
  // Bottom face
  const offset = cols * rows;
  for (let iv = 0; iv <= vSegs; iv++) {
    const v = iv / vSegs;
    for (let iu = 0; iu <= uSegs; iu++) {
      const u = iu / uSegs;
      const p = pointFn(u, v);
      positions.push(p.x, p.y - p.halfThick, p.z);
      uvs.push(u, v);
    }
  }

  // Auto-detect handedness from center quad so top normals always point +Y and bottom normals -Y
  const midU = Math.floor(uSegs * 0.5);
  const midV = Math.floor(vSegs * 0.5);
  const iA = (midV * cols + midU) * 3;
  const iB = (midV * cols + midU + 1) * 3;
  const iC = ((midV + 1) * cols + midU) * 3;
  const abX = positions[iB] - positions[iA];
  const abZ = positions[iB + 2] - positions[iA + 2];
  const acX = positions[iC] - positions[iA];
  const acZ = positions[iC + 2] - positions[iA + 2];
  // Y component of (B - A) x (C - A) is abZ * acX - abX * acZ
  const flipTop = abZ * acX - abX * acZ < 0;

  for (let iv = 0; iv < vSegs; iv++) {
    for (let iu = 0; iu < uSegs; iu++) {
      const a = iv * cols + iu;
      const b = a + 1;
      const c = a + cols;
      const d = c + 1;
      if (flipTop) {
        indices.push(a, c, b);
        indices.push(b, c, d);
        indices.push(offset + a, offset + b, offset + c);
        indices.push(offset + b, offset + d, offset + c);
      } else {
        indices.push(a, b, c);
        indices.push(b, d, c);
        indices.push(offset + a, offset + c, offset + b);
        indices.push(offset + b, offset + c, offset + d);
      }
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

// ============================================================================
// ANIMAL GEOMETRIES (HIGH-RESOLUTION ANATOMICAL SCULPTING)
// ============================================================================

function buildFusiformBody(): THREE.BufferGeometry {
  // Ultra-high-res 34-station x 44-radial sculpted hydrodynamic fish torso (+Z forward)
  const stations = 34;
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i <= stations; i++) {
    const t = i / stations; // 0 tail peduncle (-0.64) -> 1 snout (+0.64)
    const z = -0.64 + t * 1.28;
    // Teardrop hydrodynamic profile peaking around t=0.62 (shoulder/gills)
    const r = Math.sin(Math.pow(t, 0.71) * Math.PI) * 0.308 + 0.008;
    pts.push(new THREE.Vector2(r, z));
  }
  const geo = new THREE.LatheGeometry(pts, 44);
  geo.rotateX(Math.PI * 0.5); // Lathe Y -> +Z forward

  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    let x = pos.getX(i);
    let y = pos.getY(i);
    const z = pos.getZ(i);
    const t = THREE.MathUtils.clamp((z + 0.64) / 1.28, 0, 1); // 0 tail -> 1 snout

    // Laterally compressed sleek fish profile
    x *= 0.74;
    y *= 1.12;

    // Gentle dorsal spine arch & fuller chest contour
    const dorsalArch = Math.sin(Math.pow(t, 0.78) * Math.PI) * 0.048;
    y += dorsalArch;

    // Subtle dorsal keel & ventral keel sharpening
    const ang = Math.atan2(y, x);
    const dorsalFactor = Math.max(0, Math.sin(ang));
    const ventralFactor = Math.max(0, -Math.sin(ang));
    y += Math.pow(dorsalFactor, 5) * 0.036 * Math.sin(t * Math.PI);
    y -= Math.pow(ventralFactor, 4) * 0.018 * Math.sin(t * Math.PI);

    // Subtle muscular myomere flank waves along mid-body
    const myomere = Math.sin(t * Math.PI * 16.0 - Math.abs(y) * 9.0) * 0.004 * Math.sin(t * Math.PI);
    x += Math.sign(x) * myomere * Math.abs(Math.cos(ang));

    // Operculum (gill cover) cheek flare + recessed posterior gill slit groove
    const gillBump = Math.exp(-Math.pow((t - 0.71) / 0.062, 2)) * 0.024 * Math.abs(Math.cos(ang));
    const gillSlit = Math.exp(-Math.pow((t - 0.64) / 0.024, 2)) * 0.016 * Math.abs(Math.cos(ang));
    x += Math.sign(x) * (gillBump - gillSlit);

    // Sculpted supraorbital brow ridge & slight eye-socket recess around t=0.82
    const eyeZone = Math.exp(-Math.pow((t - 0.82) / 0.058, 2));
    const eyeCup = eyeZone * Math.exp(-Math.pow((y - 0.075) / 0.065, 2)) * 0.016;
    const browCrest = eyeZone * Math.exp(-Math.pow((y - 0.145) / 0.042, 2)) * 0.014;
    x += Math.sign(x) * (browCrest - eyeCup) * Math.abs(Math.cos(ang));
    if (y > 0.09) y += browCrest * 0.75;

    // Subtle lateral line furrow along flanks
    const lateralCrease = Math.exp(-Math.pow((y - 0.02) / 0.038, 2)) * 0.009 * Math.sin(t * Math.PI);
    x -= Math.sign(x) * lateralCrease;

    // Sculpted upper maxillary lip & recessed oral cavity on underside near snout
    if (t > 0.85 && y < 0.015) {
      const mouthDepth = (t - 0.85) / 0.15;
      y += mouthDepth * 0.042;
      if (y < -0.01) x *= 1.0 - mouthDepth * 0.14;
    }

    pos.setXYZ(i, x, y, z);
  }
  geo.computeVertexNormals();

  // Natural biological countershading (deeper dorsal back -> pale pearlescent belly + gill/mouth AO)
  applyVertexColors(geo, (_x, y, z) => {
    const t = THREE.MathUtils.clamp((z + 0.64) / 1.28, 0, 1);
    const vNorm = THREE.MathUtils.clamp((y + 0.28) / 0.60, 0, 1); // 0 belly -> 1 dorsal spine
    const counterShade = THREE.MathUtils.lerp(1.12, 0.76, Math.pow(vNorm, 1.35));
    const gillAO = 1.0 - Math.exp(-Math.pow((t - 0.64) / 0.028, 2)) * 0.18;
    const mouthAO = t > 0.88 && y < 0.0 ? 0.74 : 1.0;
    const s = counterShade * gillAO * mouthAO;
    return [s * 0.99, s * 1.0, s * 1.02];
  });
  return geo;
}

function buildCaudalPeduncle(): THREE.BufferGeometry {
  // Muscular transitional tail stalk from z=0 to z=-0.26
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i <= 10; i++) {
    const t = i / 10;
    const z = -t * 0.26;
    const r = 0.105 * (1 - t * 0.42) + Math.sin(t * Math.PI) * 0.012;
    pts.push(new THREE.Vector2(r, z));
  }
  const geo = new THREE.LatheGeometry(pts, 20);
  geo.rotateX(Math.PI * 0.5);
  geo.scale(0.62, 1.15, 1.0);
  geo.computeVertexNormals();
  return geo;
}

function buildForkedTailFin(): THREE.BufferGeometry {
  // Ultra-high-res crescent forked caudal fin with crisp lepidotrichia fin-ray ribs
  const fin = buildHydrofoilPanel(22, 26, (u, v) => {
    const sv = (v - 0.5) * 2.0; // -1..1
    const absV = Math.abs(sv);
    const forkCut = Math.pow(Math.max(0, 1.0 - absV), 1.7) * 0.28;
    const scallop = 1.0 + Math.sin(v * Math.PI * 22.0) * 0.018 * u;
    const zSpan = -(0.56 - forkCut) * u * scallop;
    const xSpan = sv * (0.06 + Math.pow(u, 0.84) * 0.44);
    const flute = Math.sin(v * Math.PI * 22) * 0.0095 * Math.pow(u, 0.65);
    const thick = (1.0 - u * 0.88) * 0.019 * (0.28 + 0.72 * absV);
    return {
      x: xSpan,
      y: flute,
      z: zSpan,
      halfThick: thick,
    };
  });
  fin.rotateZ(Math.PI * 0.5); // Lies vertically in Y-Z plane, extending along -Z
  fin.computeVertexNormals();
  applyVertexColors(fin, (_x, _y, z) => {
    const tip = THREE.MathUtils.clamp(-z / 0.56, 0, 1);
    const v = THREE.MathUtils.lerp(0.78, 1.14, tip);
    return [v, v * 1.02, v * 1.05];
  });
  return fin;
}

function buildSweptFin(): THREE.BufferGeometry {
  // Hydrofoil-cambered pectoral/pelvic fin with raised bony fin rays & delicate scalloped margin
  const fin = buildHydrofoilPanel(22, 20, (u, v) => {
    // u: 0 root -> 1 wingtip (+X); v: 0 leading edge -> 1 trailing edge
    const chord = (1.0 - Math.pow(u, 1.45) * 0.76) * 0.27;
    const sweepBack = Math.pow(u, 1.35) * 0.24;
    const x = u * 0.64;
    const trailingScallop = v > 0.7 ? Math.sin(u * Math.PI * 16) * 0.012 * (v - 0.7) : 0;
    const z = (0.5 - v) * chord - sweepBack + Math.sin(u * Math.PI) * 0.05 - trailingScallop;
    // Gentle arch & pronounced fin-ray lepidotrichia ribs
    const camber = Math.sin(v * Math.PI) * 0.025 * (1.0 - u * 0.4) - Math.pow(u, 1.8) * 0.036;
    const rayFlute = Math.sin(u * Math.PI * 18) * 0.0065 * (0.25 + 0.75 * v);
    // Airfoil thickness thicker near leading edge (v≈0.25) and root
    const airfoil = Math.sin(Math.pow(v, 0.6) * Math.PI);
    const halfThick = airfoil * 0.017 * (1.0 - u * 0.74);
    return {
      x,
      y: camber + rayFlute,
      z,
      halfThick,
    };
  });
  applyVertexColors(fin, (x) => {
    const tip = THREE.MathUtils.clamp(x / 0.64, 0, 1);
    const v = THREE.MathUtils.lerp(0.76, 1.15, tip);
    return [v, v * 1.02, v * 1.05];
  });
  return fin;
}

function buildDorsalSail(): THREE.BufferGeometry {
  // Gracefully arched, scalloped dorsal sail fin lying in Y-Z plane (front +Z)
  const fin = buildHydrofoilPanel(24, 20, (u, v) => {
    // u: 0 base -> 1 crest height; v: 0 front -> 1 back
    const baseLen = 0.74;
    const sweepBack = Math.pow(u, 1.3) * 0.26;
    const profileH = Math.sin(Math.pow(v, 0.7) * Math.PI) * 0.37 + 0.06 * (1 - v);
    // Subtle scalloped trailing/top margin
    const scallop = 1.0 + Math.sin(v * Math.PI * 11) * 0.055 * u;
    const xHeight = u * profileH * scallop;
    const z = (0.42 - v) * baseLen - sweepBack;
    const flute = Math.sin(v * Math.PI * 20) * 0.0105 * (0.2 + 0.8 * u);
    const halfThick = (1.0 - u * 0.86) * 0.015 * Math.sin(Math.max(0.05, Math.min(0.95, v)) * Math.PI);
    return {
      x: xHeight,
      y: flute,
      z,
      halfThick,
    };
  });
  fin.rotateZ(Math.PI * 0.5); // +X height becomes +Y vertical sail
  fin.computeVertexNormals();
  applyVertexColors(fin, (_x, y) => {
    const tip = THREE.MathUtils.clamp(y / 0.38, 0, 1);
    const v = THREE.MathUtils.lerp(0.75, 1.15, tip);
    return [v, v * 1.02, v * 1.05];
  });
  return fin;
}

function buildOperculumPlate(): THREE.BufferGeometry {
  // Sculpted anatomical beveled gill cover plate with preopercle ridge & curved posterior edge
  const geo = new THREE.SphereGeometry(0.165, 20, 14, 0, Math.PI * 0.56, Math.PI * 0.22, Math.PI * 0.56);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    let x = pos.getX(i) * 0.54;
    const y = pos.getY(i) * 1.16;
    const z = pos.getZ(i) * 0.98;
    // Raised preopercle bevel ridge running vertically along the cheek cover
    const ridge = Math.exp(-Math.pow((z - 0.025) / 0.032, 2)) * 0.015;
    // Subtle radial opercular striations
    const ang = Math.atan2(y, z);
    const striae = Math.sin(ang * 14.0) * 0.003;
    x += Math.sign(x || 1) * (ridge + striae);
    pos.setXYZ(i, x, y, z);
  }
  geo.computeVertexNormals();
  return geo;
}

/**
 * Curved anatomical jaw arch of fine sharp translucent conical marine teeth.
 */
function buildToothRow(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const count = 9;
  for (let i = 0; i < count; i++) {
    const frac = (i / (count - 1)) * 2 - 1; // -1..1
    const ang = frac * 1.15;
    const rX = 0.048;
    const rZ = 0.068;
    const x = Math.sin(ang) * rX;
    const z = Math.cos(ang) * rZ - 0.02;
    // Larger anterior canine fangs tapering to smaller rear teeth
    const h = 0.032 * (1.0 - Math.abs(frac) * 0.42);
    const rad = 0.0068 * (1.0 - Math.abs(frac) * 0.28);
    const tooth = new THREE.ConeGeometry(rad, h, 6, 1);
    tooth.translate(0, h * 0.5, 0);
    // Slight backward predatory recurve
    tooth.rotateX(-0.22);
    tooth.translate(x, 0, z);
    parts.push(tooth);
  }
  return mergeGeometriesSimple(parts);
}

/**
 * Sculpted crimson feathery gill-filament comb tucked beneath the operculum.
 */
function buildGillArch(): THREE.BufferGeometry {
  const geo = new THREE.PlaneGeometry(0.065, 0.17, 6, 16);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const t = (y + 0.085) / 0.17;
    const arch = Math.sin(t * Math.PI) * 0.025;
    const filament = Math.sin(t * Math.PI * 18.0) * 0.005 * (x > 0 ? 1 : 0.2);
    pos.setXYZ(i, x + filament, y, -arch);
  }
  geo.rotateY(Math.PI * 0.5);
  geo.computeVertexNormals();
  return geo;
}

function buildMantaBody(): THREE.BufferGeometry {
  const stations = 30;
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i <= stations; i++) {
    const t = i / stations;
    const z = -0.60 + t * 1.18;
    const r = Math.sin(Math.pow(t, 0.76) * Math.PI) * 0.42 + 0.008;
    pts.push(new THREE.Vector2(r, z));
  }
  const geo = new THREE.LatheGeometry(pts, 44);
  geo.rotateX(Math.PI * 0.5);

  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    let x = pos.getX(i);
    let y = pos.getY(i);
    const z = pos.getZ(i);
    const t = (z + 0.60) / 1.18;

    x *= 1.24;
    y *= 0.42;

    // Raised dorsal spine keel ridge + paired dorsal spiracle pits behind head
    if (y > 0) {
      const spine = Math.exp(-Math.pow(x / 0.14, 2)) * 0.058 * Math.sin(t * Math.PI);
      const spiracle =
        Math.exp(-Math.pow((t - 0.72) / 0.045, 2)) *
        Math.exp(-Math.pow((Math.abs(x) - 0.16) / 0.045, 2)) *
        0.024;
      const cranialCrest =
        Math.exp(-Math.pow((t - 0.80) / 0.08, 2)) *
        Math.exp(-Math.pow((Math.abs(x) - 0.20) / 0.07, 2)) *
        0.022;
      y += spine + cranialCrest - spiracle;
    } else {
      // 5 crisp curved ventral gill-slit indentations per side on underside
      const gillZone =
        Math.exp(-Math.pow((t - 0.56) / 0.17, 2)) *
        Math.exp(-Math.pow((Math.abs(x) - 0.19) / 0.11, 2));
      y += Math.sin(z * 48.0 - Math.abs(x) * 4.5) * 0.013 * gillZone;
      // Recessed wide anterior filter-feeding mouth cavern
      if (t > 0.82 && Math.abs(x) < 0.24) {
        y += ((t - 0.82) / 0.18) * 0.045 * (1.0 - Math.abs(x) / 0.24);
      }
    }

    pos.setXYZ(i, x, y, z);
  }
  geo.computeVertexNormals();
  applyVertexColors(geo, (_x, y) => {
    // Realistic manta dorsal dark countershading -> luminous pale white-silver ventral underside
    const dorsal = THREE.MathUtils.clamp((y + 0.18) / 0.38, 0, 1);
    const v = THREE.MathUtils.lerp(1.16, 0.74, Math.pow(dorsal, 1.15));
    return [v * 0.99, v, v * 1.02];
  });
  return geo;
}

function buildMantaWingAirfoil(
  lenX: number,
  frontZ0: number,
  backZ0: number,
  frontZ1: number,
  backZ1: number,
  thick0: number,
  thick1: number,
  curveLead = 0.035,
  curveTrail = -0.025
): THREE.BufferGeometry {
  // Smooth parametric airfoil panel matching seams seamlessly from inner -> mid -> tip
  const geo = buildHydrofoilPanel(20, 20, (u, v) => {
    // u: 0 root -> 1 outer edge along +X; v: 0 leading edge -> 1 trailing edge
    const leadZ = THREE.MathUtils.lerp(frontZ0, frontZ1, u) + Math.sin(u * Math.PI) * curveLead;
    const trailZ = THREE.MathUtils.lerp(backZ0, backZ1, u) + Math.sin(u * Math.PI) * curveTrail;
    const x = u * lenX;
    const z = THREE.MathUtils.lerp(leadZ, trailZ, v);
    // Airfoil NACA-like thickness profile: rounded nose (v≈0.25), sleek razor trailing edge
    const airfoil = Math.sin(Math.pow(v, 0.58) * Math.PI);
    const maxT = THREE.MathUtils.lerp(thick0, thick1, u);
    const camber = Math.sin(v * Math.PI) * maxT * 0.35;
    const rayRipple = v > 0.65 ? Math.sin(u * Math.PI * 14.0) * 0.004 * (v - 0.65) : 0;
    return {
      x,
      y: camber + rayRipple,
      z,
      halfThick: airfoil * maxT * 0.5,
    };
  });
  applyVertexColors(geo, (_x, y) => {
    const v = y >= 0 ? 0.84 : 1.14;
    return [v, v, v * 1.02];
  });
  return geo;
}

function buildCephalicLobe(): THREE.BufferGeometry {
  // Gracefully curled spoon-like manta cephalic feeding horn extending forward +Z
  return buildTaperedCurveTube(
    [
      new THREE.Vector3(0.0, 0.0, 0.0),
      new THREE.Vector3(0.02, -0.01, 0.12),
      new THREE.Vector3(0.01, 0.01, 0.24),
      new THREE.Vector3(-0.04, 0.03, 0.34),
    ],
    14,
    10,
    (t, ang) => {
      const base = (1.0 - t * 0.72) * 0.055;
      // Slightly flattened ribbon-like horn cross section
      return base * (0.7 + 0.45 * Math.abs(Math.sin(ang)));
    }
  );
}

function buildMedusaBell(): THREE.BufferGeometry {
  // High-res 28-station x 64-radial double-walled sculpted jellyfish bell with 16 lappets & radial canals
  const pts: THREE.Vector2[] = [];
  const outerSteps = 20;
  for (let i = 0; i <= outerSteps; i++) {
    const t = i / outerSteps; // 0 apex -> 1 rim
    const ang = t * Math.PI * 0.58;
    const r = Math.sin(ang) * 0.54 + 0.004;
    const y = Math.cos(ang) * 0.48;
    pts.push(new THREE.Vector2(r, y));
  }
  // Gently curled translucent rim + inner subumbrella wall for realistic glass/jelly thickness
  pts.push(new THREE.Vector2(0.51, -0.14));
  pts.push(new THREE.Vector2(0.45, -0.09));
  pts.push(new THREE.Vector2(0.39, 0.06));
  pts.push(new THREE.Vector2(0.28, 0.24));
  pts.push(new THREE.Vector2(0.12, 0.34));
  pts.push(new THREE.Vector2(0.005, 0.36));

  const geo = new THREE.LatheGeometry(pts, 64);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    let y = pos.getY(i);
    const z = pos.getZ(i);
    const ang = Math.atan2(z, x);
    const rimFactor = Math.max(0, 1.0 - (y + 0.16) / 0.62);
    // 16 marginal lappets + 8 prominent radial canal ribs
    const lappet = 1.0 + Math.sin(ang * 16.0) * 0.042 * Math.pow(rimFactor, 1.3);
    const canal = 1.0 + Math.cos(ang * 8.0) * 0.032 * (0.3 + 0.7 * rimFactor);
    y -= Math.sin(ang * 16.0) * 0.024 * Math.pow(rimFactor, 2.0);
    pos.setXYZ(i, x * lappet * canal, y, z * lappet * canal);
  }
  geo.rotateX(Math.PI * 0.5); // Apex points +Z
  geo.computeVertexNormals();
  applyVertexColors(geo, (_x, _y, z) => {
    const rim = THREE.MathUtils.clamp((0.48 - z) / 0.64, 0, 1);
    const v = THREE.MathUtils.lerp(0.84, 1.16, rim);
    return [v * 0.98, v * 1.02, v * 1.08];
  });
  return geo;
}

function buildMedusaManubrium(): THREE.BufferGeometry {
  const pts = [
    new THREE.Vector2(0.008, -0.22),
    new THREE.Vector2(0.095, -0.14),
    new THREE.Vector2(0.165, -0.02),
    new THREE.Vector2(0.185, 0.11),
    new THREE.Vector2(0.125, 0.21),
    new THREE.Vector2(0.010, 0.25),
  ];
  const geo = new THREE.LatheGeometry(pts, 32);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const ang = Math.atan2(z, x);
    const lobe = 1.0 + Math.cos(ang * 4.0) * 0.22 + Math.sin(ang * 8.0 + y * 12.0) * 0.07;
    pos.setXYZ(i, x * lobe, y, z * lobe);
  }
  geo.rotateX(Math.PI * 0.5);
  geo.computeVertexNormals();
  return geo;
}

function buildMedusaGonad(): THREE.BufferGeometry {
  // Horseshoe-shaped glowing internal gonad lobe
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-0.075, -0.04, 0),
    new THREE.Vector3(-0.085, 0.03, 0.02),
    new THREE.Vector3(0.0, 0.085, 0.04),
    new THREE.Vector3(0.085, 0.03, 0.02),
    new THREE.Vector3(0.075, -0.04, 0),
  ]);
  return new THREE.TubeGeometry(curve, 16, 0.026, 8, false);
}

function buildOralArm(): THREE.BufferGeometry {
  // High-res lacy, double-ruffled spiral curtain oral arm extending along -Z
  const geo = new THREE.PlaneGeometry(0.18, 0.86, 6, 30);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const t = THREE.MathUtils.clamp((0.43 - y) / 0.86, 0, 1); // 0 root -> 1 tip
    const edgeFactor = Math.abs(x) / 0.09; // 0 midrib -> 1 lacy edge
    const taper = 1.0 - Math.pow(t, 1.2) * 0.74;
    const twist = t * Math.PI * 2.2;
    const ruffle = Math.sin(t * Math.PI * 11.0 + Math.sign(x) * 1.2) * 0.038 * edgeFactor * taper;
    const baseW = x * taper;
    const rx = baseW * Math.cos(twist) - ruffle * Math.sin(twist) + Math.sin(t * Math.PI * 3.0) * 0.035;
    const rz = baseW * Math.sin(twist) + ruffle * Math.cos(twist) + Math.cos(t * Math.PI * 3.0) * 0.025;
    pos.setXYZ(i, rx, y, rz);
  }
  geo.translate(0, -0.43, 0);
  geo.rotateX(Math.PI * 0.5); // Extends along -Z
  geo.computeVertexNormals();
  return geo;
}

function buildEelHead(): THREE.BufferGeometry {
  const stations = 22;
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i <= stations; i++) {
    const t = i / stations;
    const z = -0.24 + t * 0.66;
    const r = Math.sin(Math.pow(t, 0.68) * Math.PI) * 0.205 + 0.008;
    pts.push(new THREE.Vector2(r, z));
  }
  const geo = new THREE.LatheGeometry(pts, 34);
  geo.rotateX(Math.PI * 0.5);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    let x = pos.getX(i);
    let y = pos.getY(i);
    const z = pos.getZ(i);
    const t = (z + 0.24) / 0.66;
    x *= 0.92;
    y *= 0.82;
    // Prominent supraorbital brow ridges above eyes
    const brow = Math.exp(-Math.pow((t - 0.64) / 0.14, 2)) * Math.exp(-Math.pow((Math.abs(x) - 0.11) / 0.06, 2));
    if (y > 0) y += brow * 0.048;
    // Tubular anterior moray nostrils near snout tip
    const nostril =
      Math.exp(-Math.pow((t - 0.88) / 0.045, 2)) *
      Math.exp(-Math.pow((Math.abs(x) - 0.052) / 0.024, 2));
    if (y > 0) y += nostril * 0.028;
    // Recessed mouth cavity underside so articulated lower jaw fits cleanly
    if (t > 0.55 && y < -0.02) {
      y *= 0.48;
    }
    // Slight gill cheek flare at rear of head
    const gill = Math.exp(-Math.pow((t - 0.22) / 0.14, 2)) * 0.028;
    x += Math.sign(x) * gill;
    pos.setXYZ(i, x, y, z);
  }
  geo.computeVertexNormals();
  applyVertexColors(geo, (_x, y, z) => {
    const t = THREE.MathUtils.clamp((z + 0.24) / 0.66, 0, 1);
    const mouthAO = t > 0.55 && y < -0.02 ? 0.58 : 1.0;
    const dorsal = THREE.MathUtils.clamp((y + 0.16) / 0.34, 0, 1);
    const s = THREE.MathUtils.lerp(1.08, 0.78, dorsal) * mouthAO;
    return [s, s, s * 1.02];
  });
  return geo;
}

function buildEelFangs(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const count = 11;
  for (let i = 0; i < count; i++) {
    const frac = (i / (count - 1)) * 2 - 1;
    const ang = frac * 1.28;
    const x = Math.sin(ang) * 0.056;
    const z = Math.cos(ang) * 0.14 - 0.02;
    const h = 0.052 * (1.0 - Math.abs(frac) * 0.35) * (i % 2 === 0 ? 1.15 : 0.78);
    const fang = new THREE.ConeGeometry(0.0062, h, 6, 1);
    fang.translate(0, h * 0.5, 0);
    fang.rotateX(-0.34);
    fang.translate(x, 0, z);
    parts.push(fang);
  }
  return mergeGeometriesSimple(parts);
}

function buildEelLowerJaw(): THREE.BufferGeometry {
  return buildTaperedCurveTube(
    [
      new THREE.Vector3(0, -0.02, 0.0),
      new THREE.Vector3(0, -0.04, 0.12),
      new THREE.Vector3(0, -0.03, 0.25),
      new THREE.Vector3(0, 0.0, 0.34),
    ],
    12,
    12,
    (t, ang) => {
      const r = (1.0 - t * 0.62) * 0.082;
      return r * (0.65 + 0.5 * Math.abs(Math.cos(ang)));
    }
  );
}

function buildEelSegment(): THREE.BufferGeometry {
  // Smooth overlapping muscular myomere trunk segment with subtle dorsal keel (no beaded spheres!)
  const stations = 18;
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i <= stations; i++) {
    const t = i / stations;
    const z = -0.28 + t * 0.56;
    // Fuller overlap cylinder with rounded tapering ends
    const r = Math.pow(Math.max(0, Math.sin(t * Math.PI)), 0.58) * 0.215 + 0.01;
    pts.push(new THREE.Vector2(r, z));
  }
  const geo = new THREE.LatheGeometry(pts, 30);
  geo.rotateX(Math.PI * 0.5);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    let x = pos.getX(i);
    let y = pos.getY(i);
    const z = pos.getZ(i);
    x *= 0.78;
    y *= 1.04;
    const ang = Math.atan2(y, x);
    // Subtle dorsal ridge
    y += Math.pow(Math.max(0, Math.sin(ang)), 5) * 0.028;
    // Subtle chevron myomere muscle relief
    x += Math.sign(x) * Math.sin(z * 18.0 - Math.abs(y) * 8.0) * 0.004 * Math.abs(Math.cos(ang));
    pos.setXYZ(i, x, y, z);
  }
  geo.computeVertexNormals();
  applyVertexColors(geo, (_x, y) => {
    const dorsal = THREE.MathUtils.clamp((y + 0.20) / 0.42, 0, 1);
    const s = THREE.MathUtils.lerp(1.10, 0.78, dorsal);
    return [s, s, s * 1.02];
  });
  return geo;
}

function buildEelTail(): THREE.BufferGeometry {
  // Ribbon-like undulating serpentine caudal fin blade
  const fin = buildHydrofoilPanel(18, 14, (u, v) => {
    const sv = (v - 0.5) * 2.0; // -1..1
    const z = -u * 0.72;
    const h = Math.sin(Math.pow(u, 0.6) * Math.PI) * 0.24 * sv;
    const wave = Math.sin(u * Math.PI * 3.0) * 0.014;
    const thick = (1.0 - u * 0.85) * 0.014 * (1.0 - Math.abs(sv) * 0.7);
    return { x: h, y: wave, z, halfThick: thick };
  });
  fin.rotateZ(Math.PI * 0.5);
  fin.computeVertexNormals();
  return fin;
}

function buildTrilopodCephalon(): THREE.BufferGeometry {
  // Sculpted trilobite/isopod head shield: rounded crescent brow, central glabella dome, swept genal spines
  const geo = new THREE.SphereGeometry(0.48, 36, 22, 0, Math.PI * 2, 0, Math.PI * 0.54);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    let x = pos.getX(i);
    let y = pos.getY(i);
    let z = pos.getZ(i);

    x *= 1.16;
    y *= 0.54;
    z *= 0.86;

    // Prominent raised central axial glabella ridge
    const glabella = Math.exp(-Math.pow(x / 0.16, 2)) * 0.088;
    const glabellaLobes = Math.exp(-Math.pow(x / 0.14, 2)) * Math.sin(z * 22.0) * 0.011;
    // Furrows flanking the glabella
    const furrow = Math.exp(-Math.pow((Math.abs(x) - 0.19) / 0.052, 2)) * 0.038;
    const rimDist = Math.hypot(x / 0.54, z / 0.40);
    const brim = Math.exp(-Math.pow((rimDist - 0.92) / 0.09, 2)) * 0.024;
    y += glabella + glabellaLobes - furrow + brim;

    // Swept-back lateral genal cheek spines at rear corners (z < 0, |x| large)
    if (z < 0.05 && Math.abs(x) > 0.28) {
      const corner = Math.max(0, (Math.abs(x) - 0.28) / 0.28) * Math.max(0, (0.05 - z) / 0.45);
      z -= corner * 0.26;
      x += Math.sign(x) * corner * 0.06;
    }

    pos.setXYZ(i, x, y, z);
  }
  geo.computeVertexNormals();
  applyVertexColors(geo, (x, y) => {
    const furrowAO = 1.0 - Math.exp(-Math.pow((Math.abs(x) - 0.19) / 0.06, 2)) * 0.24;
    const crest = THREE.MathUtils.clamp(y / 0.30, 0, 1);
    const s = (0.82 + crest * 0.28) * furrowAO;
    return [s, s * 1.01, s * 1.03];
  });
  return geo;
}

function buildTrilopodPlate(): THREE.BufferGeometry {
  // High-res 3-lobed thoracic tergite carapace (raised axial lobe + furrowed pleural ribs + recurved side tips)
  const geo = new THREE.SphereGeometry(0.48, 36, 20, 0, Math.PI * 2, 0, Math.PI * 0.52);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    let x = pos.getX(i);
    let y = pos.getY(i);
    let z = pos.getZ(i);

    x *= 1.14;
    y *= 0.48;
    z *= 0.64;

    // Classic trilobed silhouette: central axial dome + axial furrows + arched pleural ribs
    const axial = Math.exp(-Math.pow(x / 0.14, 2)) * 0.086;
    const axialNode = Math.exp(-Math.pow(x / 0.05, 2)) * Math.exp(-Math.pow(z / 0.08, 2)) * 0.024;
    const furrow = Math.exp(-Math.pow((Math.abs(x) - 0.18) / 0.05, 2)) * 0.038;
    const pleuralRib = Math.exp(-Math.pow((Math.abs(x) - 0.34) / 0.12, 2)) * 0.028 * Math.cos(z * 12.0);
    y += axial + axialNode - furrow + pleuralRib;

    // Recurved protective lateral pleural tips swept slightly backward
    const edgeSweep = Math.pow(Math.max(0, Math.abs(x) - 0.28) / 0.28, 1.6);
    z -= edgeSweep * 0.14;

    pos.setXYZ(i, x, y, z);
  }
  geo.computeVertexNormals();
  applyVertexColors(geo, (x, y) => {
    const furrowAO = 1.0 - Math.exp(-Math.pow((Math.abs(x) - 0.18) / 0.06, 2)) * 0.25;
    const s = (0.80 + THREE.MathUtils.clamp(y / 0.28, 0, 1) * 0.30) * furrowAO;
    return [s, s * 1.01, s * 1.03];
  });
  return geo;
}

function buildTrilopodSternum(): THREE.BufferGeometry {
  const geo = new THREE.SphereGeometry(0.42, 20, 12, 0, Math.PI * 2, Math.PI * 0.5, Math.PI * 0.5);
  geo.scale(0.95, 0.26, 0.58);
  geo.computeVertexNormals();
  return geo;
}

function buildTrilopodCompoundEye(): THREE.BufferGeometry {
  const geo = new THREE.SphereGeometry(0.085, 18, 12, 0, Math.PI, 0, Math.PI);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) * 0.62;
    const y = pos.getY(i) * 0.72;
    const z = pos.getZ(i) * 1.38;
    pos.setXYZ(i, x, y, z);
  }
  geo.computeVertexNormals();
  return geo;
}

function buildTrilopodTailFan(): THREE.BufferGeometry {
  // Flared fluted uropod tail fan blade extending along -Z
  return buildHydrofoilPanel(14, 14, (u, v) => {
    const sv = (v - 0.5) * 2.0; // -1..1
    const z = -u * 0.36;
    const width = 0.07 + Math.sin(Math.pow(u, 0.72) * Math.PI * 0.85) * 0.22;
    const x = sv * width;
    const flute = Math.sin(v * Math.PI * 10) * 0.008 * u;
    const arch = (1.0 - sv * sv) * 0.022 * u;
    const halfThick = (1.0 - u * 0.8) * 0.012;
    return { x, y: arch + flute, z, halfThick };
  });
}

function buildCurvedMandible(): THREE.BufferGeometry {
  // High-res curved raptorial chitin pincer with sculpted inner serrated teeth
  return buildTaperedCurveTube(
    [
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0.085, 0.0, 0.12),
      new THREE.Vector3(0.065, -0.01, 0.25),
      new THREE.Vector3(-0.01, -0.018, 0.35),
      new THREE.Vector3(-0.065, -0.022, 0.40),
    ],
    22,
    10,
    (t, ang) => {
      const base = (1.0 - t * 0.82) * 0.038;
      // Serrated inner cutting teeth facing inward
      const innerFace = Math.max(0, Math.cos(ang));
      const teeth = t > 0.22 && t < 0.84 ? Math.pow(Math.max(0, Math.sin(t * Math.PI * 9)), 4) * 0.018 * innerFace : 0;
      return base + teeth;
    }
  );
}

function buildTaperedTentacle(): THREE.BufferGeometry {
  // Gracefully sinuous smooth tapering trailing tentacle extending along -Z
  return buildTaperedCurveTube(
    [
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0.018, 0.012, -0.22),
      new THREE.Vector3(-0.022, -0.014, -0.48),
      new THREE.Vector3(0.015, 0.008, -0.74),
      new THREE.Vector3(0, 0, -0.94),
    ],
    20,
    10,
    (t) => {
      const base = Math.pow(1.0 - t, 0.85) * 0.032 + 0.003;
      // Subtle nematocyst bead swellings along tentacle
      const bead = 1.0 + Math.pow(Math.max(0, Math.sin(t * Math.PI * 12)), 4) * 0.26 * (1.0 - t * 0.4);
      return base * bead;
    }
  );
}

function buildCurvedAntenna(): THREE.BufferGeometry {
  // Sweeping gracefully arched sensory whisker/antenna extending forward +Z
  return buildTaperedCurveTube(
    [
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0.02, 0.04, 0.16),
      new THREE.Vector3(0.06, 0.06, 0.36),
      new THREE.Vector3(0.11, 0.03, 0.58),
    ],
    16,
    8,
    (t) => Math.pow(1.0 - t, 0.9) * 0.019 + 0.002
  );
}

function buildSpineHorn(): THREE.BufferGeometry {
  // Curved longitudinally fluted venomous dorsal spine pointing +Y / slightly swept -Z
  return buildTaperedCurveTube(
    [
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0, 0.12, -0.02),
      new THREE.Vector3(0, 0.25, -0.07),
      new THREE.Vector3(0, 0.38, -0.15),
    ],
    14,
    12,
    (t, ang) => {
      const base = Math.pow(1.0 - t, 0.88) * 0.048 + 0.002;
      const flute = 1.0 + Math.sin(ang * 5.0) * 0.12 * (1.0 - t * 0.5);
      return base * flute;
    }
  );
}

function buildEyeGlobe(): THREE.BufferGeometry {
  // High-res eyeball with planar front-projected iris UVs on the +Z hemisphere (zero pole distortion!)
  const geo = new THREE.SphereGeometry(0.076, 24, 18);
  const pos = geo.attributes.position;
  const uv = geo.attributes.uv;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    // Project front (+Z) onto iris texture centered at (0.5, 0.5)
    if (z >= -0.015) {
      const u = 0.5 + (x / 0.078) * 0.48;
      const v = 0.5 + (y / 0.078) * 0.48;
      uv.setXY(i, THREE.MathUtils.clamp(u, 0.02, 0.98), THREE.MathUtils.clamp(v, 0.02, 0.98));
    } else {
      // Back of eyeball maps to dark sclera rim edge
      uv.setXY(i, 0.03, 0.03);
    }
  }
  uv.needsUpdate = true;
  return geo;
}

function buildEyeSocket(): THREE.BufferGeometry {
  // Sculpted anatomical fleshy orbital rim with overhanging protective upper brow hood
  const geo = new THREE.TorusGeometry(0.080, 0.026, 14, 28);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) * 1.08;
    let y = pos.getY(i) * 0.98;
    let z = pos.getZ(i) * 0.78;
    if (y > 0.02) {
      z += (y - 0.02) * 0.36;
      y += (y - 0.02) * 0.10;
    }
    pos.setXYZ(i, x, y, z);
  }
  geo.computeVertexNormals();
  return geo;
}

function buildEyeCornea(): THREE.BufferGeometry {
  const geo = new THREE.SphereGeometry(0.084, 28, 20);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    let z = pos.getZ(i);
    if (z > 0) z *= 1.14;
    pos.setXYZ(i, x, y, z);
  }
  geo.computeVertexNormals();
  return geo;
}

function buildLureStem(): THREE.BufferGeometry {
  return buildTaperedCurveTube(
    [
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0, 0.14, 0.04),
      new THREE.Vector3(0, 0.28, 0.14),
      new THREE.Vector3(0, 0.30, 0.29),
      new THREE.Vector3(0, 0.20, 0.40),
    ],
    20,
    8,
    (t) => 0.018 * (1.0 - t * 0.45)
  );
}

function buildLureBulb(): THREE.BufferGeometry {
  // Teardrop bioluminescent angler esca bulb
  const pts = [
    new THREE.Vector2(0.004, -0.095),
    new THREE.Vector2(0.045, -0.065),
    new THREE.Vector2(0.078, -0.015),
    new THREE.Vector2(0.074, 0.04),
    new THREE.Vector2(0.042, 0.082),
    new THREE.Vector2(0.005, 0.105),
  ];
  const geo = new THREE.LatheGeometry(pts, 20);
  geo.computeVertexNormals();
  return geo;
}

function buildLureFilament(): THREE.BufferGeometry {
  return buildTaperedCurveTube(
    [
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0.025, -0.06, 0.02),
      new THREE.Vector3(-0.015, -0.14, 0.03),
      new THREE.Vector3(0.01, -0.22, 0.01),
    ],
    12,
    6,
    (t) => (1.0 - t * 0.8) * 0.009
  );
}

function buildLegUpper(): THREE.BufferGeometry {
  // Sculpted arthropod femur segment with joint condyle swellings
  const pts = [
    new THREE.Vector2(0.024, 0.0),
    new THREE.Vector2(0.034, -0.04),
    new THREE.Vector2(0.030, -0.13),
    new THREE.Vector2(0.024, -0.22),
    new THREE.Vector2(0.028, -0.26),
  ];
  const geo = new THREE.LatheGeometry(pts, 12);
  geo.computeVertexNormals();
  return geo;
}

function buildLegLower(): THREE.BufferGeometry {
  // Curved tapering tibia + pointed dactyl claw
  return buildTaperedCurveTube(
    [
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0.018, -0.08, 0.0),
      new THREE.Vector3(0.022, -0.17, -0.01),
      new THREE.Vector3(0.006, -0.25, -0.02),
    ],
    12,
    10,
    (t) => Math.pow(1.0 - t, 0.82) * 0.024 + 0.002
  );
}

// ============================================================================
// FLORA GEOMETRIES (HIGH-RESOLUTION BOTANICAL SCULPTING)
// ============================================================================

function buildHoldfastRoot(): THREE.BufferGeometry {
  // Gnarled multi-tendril haptera holdfast gripping the seabed (replaces 7-sided cone!)
  const stations = 14;
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i <= stations; i++) {
    const t = i / stations; // 0 seabed base -> 1 stem collar
    const y = t * 0.24;
    const r = 0.34 * Math.pow(1.0 - t, 1.25) + 0.065;
    pts.push(new THREE.Vector2(r, y));
  }
  const geo = new THREE.LatheGeometry(pts, 36);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    let y = pos.getY(i);
    const z = pos.getZ(i);
    const ang = Math.atan2(z, x);
    const baseFactor = Math.max(0, 1.0 - y / 0.24);
    // 7 organic gnarled spreading root buttresses with subtle twist
    const twist = ang + y * 2.4;
    const rootLobe = 1.0 + Math.pow(0.5 + 0.5 * Math.sin(twist * 7.0), 1.6) * 0.58 * baseFactor;
    const gnarl = 1.0 + Math.sin(ang * 13.0 + y * 14.0) * 0.08 * baseFactor;
    y += Math.max(0, Math.sin(twist * 7.0)) * 0.032 * baseFactor * (1.0 - baseFactor * 0.6);
    pos.setXYZ(i, x * rootLobe * gnarl, y, z * rootLobe * gnarl);
  }
  geo.computeVertexNormals();
  return geo;
}

function buildKelpStipe(): THREE.BufferGeometry {
  // Gracefully sinuous flexible kelp stalk
  return buildTaperedCurveTube(
    [
      new THREE.Vector3(0, 0.0, 0),
      new THREE.Vector3(0.04, 0.22, 0.02),
      new THREE.Vector3(-0.03, 0.46, 0.04),
      new THREE.Vector3(0.02, 0.68, -0.02),
    ],
    16,
    10,
    (t) => 0.032 * (1.0 - t * 0.42) + Math.sin(t * Math.PI * 5) * 0.003
  );
}

function buildKelpBlade(): THREE.BufferGeometry {
  // Ultra-high-res 16x40 bull-kelp lamina with puckered bullations, raised midrib & wavy ruffled edges
  const geo = new THREE.PlaneGeometry(0.25, 0.86, 16, 40);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const t = THREE.MathUtils.clamp((y + 0.42) / 0.84, 0, 1); // 0 base -> 1 tapered tip
    const uNorm = x / 0.12; // -1..1 across blade width
    const edgeAbs = Math.abs(uNorm);

    // Botanical lanceolate silhouette (widest at 35% height, graceful acute tip)
    const widthCurve = Math.sin(Math.pow(t, 0.68) * Math.PI) * 1.18 + 0.04 * (1 - t);
    // Subtle serrated leaf margin
    const serration = 1.0 + Math.sin(t * Math.PI * 16.0) * 0.075 * edgeAbs * Math.sin(t * Math.PI);

    // Organic longitudinal arch + prominent ruffled edges + bull-kelp bullation blisters + midrib
    const archZ = Math.sin(t * Math.PI * 1.15) * 0.095;
    const edgeRuffle = Math.sin(t * Math.PI * 7.5 + (uNorm > 0 ? 0.6 : -0.6)) * 0.052 * Math.pow(edgeAbs, 1.5) * Math.sin(t * Math.PI);
    const bullations = Math.sin(t * Math.PI * 18.0) * Math.cos(uNorm * Math.PI * 3.0) * 0.008 * Math.sin(t * Math.PI);
    const midrib = Math.exp(-Math.pow(uNorm / 0.22, 2)) * 0.019 * (1.0 - t * 0.6);
    const cup = edgeAbs * edgeAbs * 0.024;

    pos.setXYZ(i, x * widthCurve * serration, y + 0.43, archZ + edgeRuffle + bullations + midrib - cup);
  }
  geo.computeVertexNormals();
  applyVertexColors(geo, (x, y) => {
    const t = THREE.MathUtils.clamp(y / 0.86, 0, 1);
    const edge = THREE.MathUtils.clamp(Math.abs(x) / 0.13, 0, 1);
    const baseToTip = THREE.MathUtils.lerp(0.72, 1.16, t);
    const edgeTrans = THREE.MathUtils.lerp(0.92, 1.12, edge);
    return [baseToTip * edgeTrans * 0.98, baseToTip * edgeTrans * 1.03, baseToTip * edgeTrans * 0.96];
  });
  return geo;
}

function buildKelpBladder(): THREE.BufferGeometry {
  // Smooth teardrop pneumatocyst float bladder
  const pts = [
    new THREE.Vector2(0.012, 0.0),
    new THREE.Vector2(0.026, 0.025),
    new THREE.Vector2(0.056, 0.075),
    new THREE.Vector2(0.062, 0.125),
    new THREE.Vector2(0.045, 0.165),
    new THREE.Vector2(0.016, 0.188),
    new THREE.Vector2(0.002, 0.195),
  ];
  const geo = new THREE.LatheGeometry(pts, 18);
  geo.computeVertexNormals();
  return geo;
}

function buildCoralBranch(): THREE.BufferGeometry {
  // Organically gnarled curved calcareous staghorn/gorgonian branch with growth rings
  return buildTaperedCurveTube(
    [
      new THREE.Vector3(0, 0.0, 0),
      new THREE.Vector3(0.032, 0.16, 0.018),
      new THREE.Vector3(0.012, 0.35, -0.022),
      new THREE.Vector3(0.042, 0.54, 0.012),
    ],
    18,
    14,
    (t, ang) => {
      const base = 0.064 * (1.0 - t * 0.56);
      const rings = 1.0 + Math.sin(t * Math.PI * 10.0) * 0.09;
      const bumps = 1.0 + Math.sin(ang * 5.0 + t * 18.0) * 0.08;
      return base * rings * bumps;
    }
  );
}

function buildCoralPolypCup(): THREE.BufferGeometry {
  // Sculpted miniature star-crowned coral polyp: cupped calyx flaring into an 8-pointed tentacle crown!
  const pts = [
    new THREE.Vector2(0.018, 0.0),
    new THREE.Vector2(0.034, 0.025),
    new THREE.Vector2(0.044, 0.058),
    new THREE.Vector2(0.068, 0.085),
    new THREE.Vector2(0.088, 0.102),
    new THREE.Vector2(0.052, 0.095),
    new THREE.Vector2(0.024, 0.072),
    new THREE.Vector2(0.004, 0.062),
  ];
  const geo = new THREE.LatheGeometry(pts, 32);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    let y = pos.getY(i);
    const z = pos.getZ(i);
    const ang = Math.atan2(z, x);
    const r = Math.hypot(x, z);
    const crownFactor = Math.max(0, (y - 0.055) / 0.05);
    // 8 distinct radial star-polyp petal lobes
    const star = 1.0 + Math.pow(0.5 + 0.5 * Math.sin(ang * 10.0), 1.4) * 0.58 * crownFactor;
    y += Math.sin(ang * 10.0) * 0.018 * crownFactor * Math.min(1, r / 0.05);
    pos.setXYZ(i, x * star, y, z * star);
  }
  geo.computeVertexNormals();
  applyVertexColors(geo, (x, y, z) => {
    const r = Math.hypot(x, z);
    const tip = THREE.MathUtils.clamp((y + r * 0.5) / 0.14, 0, 1);
    const s = THREE.MathUtils.lerp(0.68, 1.18, tip);
    return [s, s * 1.02, s * 1.04];
  });
  return geo;
}

function buildBulbStem(): THREE.BufferGeometry {
  // Gracefully arching botanical flower stalk
  return buildTaperedCurveTube(
    [
      new THREE.Vector3(0, 0.0, 0),
      new THREE.Vector3(0.03, 0.20, 0.01),
      new THREE.Vector3(0.08, 0.42, 0.0),
      new THREE.Vector3(0.04, 0.62, -0.01),
    ],
    18,
    12,
    (t) => 0.042 * (1.0 - t * 0.45) + Math.exp(-Math.pow((t - 0.95) / 0.08, 2)) * 0.018
  );
}

function buildBulbPod(): THREE.BufferGeometry {
  // 22-station x 36-radial deeply fluted translucent bioluminescent lantern calyx
  const stations = 22;
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i <= stations; i++) {
    const t = i / stations;
    const y = t * 0.58;
    // Graceful lantern profile: narrow neck -> plump bulbous belly -> pointed bud crown
    const r = Math.sin(Math.pow(t, 0.72) * Math.PI) * 0.255 + 0.025 * (1 - t);
    pts.push(new THREE.Vector2(Math.max(0.004, r), y));
  }
  const geo = new THREE.LatheGeometry(pts, 36);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const t = y / 0.58;
    const ang = Math.atan2(z, x);
    // 8 prominent sculptural lantern ribs with slight organic helical twist
    const rib = 1.0 + Math.sin(ang * 8.0 + t * 1.1) * 0.125 * Math.sin(t * Math.PI);
    pos.setXYZ(i, x * rib, y, z * rib);
  }
  geo.computeVertexNormals();
  return geo;
}

function buildBulbInnerCore(): THREE.BufferGeometry {
  // Glowing internal stamen/seed nucleus suspended inside the translucent bulb lantern
  const pts = [
    new THREE.Vector2(0.01, 0.04),
    new THREE.Vector2(0.065, 0.14),
    new THREE.Vector2(0.095, 0.26),
    new THREE.Vector2(0.072, 0.38),
    new THREE.Vector2(0.022, 0.46),
    new THREE.Vector2(0.003, 0.49),
  ];
  const geo = new THREE.LatheGeometry(pts, 20);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const ang = Math.atan2(z, x);
    const lobe = 1.0 + Math.sin(ang * 5.0) * 0.18;
    pos.setXYZ(i, x * lobe, y, z * lobe);
  }
  geo.computeVertexNormals();
  return geo;
}

function buildBulbPetal(): THREE.BufferGeometry {
  // High-res 14x26 deeply cupped, gracefully recurved veined petal/sepal
  const geo = new THREE.PlaneGeometry(0.23, 0.48, 14, 26);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const t = THREE.MathUtils.clamp((y + 0.23) / 0.46, 0, 1); // 0 base -> 1 tip
    const uNorm = x / 0.11; // -1..1
    const widthProfile = Math.sin(Math.pow(t, 0.65) * Math.PI) * 1.12 + 0.08 * (1 - t);
    // Cupped concave belly + graceful outward recurve at the petal tip
    const cupZ = (1.0 - uNorm * uNorm) * 0.055 * Math.sin(t * Math.PI);
    const recurveZ = Math.pow(t, 1.75) * 0.16 - Math.sin(t * Math.PI) * 0.06;
    const veinFlute = Math.cos(uNorm * Math.PI * 3.0) * 0.006 * Math.sin(t * Math.PI);
    pos.setXYZ(i, x * widthProfile, y + 0.24, cupZ - recurveZ + veinFlute);
  }
  geo.computeVertexNormals();
  applyVertexColors(geo, (_x, y) => {
    const t = THREE.MathUtils.clamp(y / 0.48, 0, 1);
    const s = THREE.MathUtils.lerp(0.74, 1.18, t);
    return [s, s * 1.02, s * 1.06];
  });
  return geo;
}

function buildBulbStamen(): THREE.BufferGeometry {
  return buildTaperedCurveTube(
    [
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0.03, 0.12, 0.01),
      new THREE.Vector3(0.08, 0.24, 0.0),
      new THREE.Vector3(0.11, 0.34, -0.01),
    ],
    12,
    8,
    (t) => {
      const anther = Math.exp(-Math.pow((t - 0.94) / 0.09, 2)) * 0.018;
      return 0.0075 * (1.0 - t * 0.3) + anther;
    }
  );
}

function buildSporeStalk(): THREE.BufferGeometry {
  // Gracefully curved fibrous hollow mushroom stipe with swollen basal bulb
  return buildTaperedCurveTube(
    [
      new THREE.Vector3(0, 0.0, 0),
      new THREE.Vector3(0.025, 0.22, 0.015),
      new THREE.Vector3(0.045, 0.48, -0.01),
      new THREE.Vector3(0.015, 0.74, 0.0),
    ],
    20,
    16,
    (t, ang) => {
      const baseBulb = Math.exp(-Math.pow(t / 0.22, 2)) * 0.032;
      const body = 0.042 * (1.0 - t * 0.35) + baseBulb;
      const fiber = 1.0 + Math.sin(ang * 10.0) * 0.05;
      return body * fiber;
    }
  );
}

function buildSporeAnnulus(): THREE.BufferGeometry {
  // Delicate lacy fungal veil ring skirt around the upper stalk
  const pts = [
    new THREE.Vector2(0.032, 0.05),
    new THREE.Vector2(0.065, 0.03),
    new THREE.Vector2(0.095, -0.01),
    new THREE.Vector2(0.112, -0.045),
  ];
  const geo = new THREE.LatheGeometry(pts, 28);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    let y = pos.getY(i);
    const z = pos.getZ(i);
    const ang = Math.atan2(z, x);
    const r = Math.hypot(x, z);
    const ruffle = Math.sin(ang * 12.0) * 0.014 * Math.max(0, (r - 0.035) / 0.08);
    y += ruffle;
    pos.setXYZ(i, x, y, z);
  }
  geo.computeVertexNormals();
  return geo;
}

function buildSporeCap(): THREE.BufferGeometry {
  // High-res 22-station x 56-radial pleated translucent umbrella mushroom cap with wavy scalloped margin
  const pts: THREE.Vector2[] = [];
  const steps = 20;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const r = Math.pow(t, 0.85) * 0.38 + 0.004;
    // Graceful campanulate / umbonate mushroom dome with slight central peak (umbo)
    const umbo = Math.exp(-Math.pow(t / 0.22, 2)) * 0.042;
    const dome = Math.cos(t * Math.PI * 0.56) * 0.22 + umbo;
    pts.push(new THREE.Vector2(r, dome));
  }
  // Curled cap margin
  pts.push(new THREE.Vector2(0.37, -0.048));
  pts.push(new THREE.Vector2(0.32, -0.042));

  const geo = new THREE.LatheGeometry(pts, 56);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    let y = pos.getY(i);
    const z = pos.getZ(i);
    const ang = Math.atan2(z, x);
    const r = Math.hypot(x, z);
    const rNorm = Math.min(1, r / 0.38);
    // 24 delicate translucent radial cap striations + 7 organic margin undulations
    const pleat = Math.sin(ang * 24.0) * 0.0085 * rNorm * rNorm;
    const wave = Math.sin(ang * 7.0) * 0.022 * Math.pow(rNorm, 2.2);
    const flare = 1.0 + Math.cos(ang * 7.0) * 0.045 * Math.pow(rNorm, 2.0);
    y += pleat + wave;
    pos.setXYZ(i, x * flare, y, z * flare);
  }
  geo.computeVertexNormals();
  applyVertexColors(geo, (x, _y, z) => {
    const rNorm = THREE.MathUtils.clamp(Math.hypot(x, z) / 0.38, 0, 1);
    const s = THREE.MathUtils.lerp(0.76, 1.16, Math.pow(rNorm, 1.2));
    return [s, s * 1.02, s * 1.06];
  });
  return geo;
}

function buildSporeGills(): THREE.BufferGeometry {
  // Sculpted radial gill lamellae underside disc (48 fine pleats glowing beneath the cap)
  const pts = [
    new THREE.Vector2(0.032, -0.03),
    new THREE.Vector2(0.14, 0.01),
    new THREE.Vector2(0.26, -0.005),
    new THREE.Vector2(0.34, -0.036),
  ];
  const geo = new THREE.LatheGeometry(pts, 64);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    let y = pos.getY(i);
    const z = pos.getZ(i);
    const ang = Math.atan2(z, x);
    const r = Math.hypot(x, z);
    const gillBlade = Math.sin(ang * 32.0) * 0.015 * Math.min(1, r / 0.25);
    y -= gillBlade;
    pos.setXYZ(i, x, y, z);
  }
  geo.computeVertexNormals();
  return geo;
}

function buildAnemoneColumn(): THREE.BufferGeometry {
  // 22-station x 36-radial fleshy striated anemone body column with gripping pedal disc & verrucae bumps
  const pts: THREE.Vector2[] = [];
  const steps = 18;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const y = t * 0.42;
    // Flared basal pedal disc -> muscular waist -> flared parapet collar
    const baseFlare = Math.exp(-Math.pow(t / 0.22, 2)) * 0.14;
    const crownFlare = Math.pow(Math.max(0, (t - 0.55) / 0.45), 1.6) * 0.095;
    const r = 0.215 + baseFlare + crownFlare + Math.sin(t * Math.PI * 3.0) * 0.012;
    pts.push(new THREE.Vector2(r, y));
  }
  // Curved lip into oral cup
  pts.push(new THREE.Vector2(0.26, 0.435));
  pts.push(new THREE.Vector2(0.20, 0.40));
  pts.push(new THREE.Vector2(0.04, 0.365));

  const geo = new THREE.LatheGeometry(pts, 36);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const ang = Math.atan2(z, x);
    // Longitudinal muscular folds + subtle organic tubercles
    const fold = 1.0 + Math.sin(ang * 14.0) * 0.042 + Math.sin(ang * 7.0 + y * 24.0) * 0.026;
    pos.setXYZ(i, x * fold, y, z * fold);
  }
  geo.computeVertexNormals();
  applyVertexColors(geo, (_x, y) => {
    const t = THREE.MathUtils.clamp(y / 0.43, 0, 1);
    const s = THREE.MathUtils.lerp(0.72, 1.10, t);
    return [s, s * 0.99, s * 1.02];
  });
  return geo;
}

function buildAnemoneOralDisc(): THREE.BufferGeometry {
  // Radially furrowed glowing oral disc with central recessed mouth
  const pts = [
    new THREE.Vector2(0.01, -0.025),
    new THREE.Vector2(0.05, 0.008),
    new THREE.Vector2(0.14, 0.02),
    new THREE.Vector2(0.23, 0.012),
    new THREE.Vector2(0.25, -0.01),
  ];
  const geo = new THREE.LatheGeometry(pts, 32);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    let y = pos.getY(i);
    const z = pos.getZ(i);
    const ang = Math.atan2(z, x);
    const r = Math.hypot(x, z);
    y += Math.sin(ang * 16.0) * 0.009 * Math.min(1, r / 0.16);
    pos.setXYZ(i, x, y, z);
  }
  geo.computeVertexNormals();
  return geo;
}

function buildAnemoneTentacle(): THREE.BufferGeometry {
  // Gracefully curving, organically tapering fleshy anemone tentacle extending +Y with gentle outward arc
  const geo = buildTaperedCurveTube(
    [
      new THREE.Vector3(0, 0.0, 0),
      new THREE.Vector3(0.035, 0.22, 0.0),
      new THREE.Vector3(0.095, 0.46, 0.015),
      new THREE.Vector3(0.145, 0.70, -0.01),
    ],
    18,
    12,
    (t) => {
      const base = 0.044 * Math.pow(1.0 - t * 0.72, 0.85);
      // Slight contractile rings + swollen tip bulb (acrosphere)
      const rings = 1.0 + Math.sin(t * Math.PI * 12.0) * 0.055;
      const tipBulb = Math.exp(-Math.pow((t - 0.96) / 0.075, 2)) * 0.016;
      return base * rings + tipBulb;
    }
  );
  applyVertexColors(geo, (_x, y) => {
    const t = THREE.MathUtils.clamp(y / 0.70, 0, 1);
    const s = THREE.MathUtils.lerp(0.76, 1.22, Math.pow(t, 1.3));
    return [s, s * 1.02, s * 1.06];
  });
  return geo;
}

function buildEggEmbryo(): THREE.BufferGeometry {
  const body = buildTaperedCurveTube(
    [
      new THREE.Vector3(0.025, 0.028, 0.012),
      new THREE.Vector3(0.044, 0.002, 0.006),
      new THREE.Vector3(0.026, -0.036, -0.008),
      new THREE.Vector3(-0.024, -0.032, -0.010),
      new THREE.Vector3(-0.042, 0.008, 0.002),
      new THREE.Vector3(-0.018, 0.030, 0.010),
    ],
    20,
    10,
    (t) => {
      const head = Math.exp(-Math.pow(t / 0.24, 2)) * 0.022;
      const somite = 1.0 + Math.sin(t * Math.PI * 14.0) * 0.08;
      return (0.022 * Math.pow(1.0 - t * 0.78, 0.8) + head) * somite;
    }
  );
  const yolk = new THREE.SphereGeometry(0.034, 14, 10);
  yolk.translate(-0.004, -0.006, 0.0);
  return mergeGeometriesSimple([body, yolk]);
}

function buildSporePropagule(): THREE.BufferGeometry {
  // Ribbed winged marine seed/propagule
  const pts = [
    new THREE.Vector2(0.004, -0.11),
    new THREE.Vector2(0.065, -0.05),
    new THREE.Vector2(0.088, 0.01),
    new THREE.Vector2(0.062, 0.07),
    new THREE.Vector2(0.004, 0.12),
  ];
  const geo = new THREE.LatheGeometry(pts, 18);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const ang = Math.atan2(z, x);
    const wing = 1.0 + Math.pow(Math.max(0, Math.sin(ang * 3.0 + y * 8.0)), 2) * 0.35;
    pos.setXYZ(i, x * wing, y, z * wing);
  }
  geo.computeVertexNormals();
  return geo;
}


function buildFishLowerJaw(): THREE.BufferGeometry {
  // Sculpted articulated lower jaw extending forward along +Z from the cheek hinge
  return buildTaperedCurveTube(
    [
      new THREE.Vector3(0, 0.0, 0.0),
      new THREE.Vector3(0, -0.025, 0.09),
      new THREE.Vector3(0, -0.018, 0.18),
      new THREE.Vector3(0, 0.01, 0.25),
    ],
    12,
    12,
    (t, ang) => {
      const r = (1.0 - t * 0.58) * 0.072;
      return r * (0.68 + 0.42 * Math.abs(Math.cos(ang)));
    }
  );
}

function buildTornFleshShred(): THREE.BufferGeometry {
  // High-res jagged sculpted chunk of torn marine muscle tissue with ragged fibrous sinew lobes
  const geo = new THREE.SphereGeometry(0.115, 22, 16);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    let x = pos.getX(i);
    let y = pos.getY(i);
    let z = pos.getZ(i);
    const ang = Math.atan2(z, x);
    const elev = Math.atan2(y, Math.hypot(x, z));
    // Organic ragged tear profile (elongated irregular chunk with jagged sine harmonics)
    const ragged =
      1.0 +
      Math.sin(ang * 3.0 + elev * 2.0) * 0.34 +
      Math.cos(ang * 5.0 - elev * 4.0) * 0.24 +
      Math.sin(ang * 7.0 + elev * 3.0) * 0.14 +
      Math.cos(ang * 11.0 + elev * 7.0) * 0.06;
    x *= ragged * 1.38;
    y *= ragged * 0.62;
    z *= ragged * 0.94;
    pos.setXYZ(i, x, y, z);
  }
  geo.computeVertexNormals();
  applyVertexColors(geo, (x, y, z) => {
    const r = Math.hypot(x, y, z);
    const edge = THREE.MathUtils.clamp((r - 0.07) / 0.11, 0, 1);
    const s = THREE.MathUtils.lerp(0.72, 1.15, edge);
    return [s * 1.04, s * 0.94, s * 0.94];
  });
  return geo;
}

function buildTornLeafRibbon(): THREE.BufferGeometry {
  // High-res notched, twisted botanical kelp/petal shred that flutters realistically underwater
  const geo = new THREE.PlaneGeometry(0.14, 0.25, 8, 16);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const t = THREE.MathUtils.clamp((y + 0.12) / 0.24, 0, 1);
    const notch = 1.0 - Math.pow(Math.max(0, Math.sin(t * Math.PI * 3.5 + 0.8)), 3) * 0.42;
    const taper = (0.35 + Math.sin(t * Math.PI) * 0.85) * notch;
    const twist = (t - 0.5) * 1.15;
    const sx = x * taper;
    const curl = Math.sin(t * Math.PI * 2.0) * 0.032;
    const rx = sx * Math.cos(twist) - curl * Math.sin(twist);
    const rz = sx * Math.sin(twist) + curl * Math.cos(twist);
    pos.setXYZ(i, rx, y, rz);
  }
  geo.computeVertexNormals();
  applyVertexColors(geo, (_x, y) => {
    const t = THREE.MathUtils.clamp((y + 0.125) / 0.25, 0, 1);
    const s = THREE.MathUtils.lerp(0.78, 1.16, t);
    return [s * 0.98, s * 1.04, s * 0.98];
  });
  return geo;
}

function buildSensoryBarbel(): THREE.BufferGeometry {
  // Graceful drooping chemosensory whisker barbel extending forward & down
  return buildTaperedCurveTube(
    [
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0.06, -0.04, 0.14),
      new THREE.Vector3(0.11, -0.14, 0.28),
      new THREE.Vector3(0.08, -0.26, 0.42),
    ],
    16,
    8,
    (t) => Math.pow(THREE.MathUtils.clamp(1.0 - t, 0, 1), 0.78) * 0.018 + 0.0025
  );
}

function buildArmorScutePlate(): THREE.BufferGeometry {
  // Sculpted beveled dorsal/flank osteoderm armor shield plate with central keel ridge
  const geo = new THREE.SphereGeometry(0.14, 18, 12);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const nx = x / 0.14;
    const nz = z / 0.14;
    const ridge = Math.max(0, 1.0 - Math.abs(nx) * 1.4) * 0.048;
    const taper = 1.0 - Math.max(0, nz) * 0.25;
    const sy = y > 0 ? y * 0.42 + ridge : y * 0.16;
    pos.setXYZ(i, x * 1.12 * taper, sy, z * 1.28);
  }
  geo.computeVertexNormals();
  return geo;
}

function buildFeatherPlume(): THREE.BufferGeometry {
  // Sculpted ornate scalloped gill/fin plume vane
  const geo = new THREE.PlaneGeometry(0.32, 0.56, 10, 18);
  geo.translate(0, 0.28, 0);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const t = THREE.MathUtils.clamp(y / 0.56, 0, 1);
    const env = Math.sin(t * Math.PI);
    const barb = 0.78 + 0.22 * Math.sin(t * Math.PI * 11.0);
    const sx = x * (0.28 + env * 1.15) * barb;
    const curlZ = -Math.pow(t, 1.5) * 0.22 + Math.sin(t * Math.PI * 2.5) * 0.035;
    const arch = (1.0 - Math.abs(x) / 0.16) * 0.024 * env;
    pos.setXYZ(i, sx, y, curlZ + arch);
  }
  geo.computeVertexNormals();
  return geo;
}

function buildElectroNode(): THREE.BufferGeometry {
  // Recessed ampullary bioelectric sensory dome
  const pts = [
    new THREE.Vector2(0.056, 0.0),
    new THREE.Vector2(0.052, 0.022),
    new THREE.Vector2(0.034, 0.042),
    new THREE.Vector2(0.008, 0.048),
  ];
  const geo = new THREE.LatheGeometry(pts, 16);
  geo.computeVertexNormals();
  return geo;
}

function buildVentralKeel(): THREE.BufferGeometry {
  // Hydrodynamic swept ventral stabilizing keel fin
  const geo = new THREE.PlaneGeometry(0.14, 0.68, 6, 16);
  geo.rotateX(Math.PI * 0.5);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const t = THREE.MathUtils.clamp((z + 0.34) / 0.68, 0, 1);
    const depth = Math.sin(Math.pow(t, 0.75) * Math.PI) * 0.16;
    const sx = x * (0.18 + Math.sin(t * Math.PI) * 0.42);
    pos.setXYZ(i, sx, -depth * (1.0 - Math.abs(x) / 0.14), z);
  }
  geo.computeVertexNormals();
  return geo;
}

function buildRibbonBlade(): THREE.BufferGeometry {
  // Long undulating serrated seagrass ribbon blade with central midrib
  const geo = new THREE.PlaneGeometry(0.19, 1.55, 8, 28);
  geo.translate(0, 0.775, 0);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const t = THREE.MathUtils.clamp(y / 1.55, 0, 1);
    const serration = 1.0 + Math.sin(t * Math.PI * 14.0) * 0.12 * Math.sin(t * Math.PI);
    const width = (1.0 - Math.pow(t, 1.65) * 0.88) * serration;
    const waveZ = Math.sin(t * Math.PI * 2.2) * 0.14 + Math.pow(t, 1.8) * 0.22;
    const twist = t * 0.62;
    const sx = x * width;
    const rx = sx * Math.cos(twist) - waveZ * Math.sin(twist) * 0.15;
    const rz = waveZ + sx * Math.sin(twist) * 0.45 + (1.0 - Math.abs(x) / 0.095) * 0.014;
    pos.setXYZ(i, rx, y, rz);
  }
  geo.computeVertexNormals();
  applyVertexColors(geo, (_x, y) => {
    const t = THREE.MathUtils.clamp(y / 1.55, 0, 1);
    const s = THREE.MathUtils.lerp(0.68, 1.18, t);
    return [s * 0.96, s * 1.04, s * 0.98];
  });
  return geo;
}

function buildSpongeTube(): THREE.BufferGeometry {
  // Fluted porous tubular sea-sponge chimney with flared osculum rim
  const stations = 22;
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i <= stations; i++) {
    const t = i / stations;
    const y = t * 1.18;
    let r = 0.145 + Math.sin(t * Math.PI * 1.15) * 0.048 - t * 0.03;
    if (t > 0.88) {
      const lip = (t - 0.88) / 0.12;
      r += Math.sin(lip * Math.PI) * 0.036;
    }
    if (i === stations) r = 0.072; // Inward osculum throat rim
    pts.push(new THREE.Vector2(Math.max(0.02, r), y));
  }
  const geo = new THREE.LatheGeometry(pts, 28);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const t = THREE.MathUtils.clamp(y / 1.18, 0, 1);
    const ang = Math.atan2(z, x);
    // Organic vertical ribs & honeycomb pore dimples
    const flute = 1.0 + Math.sin(ang * 9.0 + t * 2.2) * 0.11 + Math.sin(y * 22.0 + ang * 5.0) * 0.045;
    const bendX = Math.sin(t * Math.PI * 0.85) * 0.065;
    pos.setXYZ(i, x * flute + bendX, y, z * flute);
  }
  geo.computeVertexNormals();
  return geo;
}

function buildPlantThorn(): THREE.BufferGeometry {
  // Sharp curved calcified botanical defense thorn
  return buildTaperedCurveTube(
    [
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0.04, 0.035, 0.0),
      new THREE.Vector3(0.095, 0.085, 0.0),
      new THREE.Vector3(0.145, 0.145, 0.0),
    ],
    10,
    7,
    (t) => Math.pow(THREE.MathUtils.clamp(1.0 - t, 0, 1), 0.9) * 0.026 + 0.002
  );
}

let cachedGeo: GeometrySet | null = null;

export function getGeometryLibrary(): GeometrySet {
  if (cachedGeo) return cachedGeo;

  const nutrientDisc = new THREE.CircleGeometry(0.9, 28);
  nutrientDisc.rotateX(-Math.PI * 0.5);

  const shockRing = new THREE.RingGeometry(0.35, 0.64, 48);
  shockRing.rotateX(-Math.PI * 0.5);

  const eyeStalk = buildTaperedCurveTube(
    [
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0.015, 0.14, 0.015),
      new THREE.Vector3(0.0, 0.28, 0.02),
    ],
    10,
    10,
    (t) => 0.032 * (1.0 - t * 0.28)
  );

  cachedGeo = {
    fusiformBody: buildFusiformBody(),
    caudalPeduncle: buildCaudalPeduncle(),
    forkedTailFin: buildForkedTailFin(),
    sweptFin: buildSweptFin(),
    dorsalSail: buildDorsalSail(),
    operculumPlate: buildOperculumPlate(),
    fishLowerJaw: buildFishLowerJaw(),
    toothRow: buildToothRow(),
    gillArch: buildGillArch(),
    mantaBody: buildMantaBody(),
    mantaWingInner: buildMantaWingAirfoil(0.46, 0.32, -0.34, 0.16, -0.26, 0.095, 0.064, 0.045, -0.02),
    mantaWingMid: buildMantaWingAirfoil(0.44, 0.16, -0.26, -0.02, -0.22, 0.064, 0.036, 0.035, -0.02),
    mantaWingTip: buildMantaWingAirfoil(0.38, -0.02, -0.22, -0.24, -0.30, 0.036, 0.008, 0.025, -0.03),
    cephalicLobe: buildCephalicLobe(),
    medusaBell: buildMedusaBell(),
    medusaManubrium: buildMedusaManubrium(),
    medusaGonad: buildMedusaGonad(),
    medusaOralArm: buildOralArm(),
    eelHead: buildEelHead(),
    eelLowerJaw: buildEelLowerJaw(),
    eelFangs: buildEelFangs(),
    eelSegment: buildEelSegment(),
    eelTail: buildEelTail(),
    trilopodCephalon: buildTrilopodCephalon(),
    trilopodPlate: buildTrilopodPlate(),
    trilopodSternum: buildTrilopodSternum(),
    trilopodCompoundEye: buildTrilopodCompoundEye(),
    trilopodTailFan: buildTrilopodTailFan(),
    taperedTentacle: buildTaperedTentacle(),
    spineHorn: buildSpineHorn(),
    mandibleClaw: buildCurvedMandible(),
    eyeStalk,
    antenna: buildCurvedAntenna(),
    eyeSocket: buildEyeSocket(),
    eyeGlobe: buildEyeGlobe(),
    eyeCornea: buildEyeCornea(),
    lureStem: buildLureStem(),
    lureBulb: buildLureBulb(),
    lureFilament: buildLureFilament(),
    legUpper: buildLegUpper(),
    legLower: buildLegLower(),
    sensoryBarbel: buildSensoryBarbel(),
    armorScutePlate: buildArmorScutePlate(),
    featherPlume: buildFeatherPlume(),
    electroNode: buildElectroNode(),
    ventralKeel: buildVentralKeel(),
    kelpStipe: buildKelpStipe(),
    kelpBlade: buildKelpBlade(),
    kelpBladder: buildKelpBladder(),
    holdfastRoot: buildHoldfastRoot(),
    coralBranch: buildCoralBranch(),
    coralPolypCup: buildCoralPolypCup(),
    coralPolypTip: new THREE.SphereGeometry(0.044, 14, 10),
    bulbStem: buildBulbStem(),
    bulbPod: buildBulbPod(),
    bulbInnerCore: buildBulbInnerCore(),
    bulbPetal: buildBulbPetal(),
    bulbStamen: buildBulbStamen(),
    anemoneColumn: buildAnemoneColumn(),
    anemoneOralDisc: buildAnemoneOralDisc(),
    anemoneTentacle: buildAnemoneTentacle(),
    sporeStalk: buildSporeStalk(),
    sporeAnnulus: buildSporeAnnulus(),
    sporeCap: buildSporeCap(),
    sporeGills: buildSporeGills(),
    ribbonBlade: buildRibbonBlade(),
    spongeTube: buildSpongeTube(),
    plantThorn: buildPlantThorn(),
    sphereLow: new THREE.SphereGeometry(0.45, 20, 14),
    egg: new THREE.SphereGeometry(0.125, 20, 16),
    eggEmbryo: buildEggEmbryo(),
    spore: buildSporePropagule(),
    pellet: new THREE.DodecahedronGeometry(0.09, 1),
    nutrientDisc,
    particle: new THREE.SphereGeometry(0.055, 8, 6),
    tornFleshShred: buildTornFleshShred(),
    tornLeafRibbon: buildTornLeafRibbon(),
    shockRing,
  };

  // Ensure every shared geometry has a valid vertex color attribute so vertexColors-enabled PBR materials never sample black
  for (const geo of Object.values(cachedGeo)) {
    if (!geo.attributes.color) {
      const count = geo.attributes.position.count;
      const ones = new Float32Array(count * 3);
      ones.fill(1.0);
      geo.setAttribute('color', new THREE.BufferAttribute(ones, 3));
    }
  }

  return cachedGeo;
}
