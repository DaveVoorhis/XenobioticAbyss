import * as THREE from 'three';
import { disableFrustumCulling } from '../core/math';
import type { AnimalGenome } from '../genetics/types';
import type { AnimalEntity, CorpseEntity } from '../simulation/types';
import { getGeometryLibrary } from './GeometryLibrary';
import { enhanceMaterialWithUnderwaterCaustics, type SharedShaderUniforms } from './Shaders';
import { getProceduralTextures } from './TextureLibrary';

export interface WingJoint {
  innerPivot: THREE.Group;
  midPivot: THREE.Group | null;
  outerPivot: THREE.Group;
  side: number;
  isManta: boolean;
}

export interface ArticulatedAnimalRig {
  group: THREE.Group;
  bodyRoot: THREE.Group;
  materials: THREE.Material[];
  bodyMat: THREE.MeshPhysicalMaterial;
  glowMat: THREE.MeshStandardMaterial;
  finMat: THREE.MeshPhysicalMaterial;
  segments: Array<{ pivot: THREE.Group; index: number }>;
  wings: WingJoint[];
  fins: Array<{ pivot: THREE.Group; axis: 'x' | 'y' | 'z'; amp: number; phaseOffset: number }>;
  opercula: Array<{ pivot: THREE.Group; side: number; baseY: number }>;
  cephalicLobes: Array<{ pivot: THREE.Group; side: number; baseY: number }>;
  tentacles: Array<{ pivot: THREE.Group; phaseOffset: number; radialAngle?: number }>;
  oralArms: Array<{ pivot: THREE.Group; phaseOffset: number }>;
  legs: Array<{ upperPivot: THREE.Group; lowerPivot: THREE.Group; phaseOffset: number; row: number; side: number }>;
  antennae: Array<{ pivot: THREE.Group; side: number }>;
  mandibles: Array<{ pivot: THREE.Group; side: number; baseY: number }>;
  lowerJawPivot: THREE.Group | null;
  eyeStalks: Array<{ pivot: THREE.Group; side: number }>;
  lurePivot: THREE.Group | null;
  bellMesh: THREE.Mesh | null;
  // Mouth-held torn morsel shown while chewing & swallowing
  morselGroup: THREE.Group;
  fleshMorselMesh: THREE.Mesh;
  floraMorselMesh: THREE.Mesh;
  morselMat: THREE.MeshPhysicalMaterial;
  morselBaseZ: number;
  baseEmissive: number;
  glowEmissive: number;
  baseBodyScale: THREE.Vector3;
}

function buildLayeredEye(
  geo: ReturnType<typeof getGeometryLibrary>,
  eyeMat: THREE.Material,
  corneaMat: THREE.Material,
  socketMat: THREE.Material,
  scale = 1.0
): THREE.Group {
  const eyeGroup = new THREE.Group();

  const socket = new THREE.Mesh(geo.eyeSocket, socketMat);
  socket.position.z = -0.012;
  eyeGroup.add(socket);

  const globe = new THREE.Mesh(geo.eyeGlobe, eyeMat);
  eyeGroup.add(globe);

  const cornea = new THREE.Mesh(geo.eyeCornea, corneaMat);
  cornea.position.z = 0.008;
  eyeGroup.add(cornea);

  eyeGroup.scale.setScalar(scale);
  return eyeGroup;
}

export function createAnimalRig(
  genome: AnimalGenome,
  sharedUniforms?: SharedShaderUniforms
): ArticulatedAnimalRig {
  const geo = getGeometryLibrary();
  const tex = getProceduralTextures();
  const group = new THREE.Group();
  const bodyRoot = new THREE.Group();
  group.add(bodyRoot);

  const patternTex = tex.skinPatterns[genome.skinPattern];
  const isTrilopod = genome.bodyPlan === 'armored_trilopod';
  const isMedusa = genome.bodyPlan === 'radial_medusa';
  const isChitin = isTrilopod || genome.integument === 'chitin_carapace';
  const isTranslucent = genome.integument === 'translucent_gel';
  const isMucus = genome.integument === 'smooth_mucus';
  const isSpinedSkin = genome.integument === 'spined_dermal';
  const isPredator = genome.diet === 'Carnivore';
  const baseEmissive = 0.24 * genome.biolumIntensity;
  const glowEmissive = 0.92 * genome.biolumIntensity;

  const sheenCol = new THREE.Color(genome.glowHex);
  if (genome.physiology === 'photosymbiotic') {
    sheenCol.lerp(new THREE.Color(0x34f5a8), 0.55);
  }

  const bodyMat = new THREE.MeshPhysicalMaterial({
    color: genome.baseHex,
    map: tex.skinAlbedo,
    vertexColors: true,
    roughness: isTranslucent ? 0.10 : isMucus ? 0.14 : isChitin ? 0.28 : 0.22,
    roughnessMap: isChitin || isTranslucent ? undefined : tex.scaleRoughness,
    metalness: isChitin ? 0.34 : isTranslucent ? 0.02 : 0.09,
    clearcoat: isMucus || isTranslucent ? 1.0 : isChitin ? 0.74 : 0.92,
    clearcoatRoughness: isMucus || isTranslucent ? 0.06 : isChitin ? 0.18 : 0.10,
    iridescence: isTranslucent ? 0.90 : isChitin ? 0.44 : 0.68,
    iridescenceIOR: 1.38,
    iridescenceThicknessRange: [140, 460],
    sheen: genome.physiology === 'photosymbiotic' ? 0.58 : 0.34,
    sheenRoughness: 0.42,
    sheenColor: sheenCol,
    normalMap: isChitin ? tex.chitinNormal : isSpinedSkin ? tex.spinedBarkNormal : tex.scaleNormal,
    normalScale: new THREE.Vector2(
      isSpinedSkin ? 1.15 : isChitin ? 1.05 : isTranslucent ? 0.32 : 0.88,
      isSpinedSkin ? 1.15 : isChitin ? 1.05 : isTranslucent ? 0.32 : 0.88
    ),
    emissive: new THREE.Color(genome.glowHex),
    emissiveMap: patternTex,
    emissiveIntensity: baseEmissive,
    transparent: isTranslucent,
    opacity: isTranslucent ? 0.74 : 1.0,
  });

  const accentMat = new THREE.MeshPhysicalMaterial({
    color: genome.accentHex,
    map: tex.skinAlbedo,
    vertexColors: true,
    roughness: isTrilopod ? 0.30 : 0.25,
    metalness: isTrilopod ? 0.22 : 0.1,
    clearcoat: 0.80,
    clearcoatRoughness: 0.14,
    iridescence: 0.52,
    iridescenceIOR: 1.34,
    normalMap: isTrilopod ? tex.chitinNormal : tex.scaleNormal,
    normalScale: new THREE.Vector2(isTrilopod ? 0.95 : 0.72, isTrilopod ? 0.95 : 0.72),
    emissive: new THREE.Color(genome.glowHex),
    emissiveIntensity: baseEmissive * 0.58,
  });

  const socketMat = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(genome.baseHex).multiplyScalar(0.45),
    roughness: 0.35,
    metalness: 0.05,
    clearcoat: 0.55,
  });

  const toothMat = new THREE.MeshPhysicalMaterial({
    color: 0xf4f8fa,
    roughness: 0.12,
    metalness: 0.04,
    clearcoat: 1.0,
    clearcoatRoughness: 0.05,
    transparent: true,
    opacity: 0.92,
  });

  const gillMat = new THREE.MeshPhysicalMaterial({
    color: 0x9e1b2e,
    roughness: 0.24,
    metalness: 0.02,
    clearcoat: 0.85,
    sheen: 0.5,
    sheenColor: new THREE.Color(0xff5a6e),
    side: THREE.DoubleSide,
  });

  const compoundEyeMat = new THREE.MeshPhysicalMaterial({
    color: 0x0b1620,
    roughness: 0.08,
    metalness: 0.38,
    clearcoat: 1.0,
    clearcoatRoughness: 0.03,
    iridescence: 0.92,
    iridescenceIOR: 1.45,
    emissive: new THREE.Color(genome.glowHex),
    emissiveIntensity: 0.22,
  });

  const glowMat = new THREE.MeshStandardMaterial({
    color: genome.glowHex,
    roughness: 0.16,
    metalness: 0.06,
    emissive: new THREE.Color(genome.glowHex),
    emissiveIntensity: glowEmissive,
    transparent: true,
    opacity: 0.94,
  });

  const finMat = new THREE.MeshPhysicalMaterial({
    color: genome.glowHex,
    vertexColors: true,
    roughness: isMedusa ? 0.08 : 0.13,
    metalness: 0.02,
    clearcoat: isMedusa ? 1.0 : 0.72,
    clearcoatRoughness: isMedusa ? 0.05 : 0.10,
    iridescence: isMedusa ? 0.94 : 0.82,
    iridescenceIOR: 1.35,
    iridescenceThicknessRange: [160, 520],
    sheen: 0.68,
    sheenColor: new THREE.Color(genome.glowHex),
    emissive: new THREE.Color(genome.baseHex),
    emissiveIntensity: (isMedusa ? 0.46 : 0.34) * genome.biolumIntensity,
    alphaMap: tex.membraneAlpha,
    transparent: true,
    opacity: isMedusa ? 0.72 : 0.80,
    alphaTest: 0.04,
    side: THREE.DoubleSide,
    depthWrite: true,
  });

  const eyeMat = new THREE.MeshStandardMaterial({
    map: isPredator ? tex.eyeIrisPredator : tex.eyeIris,
    roughness: 0.12,
    metalness: 0.12,
    emissive: new THREE.Color(genome.glowHex),
    emissiveIntensity: isPredator ? 0.32 : 0.24,
  });

  const corneaMat = new THREE.MeshPhysicalMaterial({
    color: 0xe8fcff,
    roughness: 0.02,
    metalness: 0.0,
    ior: 1.38,
    specularIntensity: 1.0,
    clearcoat: 1.0,
    clearcoatRoughness: 0.02,
    iridescence: 0.45,
    transparent: true,
    opacity: 0.34,
    depthWrite: false,
  });

  const morselMat = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    map: tex.fleshAlbedo,
    normalMap: tex.fleshNormal,
    normalScale: new THREE.Vector2(0.85, 0.85),
    vertexColors: true,
    roughness: 0.26,
    metalness: 0.04,
    clearcoat: 0.78,
    clearcoatRoughness: 0.14,
    side: THREE.DoubleSide,
  });

  if (sharedUniforms) {
    enhanceMaterialWithUnderwaterCaustics(bodyMat, sharedUniforms, {
      causticStrength: isChitin ? 0.44 : 0.52,
      subsurfaceStrength: isTranslucent ? 0.56 : 0.30,
      subsurfaceColor: genome.glowHex,
      ventBounceStrength: 0.36,
    });
    enhanceMaterialWithUnderwaterCaustics(accentMat, sharedUniforms, {
      causticStrength: 0.46,
      subsurfaceStrength: 0.28,
      subsurfaceColor: genome.glowHex,
      ventBounceStrength: 0.34,
    });
    enhanceMaterialWithUnderwaterCaustics(finMat, sharedUniforms, {
      causticStrength: 0.36,
      subsurfaceStrength: isMedusa ? 0.68 : 0.48,
      subsurfaceColor: genome.glowHex,
      ventBounceStrength: 0.30,
    });
    enhanceMaterialWithUnderwaterCaustics(morselMat, sharedUniforms, {
      causticStrength: 0.36,
      subsurfaceStrength: 0.32,
      subsurfaceColor: 0xff8a7a,
      ventBounceStrength: 0.28,
    });
  }

  const materials: THREE.Material[] = [
    bodyMat,
    accentMat,
    socketMat,
    toothMat,
    gillMat,
    compoundEyeMat,
    glowMat,
    finMat,
    eyeMat,
    corneaMat,
    morselMat,
  ];

  // Mouth-held torn morsel (dynamically colored & animated while chewing/swallowing)
  const morselGroup = new THREE.Group();
  morselGroup.visible = false;
  const fleshMorselMesh = new THREE.Mesh(geo.tornFleshShred, morselMat);
  const floraMorselMesh = new THREE.Mesh(geo.tornLeafRibbon, morselMat);
  floraMorselMesh.rotation.x = Math.PI * 0.4;
  morselGroup.add(fleshMorselMesh);
  morselGroup.add(floraMorselMesh);

  const rig: ArticulatedAnimalRig = {
    group,
    bodyRoot,
    materials,
    bodyMat,
    glowMat,
    finMat,
    segments: [],
    wings: [],
    fins: [],
    opercula: [],
    cephalicLobes: [],
    tentacles: [],
    oralArms: [],
    legs: [],
    antennae: [],
    mandibles: [],
    lowerJawPivot: null,
    eyeStalks: [],
    lurePivot: null,
    bellMesh: null,
    morselGroup,
    fleshMorselMesh,
    floraMorselMesh,
    morselMat,
    morselBaseZ: 0.65,
    baseEmissive,
    glowEmissive,
    baseBodyScale: new THREE.Vector3(1, 1, 1),
  };

  // =========================================================================
  // A. HIGH-RESOLUTION ARTICULATED BODY PLANS (+Z is forward)
  // =========================================================================
  if (genome.bodyPlan === 'segmented_eel') {
    const head = new THREE.Mesh(geo.eelHead, bodyMat);
    head.position.set(0, 0.01, 0.56);
    bodyRoot.add(head);

    // Upper predatory needle-fang arch inside the eel's maxilla
    const upperFangs = new THREE.Mesh(geo.eelFangs, toothMat);
    upperFangs.position.set(0, -0.022, 0.72);
    upperFangs.rotation.z = Math.PI; // Point downward into oral cavity
    bodyRoot.add(upperFangs);

    const jawPiv = new THREE.Group();
    jawPiv.position.set(0, -0.055, 0.54);
    const lowerJaw = new THREE.Mesh(geo.eelLowerJaw, accentMat);
    jawPiv.add(lowerJaw);
    const lowerFangs = new THREE.Mesh(geo.eelFangs, toothMat);
    lowerFangs.position.set(0, -0.008, 0.16);
    lowerFangs.scale.set(0.86, 0.88, 0.88);
    jawPiv.add(lowerFangs);
    bodyRoot.add(jawPiv);
    rig.lowerJawPivot = jawPiv;

    morselGroup.position.set(0, -0.04, 0.90);
    bodyRoot.add(morselGroup);

    for (const side of [-1, 1]) {
      const gill = new THREE.Mesh(geo.gillArch, gillMat);
      gill.position.set(side * 0.135, -0.01, 0.42);
      gill.scale.set(0.8, 0.75, 0.8);
      bodyRoot.add(gill);

      const opPiv = new THREE.Group();
      opPiv.position.set(side * 0.15, -0.01, 0.42);
      const opMesh = new THREE.Mesh(geo.operculumPlate, accentMat);
      if (side < 0) opMesh.scale.x = -1;
      opPiv.add(opMesh);
      bodyRoot.add(opPiv);
      rig.opercula.push({ pivot: opPiv, side, baseY: 0 });
    }

    for (const side of [-1, 1]) {
      const antPiv = new THREE.Group();
      antPiv.position.set(side * 0.10, -0.04, 0.80);
      const barbel = new THREE.Mesh(geo.antenna, glowMat);
      barbel.scale.set(side * 0.78, 0.78, 0.68);
      barbel.rotation.y = side * 0.25;
      antPiv.add(barbel);
      bodyRoot.add(antPiv);
      rig.antennae.push({ pivot: antPiv, side });
    }

    const count = Math.max(8, genome.segments + 2);
    for (let i = 0; i < count; i++) {
      const t = i / Math.max(1, count - 1);
      const r = 1.0 - Math.pow(t, 1.15) * 0.64;
      const piv = new THREE.Group();
      piv.position.set(0, 0, 0.34 - i * 0.22);

      const segMesh = new THREE.Mesh(geo.eelSegment, i % 2 === 0 ? bodyMat : accentMat);
      segMesh.scale.set(r * 0.96, r * 0.96, 1.02);
      piv.add(segMesh);

      const dRibbon = new THREE.Mesh(geo.dorsalSail, finMat);
      dRibbon.scale.set(0.52 * r, 0.48 * r, 0.46);
      dRibbon.position.set(0, 0.18 * r, 0);
      piv.add(dRibbon);

      if (i >= 2) {
        const vRibbon = new THREE.Mesh(geo.dorsalSail, finMat);
        vRibbon.scale.set(0.45 * r, -0.32 * r, 0.44);
        vRibbon.position.set(0, -0.15 * r, 0);
        piv.add(vRibbon);
      }

      for (const side of [-1, 1]) {
        const dot = new THREE.Mesh(geo.lureBulb, glowMat);
        dot.scale.set(0.28 * r, 0.22 * r, 0.28 * r);
        dot.position.set(side * 0.165 * r, 0.01, 0);
        piv.add(dot);
      }

      if (i === count - 1) {
        const tail = new THREE.Mesh(geo.eelTail, finMat);
        tail.scale.setScalar(0.95);
        tail.position.z = -0.10;
        piv.add(tail);
      }

      bodyRoot.add(piv);
      rig.segments.push({ pivot: piv, index: i });
    }
  } else if (genome.bodyPlan === 'radial_medusa') {
    const bell = new THREE.Mesh(geo.medusaBell, finMat);
    bell.position.set(0, 0, 0.08);
    bodyRoot.add(bell);
    rig.bellMesh = bell;

    morselGroup.position.set(0, 0, -0.04);
    bodyRoot.add(morselGroup);

    for (let i = 0; i < 4; i++) {
      const ang = (i / 4) * Math.PI * 2 + Math.PI * 0.25;
      const gonad = new THREE.Mesh(geo.medusaGonad, glowMat);
      gonad.position.set(Math.cos(ang) * 0.17, Math.sin(ang) * 0.17, 0.22);
      gonad.rotation.z = ang - Math.PI * 0.5;
      bodyRoot.add(gonad);
    }

    // Sculpted 4-lobed fluted translucent manubrium stomach pouch (replaces plain sphere!)
    const core = new THREE.Mesh(geo.medusaManubrium, glowMat);
    core.scale.set(0.95, 0.95, 0.95);
    core.position.z = 0.15;
    bodyRoot.add(core);

    // 16 bioluminescent rhopalia sensory knots spaced around the scalloped marginal lappets
    for (let i = 0; i < 16; i++) {
      const ang = (i / 16) * Math.PI * 2;
      const rhop = new THREE.Mesh(geo.electroNode, glowMat);
      rhop.scale.setScalar(0.46);
      rhop.position.set(Math.cos(ang) * 0.495, Math.sin(ang) * 0.495, -0.075);
      rhop.rotation.x = Math.PI * 0.5;
      bodyRoot.add(rhop);
    }

    for (let i = 0; i < 4; i++) {
      const ang = (i / 4) * Math.PI * 2 + Math.PI * 0.25;
      const armPiv = new THREE.Group();
      armPiv.position.set(Math.cos(ang) * 0.10, Math.sin(ang) * 0.10, 0.04);
      const armMesh = new THREE.Mesh(geo.medusaOralArm, finMat);
      armMesh.rotation.z = ang;
      armPiv.add(armMesh);
      bodyRoot.add(armPiv);
      rig.oralArms.push({ pivot: armPiv, phaseOffset: i * 1.45 });
    }

    for (let i = 0; i < 16; i++) {
      const ang = (i / 16) * Math.PI * 2;
      const isPrimary = i % 2 === 0;
      const radius = isPrimary ? 0.44 : 0.39;
      const tPiv = new THREE.Group();
      tPiv.position.set(Math.cos(ang) * radius, Math.sin(ang) * radius, -0.02);
      const tMesh = new THREE.Mesh(geo.taperedTentacle, isPrimary ? glowMat : accentMat);
      tMesh.scale.set(
        isPrimary ? 0.78 : 0.52,
        isPrimary ? 0.78 : 0.52,
        isPrimary ? 1.28 : 0.88
      );
      tPiv.add(tMesh);
      bodyRoot.add(tPiv);
      rig.tentacles.push({ pivot: tPiv, phaseOffset: i * 0.52, radialAngle: ang });
    }
  } else if (genome.bodyPlan === 'armored_trilopod') {
    const cephalon = new THREE.Mesh(geo.trilopodCephalon, bodyMat);
    cephalon.position.set(0, -0.02, 0.36);
    bodyRoot.add(cephalon);

    // Paired schizochroal trilobite crescent compound eyes flanking the glabella
    for (const side of [-1, 1]) {
      const cEye = new THREE.Mesh(geo.trilopodCompoundEye, compoundEyeMat);
      cEye.position.set(side * 0.22, 0.155, 0.44);
      cEye.rotation.y = side > 0 ? 0.18 : Math.PI - 0.18;
      cEye.rotation.z = -side * 0.22;
      bodyRoot.add(cEye);
    }

    morselGroup.position.set(0, -0.06, 0.72);
    bodyRoot.add(morselGroup);

    for (let i = 0; i < 4; i++) {
      const s = 0.96 - i * 0.12;
      const plate = new THREE.Mesh(geo.trilopodPlate, i % 2 === 0 ? accentMat : bodyMat);
      plate.scale.set(s, s, s);
      plate.position.set(0, -0.02, 0.12 - i * 0.19);
      bodyRoot.add(plate);

      // Ventral armored sternum closing the thoracic underside cleanly
      const sternum = new THREE.Mesh(geo.trilopodSternum, socketMat);
      sternum.scale.set(s * 0.94, s, s * 0.96);
      sternum.position.set(0, -0.03, 0.12 - i * 0.19);
      bodyRoot.add(sternum);

      const ridge = new THREE.Mesh(geo.spineHorn, glowMat);
      ridge.scale.set(0.68 * s, 0.52 * s, 0.68 * s);
      ridge.position.set(0, 0.17 * s, 0.11 - i * 0.19);
      ridge.rotation.x = -0.35;
      bodyRoot.add(ridge);
    }

    const fanPiv = new THREE.Group();
    fanPiv.position.set(0, -0.02, -0.54);
    const centerFan = new THREE.Mesh(geo.trilopodTailFan, finMat);
    fanPiv.add(centerFan);
    for (const side of [-1, 1]) {
      const uropod = new THREE.Mesh(geo.trilopodTailFan, accentMat);
      uropod.scale.set(0.75, 0.9, 0.86);
      uropod.position.set(side * 0.08, -0.01, 0.02);
      uropod.rotation.y = side * 0.42;
      fanPiv.add(uropod);
    }
    bodyRoot.add(fanPiv);
    rig.fins.push({ pivot: fanPiv, axis: 'x', amp: 0.24, phaseOffset: 0.5 });

    for (const side of [-1, 1]) {
      const antPiv = new THREE.Group();
      antPiv.position.set(side * 0.16, 0.02, 0.62);
      const ant = new THREE.Mesh(geo.antenna, glowMat);
      ant.scale.set(side * 1.15, 1.05, 1.18);
      ant.rotation.y = side * 0.22;
      ant.rotation.x = -0.1;
      antPiv.add(ant);
      bodyRoot.add(antPiv);
      rig.antennae.push({ pivot: antPiv, side });
    }

    for (let row = 0; row < 5; row++) {
      const scaleRow = 1.0 - row * 0.08;
      for (const side of [-1, 1]) {
        const upPiv = new THREE.Group();
        upPiv.position.set(side * (0.29 - row * 0.02), -0.04, 0.26 - row * 0.165);
        const upLeg = new THREE.Mesh(geo.legUpper, bodyMat);
        upLeg.scale.setScalar(scaleRow);
        upLeg.rotation.z = side * 0.94;
        upPiv.add(upLeg);

        const lowPiv = new THREE.Group();
        lowPiv.position.set(side * 0.19 * scaleRow, -0.14 * scaleRow, 0);
        const lowLeg = new THREE.Mesh(geo.legLower, glowMat);
        lowLeg.scale.set(side * scaleRow, scaleRow, scaleRow);
        lowLeg.rotation.z = side * 0.32;
        lowPiv.add(lowLeg);

        upPiv.add(lowPiv);
        bodyRoot.add(upPiv);
        rig.legs.push({
          upperPivot: upPiv,
          lowerPivot: lowPiv,
          phaseOffset: row * 0.85 + (side > 0 ? 0 : Math.PI),
          row,
          side,
        });
      }
    }
  } else if (genome.bodyPlan === 'winged_manta') {
    const torso = new THREE.Mesh(geo.mantaBody, bodyMat);
    bodyRoot.add(torso);

    morselGroup.position.set(0, -0.03, 0.64);
    bodyRoot.add(morselGroup);

    const dFin = new THREE.Mesh(geo.dorsalSail, accentMat);
    dFin.scale.set(0.45, 0.42, 0.45);
    dFin.position.set(0, 0.14, -0.32);
    bodyRoot.add(dFin);

    // Articulated cephalic feeding horns that flare wide to funnel food into the mouth!
    for (const side of [-1, 1]) {
      const lobePiv = new THREE.Group();
      lobePiv.position.set(side * 0.20, -0.01, 0.44);
      const baseY = -side * 0.12;
      lobePiv.rotation.y = baseY;
      const lobe = new THREE.Mesh(geo.cephalicLobe, accentMat);
      lobe.scale.set(side, 1, 1);
      lobePiv.add(lobe);
      bodyRoot.add(lobePiv);
      rig.cephalicLobes.push({ pivot: lobePiv, side, baseY });
    }

    for (const side of [-1, 1]) {
      const innerPiv = new THREE.Group();
      innerPiv.position.set(side * 0.24, 0.0, 0.02);
      const inMesh = new THREE.Mesh(geo.mantaWingInner, bodyMat);
      if (side < 0) inMesh.scale.x = -1;
      innerPiv.add(inMesh);

      const midPiv = new THREE.Group();
      midPiv.position.set(side * 0.45, 0.0, 0.0);
      const midMesh = new THREE.Mesh(geo.mantaWingMid, accentMat);
      if (side < 0) midMesh.scale.x = -1;
      midPiv.add(midMesh);

      const outerPiv = new THREE.Group();
      outerPiv.position.set(side * 0.43, 0.0, 0.0);
      const tipMesh = new THREE.Mesh(geo.mantaWingTip, finMat);
      if (side < 0) tipMesh.scale.x = -1;
      outerPiv.add(tipMesh);

      midPiv.add(outerPiv);
      innerPiv.add(midPiv);
      bodyRoot.add(innerPiv);
      rig.wings.push({ innerPivot: innerPiv, midPivot: midPiv, outerPivot: outerPiv, side, isManta: true });
    }

    const whipPiv = new THREE.Group();
    whipPiv.position.set(0, 0, -0.54);
    const whip = new THREE.Mesh(geo.taperedTentacle, glowMat);
    whip.scale.set(0.85, 0.85, 1.38);
    whipPiv.add(whip);
    bodyRoot.add(whipPiv);
    rig.fins.push({ pivot: whipPiv, axis: 'y', amp: 0.26, phaseOffset: 0.4 });
  } else {
    // fusiform_swimmer: sculpted hydrodynamic fish with articulated lower jaw & breathing opercula
    const torso = new THREE.Mesh(geo.fusiformBody, bodyMat);
    bodyRoot.add(torso);

    // Articulated ventral jaw hinge so fish visibly open wide & gulp/tear bites!
    const jawPiv = new THREE.Group();
    jawPiv.position.set(0, -0.085, 0.36);
    const lowerJaw = new THREE.Mesh(geo.fishLowerJaw, accentMat);
    jawPiv.add(lowerJaw);

    // Conical marine dentition on upper & lower jaws for predators & omnivores
    if (genome.diet !== 'Herbivore') {
      const toothScale = isPredator ? 1.18 : 0.72;
      const lowerTeeth = new THREE.Mesh(geo.toothRow, toothMat);
      lowerTeeth.position.set(0, 0.008, 0.15);
      lowerTeeth.scale.setScalar(toothScale);
      jawPiv.add(lowerTeeth);

      const upperTeeth = new THREE.Mesh(geo.toothRow, toothMat);
      upperTeeth.position.set(0, -0.032, 0.53);
      upperTeeth.rotation.z = Math.PI;
      upperTeeth.scale.setScalar(toothScale * 1.05);
      bodyRoot.add(upperTeeth);
    }

    bodyRoot.add(jawPiv);
    rig.lowerJawPivot = jawPiv;

    morselGroup.position.set(0, -0.03, 0.68);
    bodyRoot.add(morselGroup);

    for (const side of [-1, 1]) {
      // Crimson feathery gill filaments tucked right behind each breathing operculum plate
      const gill = new THREE.Mesh(geo.gillArch, gillMat);
      gill.position.set(side * 0.158, -0.01, 0.255);
      bodyRoot.add(gill);

      const opPiv = new THREE.Group();
      opPiv.position.set(side * 0.175, -0.01, 0.26);
      const op = new THREE.Mesh(geo.operculumPlate, accentMat);
      if (side < 0) op.scale.x = -1;
      opPiv.add(op);
      bodyRoot.add(opPiv);
      rig.opercula.push({ pivot: opPiv, side, baseY: 0 });
    }

    for (let p = 0; p < 5; p++) {
      const z = 0.22 - p * 0.16;
      const xW = 0.215 * Math.sin(((z + 0.64) / 1.28) * Math.PI);
      for (const side of [-1, 1]) {
        const dot = new THREE.Mesh(geo.lureBulb, glowMat);
        dot.scale.set(0.2, 0.16, 0.24);
        dot.position.set(side * xW, 0.02, z);
        bodyRoot.add(dot);
      }
    }

    const pedunclePiv = new THREE.Group();
    pedunclePiv.position.set(0, 0, -0.52);
    const pedMesh = new THREE.Mesh(geo.caudalPeduncle, accentMat);
    pedunclePiv.add(pedMesh);
    bodyRoot.add(pedunclePiv);
    rig.fins.push({ pivot: pedunclePiv, axis: 'y', amp: 0.22, phaseOffset: 0.0 });

    const tailPiv = new THREE.Group();
    tailPiv.position.set(0, 0, -0.22);
    const tail = new THREE.Mesh(geo.forkedTailFin, finMat);
    tailPiv.add(tail);
    pedunclePiv.add(tailPiv);
    rig.fins.push({ pivot: tailPiv, axis: 'y', amp: 0.36, phaseOffset: -0.72 });

    const dorsal = new THREE.Mesh(geo.dorsalSail, finMat);
    dorsal.position.set(0, 0.28, -0.02);
    dorsal.scale.set(0.92, 0.92, 0.92);
    bodyRoot.add(dorsal);

    const adipose = new THREE.Mesh(geo.dorsalSail, accentMat);
    adipose.position.set(0, 0.16, -0.38);
    adipose.scale.set(0.32, 0.34, 0.32);
    bodyRoot.add(adipose);

    const anal = new THREE.Mesh(geo.dorsalSail, finMat);
    anal.position.set(0, -0.22, -0.24);
    anal.scale.set(0.58, -0.48, 0.56);
    bodyRoot.add(anal);

    for (const side of [-1, 1]) {
      const pelvic = new THREE.Mesh(geo.sweptFin, finMat);
      pelvic.position.set(side * 0.09, -0.24, 0.04);
      pelvic.scale.set(side * 0.38, 0.42, 0.42);
      pelvic.rotation.z = -side * 0.58;
      bodyRoot.add(pelvic);
    }

    if (genome.appendage !== 'pectoral_wings') {
      for (const side of [-1, 1]) {
        const finPiv = new THREE.Group();
        finPiv.position.set(side * 0.19, -0.08, 0.16);
        const fMesh = new THREE.Mesh(geo.sweptFin, finMat);
        fMesh.scale.set(side * 0.68, 0.68, 0.68);
        finPiv.add(fMesh);
        bodyRoot.add(finPiv);
        rig.fins.push({ pivot: finPiv, axis: 'z', amp: 0.28 * side, phaseOffset: side > 0 ? 0.2 : 0.7 });
      }
    }
  }

  // =========================================================================
  // B. COMPOSABLE APPENDAGES
  // =========================================================================
  if (genome.appendage === 'pectoral_wings' && genome.bodyPlan !== 'winged_manta') {
    for (const side of [-1, 1]) {
      const innerPiv = new THREE.Group();
      innerPiv.position.set(side * 0.19, -0.02, 0.14);
      const inMesh = new THREE.Mesh(geo.sweptFin, accentMat);
      inMesh.scale.set(side * 0.86, 0.9, 0.9);
      innerPiv.add(inMesh);

      const outerPiv = new THREE.Group();
      outerPiv.position.set(side * 0.42, -0.02, -0.08);
      const outMesh = new THREE.Mesh(geo.sweptFin, finMat);
      outMesh.scale.set(side * 0.66, 0.76, 0.76);
      outerPiv.add(outMesh);

      innerPiv.add(outerPiv);
      bodyRoot.add(innerPiv);
      rig.wings.push({ innerPivot: innerPiv, midPivot: null, outerPivot: outerPiv, side, isManta: false });
    }
  } else if (genome.appendage === 'trailing_tentacles' && genome.bodyPlan !== 'radial_medusa') {
    for (let i = 0; i < 6; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      const tier = Math.floor(i / 2);
      const tPiv = new THREE.Group();
      tPiv.position.set(side * (0.07 + tier * 0.065), -0.05 - tier * 0.02, -0.44);
      const tMesh = new THREE.Mesh(geo.taperedTentacle, i % 2 === 0 ? glowMat : finMat);
      tMesh.scale.set(0.75, 0.75, 1.05 - tier * 0.14);
      tPiv.add(tMesh);
      bodyRoot.add(tPiv);
      rig.tentacles.push({ pivot: tPiv, phaseOffset: i * 0.95 });
    }
  } else if (genome.appendage === 'dorsal_crest' || genome.functionalPart === 'dorsal_crest') {
    const crest = new THREE.Mesh(geo.dorsalSail, finMat);
    crest.position.set(0, 0.28, 0.04);
    crest.scale.set(1.15, 1.48, 1.38);
    bodyRoot.add(crest);
  } else if (genome.appendage === 'sensory_barbels') {
    // Dual pairs of graceful drooping chemosensory barbels extending from the snout/chin
    const barbelZ =
      genome.bodyPlan === 'segmented_eel' ? 0.66 : genome.bodyPlan === 'armored_trilopod' ? 0.52 : 0.46;
    for (const side of [-1, 1]) {
      for (let pair = 0; pair < 2; pair++) {
        const bPiv = new THREE.Group();
        bPiv.position.set(side * (0.09 + pair * 0.06), -0.05 - pair * 0.02, barbelZ - pair * 0.07);
        const bMesh = new THREE.Mesh(geo.sensoryBarbel, pair === 0 ? glowMat : accentMat);
        bMesh.scale.set(side * (1.0 - pair * 0.2), 1.0 - pair * 0.18, 1.05 - pair * 0.15);
        bPiv.add(bMesh);
        bodyRoot.add(bPiv);
        rig.antennae.push({ pivot: bPiv, side });
      }
    }
  } else if (genome.appendage === 'ventral_keels') {
    // Hydrodynamic ventral & ventrolateral stabilizing keel blades
    const mainKeel = new THREE.Mesh(geo.ventralKeel, accentMat);
    mainKeel.position.set(0, -0.18, -0.06);
    mainKeel.scale.set(1.0, 1.15, 1.12);
    bodyRoot.add(mainKeel);
    for (const side of [-1, 1]) {
      const sideKeel = new THREE.Mesh(geo.ventralKeel, finMat);
      sideKeel.position.set(side * 0.14, -0.14, -0.12);
      sideKeel.scale.set(0.75, 0.78, 0.85);
      sideKeel.rotation.z = side * 0.58;
      bodyRoot.add(sideKeel);
    }
  } else if (genome.appendage === 'feather_plumes') {
    // Ornate scalloped bioluminescent gill & shoulder plumes oscillating gently in the water
    for (const side of [-1, 1]) {
      for (let k = 0; k < 2; k++) {
        const pPiv = new THREE.Group();
        pPiv.position.set(side * (0.18 + k * 0.03), 0.1 + k * 0.04, 0.14 - k * 0.18);
        pPiv.rotation.z = -side * (0.68 + k * 0.16);
        pPiv.rotation.x = -0.25;
        const plume = new THREE.Mesh(geo.featherPlume, k === 0 ? finMat : glowMat);
        plume.scale.set(side * (0.95 - k * 0.18), 0.95 - k * 0.15, 0.9);
        pPiv.add(plume);
        bodyRoot.add(pPiv);
        rig.fins.push({ pivot: pPiv, axis: 'z', amp: 0.22 * side, phaseOffset: k * 1.1 + side * 0.4 });
      }
    }
  }

  // =========================================================================
  // C. LAYERED REALISTIC EYES WITH SCULPTED ORBITAL SOCKETS
  // =========================================================================
  const hasStalkedEyes =
    genome.appendage === 'stalked_eyes' || genome.functionalPart === 'stalked_eyes';
  const eyeZ =
    genome.bodyPlan === 'segmented_eel'
      ? 0.70
      : genome.bodyPlan === 'radial_medusa'
      ? 0.42
      : genome.bodyPlan === 'winged_manta'
      ? 0.42
      : genome.bodyPlan === 'armored_trilopod'
      ? 0.50
      : 0.44;
  const eyeX =
    genome.bodyPlan === 'winged_manta'
      ? 0.24
      : genome.bodyPlan === 'armored_trilopod'
      ? 0.21
      : 0.155;
  const eyeY =
    genome.bodyPlan === 'armored_trilopod'
      ? 0.14
      : genome.bodyPlan === 'segmented_eel'
      ? 0.08
      : 0.11;

  for (const side of [-1, 1]) {
    if (hasStalkedEyes) {
      const stalkPiv = new THREE.Group();
      stalkPiv.position.set(side * (eyeX * 0.85), eyeY + 0.03, eyeZ);
      stalkPiv.rotation.z = -side * 0.26;
      const stalkMesh = new THREE.Mesh(geo.eyeStalk, bodyMat);
      stalkPiv.add(stalkMesh);

      const eye = buildLayeredEye(geo, eyeMat, corneaMat, socketMat, 1.08);
      eye.position.set(0, 0.28, 0.02);
      stalkPiv.add(eye);
      bodyRoot.add(stalkPiv);
      rig.eyeStalks.push({ pivot: stalkPiv, side });
    } else {
      const eye = buildLayeredEye(
        geo,
        eyeMat,
        corneaMat,
        socketMat,
        genome.diet === 'Carnivore' ? 1.12 : 0.96
      );
      eye.position.set(side * eyeX, eyeY, eyeZ);
      eye.rotation.y = genome.diet === 'Carnivore' ? side * 0.16 : side * 0.44;
      bodyRoot.add(eye);
    }
  }

  // =========================================================================
  // D. FUNCTIONAL ORGANS (ANGLER ESCA, SERRATED MANDIBLES, SPINES)
  // =========================================================================
  if (genome.functionalPart === 'bioluminescent_lure') {
    const lurePiv = new THREE.Group();
    lurePiv.position.set(0, 0.16, eyeZ - 0.04);
    const stem = new THREE.Mesh(geo.lureStem, accentMat);
    lurePiv.add(stem);

    const bulb = new THREE.Mesh(geo.lureBulb, glowMat);
    bulb.scale.setScalar(1.25);
    bulb.position.set(0, 0.19, 0.41);
    lurePiv.add(bulb);

    for (let f = 0; f < 3; f++) {
      const fil = new THREE.Mesh(geo.lureFilament, finMat);
      fil.position.set(0, 0.15, 0.41);
      fil.rotation.y = (f / 3) * Math.PI * 2;
      lurePiv.add(fil);
    }
    bodyRoot.add(lurePiv);
    rig.lurePivot = lurePiv;
  } else if (genome.functionalPart === 'mandibles') {
    for (const side of [-1, 1]) {
      const mPiv = new THREE.Group();
      mPiv.position.set(side * 0.12, -0.05, eyeZ + 0.08);
      const jaw = new THREE.Mesh(geo.mandibleClaw, glowMat);
      if (side < 0) jaw.scale.x = -1;
      mPiv.add(jaw);
      bodyRoot.add(mPiv);
      rig.mandibles.push({ pivot: mPiv, side, baseY: side * 0.08 });
    }
  } else if (genome.functionalPart === 'chitin_spines') {
    for (let i = 0; i < 5; i++) {
      const sp = new THREE.Mesh(geo.spineHorn, i % 2 === 0 ? glowMat : accentMat);
      const sc = 1.0 - i * 0.12;
      sp.scale.setScalar(sc);
      sp.position.set(0, 0.25 - i * 0.025, 0.26 - i * 0.19);
      sp.rotation.x = -0.35 - i * 0.06;
      bodyRoot.add(sp);
    }
  } else if (genome.functionalPart === 'electro_organs') {
    // Glowing ampullary bioelectric sensory domes arrayed along the snout & forehead
    for (let i = 0; i < 3; i++) {
      for (const side of [-1, 1]) {
        const node = new THREE.Mesh(geo.electroNode, glowMat);
        node.scale.setScalar(0.75 + (2 - i) * 0.16);
        node.position.set(side * (0.075 + i * 0.04), 0.12 - i * 0.02, eyeZ + 0.06 - i * 0.12);
        node.rotation.z = -side * 0.52;
        node.rotation.x = 0.28;
        bodyRoot.add(node);
      }
    }
  } else if (genome.functionalPart === 'armored_scutes') {
    // Overlapping beveled dorsal & flank osteoderm armor shield plates
    for (let i = 0; i < 4; i++) {
      const scute = new THREE.Mesh(geo.armorScutePlate, i % 2 === 0 ? accentMat : bodyMat);
      const sc = 1.08 - i * 0.12;
      scute.scale.set(sc, sc, sc);
      scute.position.set(0, 0.21 - i * 0.015, 0.24 - i * 0.21);
      bodyRoot.add(scute);
    }
  } else if (genome.functionalPart === 'venom_barbs') {
    // Sweeping toxic barbed flank spurs tipped with warning bioluminescence
    for (const side of [-1, 1]) {
      for (let i = 0; i < 3; i++) {
        const barb = new THREE.Mesh(geo.spineHorn, glowMat);
        const sc = 0.92 - i * 0.16;
        barb.scale.set(sc * 0.85, sc * 1.15, sc * 0.85);
        barb.position.set(side * (0.2 - i * 0.025), 0.04, 0.1 - i * 0.22);
        barb.rotation.z = -side * 1.12;
        barb.rotation.x = -0.35;
        bodyRoot.add(barb);
      }
    }
  }

  // Express continuous heritable morphological proportions (bodyElongation & finSpan)
  const elong = genome.bodyElongation ?? 1.0;
  const widthComp = 1.0 / Math.sqrt(Math.max(0.5, elong));
  if (genome.bodyPlan === 'radial_medusa') {
    bodyRoot.scale.set(widthComp, elong, widthComp);
  } else {
    bodyRoot.scale.set(widthComp, 0.92 + widthComp * 0.08, elong);
  }
  rig.baseBodyScale.copy(bodyRoot.scale);
  const fSpan = genome.finSpan ?? 1.0;
  if (Math.abs(fSpan - 1.0) > 0.02) {
    for (let i = 0; i < rig.wings.length; i++) {
      rig.wings[i].innerPivot.scale.multiplyScalar(fSpan);
    }
    for (let i = 0; i < rig.fins.length; i++) {
      rig.fins[i].pivot.scale.multiplyScalar(0.65 + fSpan * 0.35);
    }
  }

  // Enable soft underwater shadow casting & receiving on primary opaque organism geometry
  bodyRoot.traverse((obj) => {
    if (obj instanceof THREE.Mesh) {
      const mat = obj.material as THREE.Material;
      if (!mat.transparent || isTranslucent) {
        obj.castShadow = true;
        obj.receiveShadow = true;
      }
    }
  });
  disableFrustumCulling(group);
  rig.morselBaseZ = morselGroup.position.z;
  return rig;
}

/**
 * Updates articulated skeletal joints, strike lunges, head-shaking tear thrashes,
 * mouth-held morsel chewing, jaw gaping, gill suction flares, and nocturnal glow.
 */
export function updateAnimalRig(
  rig: ArticulatedAnimalRig,
  entity: AnimalEntity,
  daylight: number,
  time: number
): void {
  rig.group.position.copy(entity.position);
  rig.group.quaternion.copy(entity.quaternion);
  rig.group.scale.setScalar(entity.scale);

  // Allometric developmental silhouette shifts across Live Spawn -> Larva / Instar -> Adult
  // plus brief luminous expansion shiver during ecdysis molts & metamorphosis
  const moltPulse = entity.moltAnim > 0.01 ? Math.sin(entity.moltAnim * Math.PI) * 0.14 : 0;
  let alloX = 1.0;
  let alloY = 1.0;
  let alloZ = 1.0;
  if (entity.lifeStage === 'spawn') {
    // Compact plump yolk-sac neonate proportions
    alloX = 1.12;
    alloY = 1.14;
    alloZ = 0.86;
  } else if (entity.lifeStage === 'larva') {
    // Slender, streamlined dispersing pelagic larva
    alloX = 0.94;
    alloY = 0.95;
    alloZ = 1.06;
  } else if (entity.lifeStage === 'instar') {
    // Flatter, broader benthic arthropod instar carapace
    alloX = 1.07;
    alloY = 0.9;
    alloZ = 0.96;
  }
  rig.bodyRoot.scale.set(
    rig.baseBodyScale.x * alloX * (1.0 + moltPulse),
    rig.baseBodyScale.y * alloY * (1.0 + moltPulse),
    rig.baseBodyScale.z * alloZ * (1.0 + moltPulse * 0.85)
  );

  // Biomechanical feeding kinematics:
  // 1) Approach jaw gape + subtle snout strike lift
  // 2) Two-phase strike lunge (+Z forward snap -> -Z backward tug-recoil)
  // 3) Fierce lateral head-shake tear thrash
  const gape = entity.jawGape ?? 0;
  const biteClamp = Math.pow(entity.biteAnim, 1.8);
  const lunge = entity.lungeAnim;
  const thrash = entity.thrashAnim;

  let lungeZ = 0;
  if (lunge > 0.58) {
    // Crisp forward strike surge into the bite
    const p = (lunge - 0.58) / 0.42;
    lungeZ = Math.sin(p * Math.PI * 0.85) * 0.26;
  } else if (lunge > 0.005) {
    // Backward tug-recoil as jaws rip the torn chunk free
    const p = lunge / 0.58;
    lungeZ = -Math.sin(p * Math.PI) * 0.15;
  }

  const thrashYaw = thrash > 0.005 ? Math.sin(thrash * Math.PI * 6.0) * thrash * 0.36 : 0;
  const thrashPitch =
    -gape * 0.14 +
    biteClamp * 0.11 +
    (thrash > 0.005 ? Math.cos(thrash * Math.PI * 5.0) * thrash * 0.12 : 0);

  rig.bodyRoot.position.set(0, 0, lungeZ);
  rig.bodyRoot.rotation.set(thrashPitch, thrashYaw, 0);

  // Visible mouth-held torn chunk/leaf that progressively retracts deeper into the mouth while chewed & swallowed
  if (entity.mouthMorselTimer > 0.02) {
    rig.morselGroup.visible = true;
    rig.morselMat.color.setHex(entity.mouthMorselColor);
    const isFlora = entity.mouthMorselKind === 'flora';
    rig.fleshMorselMesh.visible = !isFlora;
    rig.floraMorselMesh.visible = isFlora;

    const maxT = Math.max(0.25, entity.mouthMorselMaxTimer || 1.15);
    const remain = Math.max(0, Math.min(1, entity.mouthMorselTimer / maxT));
    const swallowProg = 1.0 - remain;
    const chomp = Math.sin(entity.chewPhase);
    const chewSquish = 0.84 + 0.16 * chomp;
    const sc = (0.24 + 0.98 * Math.pow(remain, 0.72)) * chewSquish;

    // Pull the torn piece progressively deeper into the mouth/gullet as it is chewed
    const retractDir = rig.morselBaseZ >= 0 ? -1 : 1;
    rig.morselGroup.position.z =
      rig.morselBaseZ - retractDir * 0.05 + retractDir * swallowProg * 0.21 + chomp * 0.012;
    rig.morselGroup.scale.set(sc * (1.0 + Math.max(0, -chomp) * 0.14), sc * chewSquish, sc);
    rig.morselGroup.rotation.set(
      Math.sin(entity.chewPhase * 0.85 + entity.id) * (0.38 + thrash * 0.35),
      Math.cos(entity.chewPhase * 0.65 + entity.id) * (0.52 + thrash * 0.4),
      Math.sin(entity.chewPhase) * 0.32
    );
  } else {
    rig.morselGroup.visible = false;
    rig.morselGroup.position.z = rig.morselBaseZ;
  }

  // Hydrodynamic wing waves (inner -> mid -> outer tip lag)
  for (let i = 0; i < rig.wings.length; i++) {
    const w = rig.wings[i];
    const pIn = entity.wingPhase;
    const pMid = entity.wingPhase - 0.62;
    const pOut = entity.wingPhase - 1.18;
    const cIn = Math.sin(pIn) - 0.22 * Math.sin(2.0 * pIn);
    const cMid = Math.sin(pMid) - 0.18 * Math.sin(2.0 * pMid);
    const cOut = Math.sin(pOut) - 0.16 * Math.sin(2.0 * pOut);

    if (w.isManta && w.midPivot) {
      w.innerPivot.rotation.z = w.side * cIn * 0.34;
      w.midPivot.rotation.z = w.side * cMid * 0.32;
      w.outerPivot.rotation.z = w.side * cOut * 0.36;
    } else {
      w.innerPivot.rotation.z = w.side * cIn * 0.42;
      w.outerPivot.rotation.z = w.side * cOut * 0.36;
    }
  }

  // Manta cephalic feeding horns flare wide open on approach to funnel food, then curl in on gulp!
  for (let i = 0; i < rig.cephalicLobes.length; i++) {
    const l = rig.cephalicLobes[i];
    const flare = gape * 0.56 + Math.sin(entity.biteAnim * Math.PI) * 0.26 - biteClamp * 0.22;
    l.pivot.rotation.y = l.baseY + l.side * flare;
    l.pivot.rotation.x = -flare * 0.35;
  }

  // Eel sinuous body wave (+ fierce S-whip recoil while tearing flesh!)
  for (let i = 0; i < rig.segments.length; i++) {
    const s = rig.segments[i];
    const phase = entity.swimPhase - s.index * 0.58;
    const whipAmp = 1.0 + thrash * 0.85;
    s.pivot.position.x = Math.sin(phase) * (0.024 + s.index * 0.019) * whipAmp;
    s.pivot.rotation.y = Math.cos(phase) * 0.22 * whipAmp;
  }

  // Caudal peduncle + forked tail + steering fins (snappier tail flick during bite lunge)
  const finBoost = 1.0 + lunge * 0.45 + thrash * 0.35;
  for (let i = 0; i < rig.fins.length; i++) {
    const f = rig.fins[i];
    const v = Math.sin(entity.swimPhase + f.phaseOffset) * f.amp * finBoost;
    if (f.axis === 'y') f.pivot.rotation.y = v;
    else if (f.axis === 'x') f.pivot.rotation.x = v;
    else f.pivot.rotation.z = v;
  }

  // Buccal gill-cover suction flare right after bite snap + elevated pumping while chewing
  for (let i = 0; i < rig.opercula.length; i++) {
    const op = rig.opercula[i];
    const chewing = entity.mouthMorselTimer > 0.05;
    const breath = chewing
      ? 0.08 + 0.09 * Math.sin(entity.chewPhase * 0.9)
      : 0.05 + 0.05 * Math.sin(time * 3.8 + entity.id * 1.3);
    const gulpFlare =
      gape * 0.14 + Math.sin(entity.biteAnim * Math.PI) * 0.42 + entity.lungeAnim * 0.12;
    op.pivot.rotation.y = op.baseY - op.side * (breath + gulpFlare);
  }

  // Articulated eel & fish lower jaw: wide anticipatory gape -> decisive clamp -> rhythmic chewing!
  if (rig.lowerJawPivot) {
    const approachOpen = gape * 0.74;
    const chew =
      entity.mouthMorselTimer > 0.05
        ? (0.5 + 0.5 * Math.sin(entity.chewPhase)) *
          0.28 *
          Math.min(1, entity.mouthMorselTimer / 0.35)
        : 0;
    const breath = (0.5 + 0.5 * Math.sin(time * 3.4 + entity.id)) * 0.06;
    // Clamps decisively shut at the instant of bite impact, then opens into rhythmic chewing chomps
    rig.lowerJawPivot.rotation.x =
      Math.max(0.02, approachOpen + chew + breath) * (1.0 - biteClamp * 0.84);
  }

  // Medusa bell propulsion pulse (vigorous contraction when engulfing food)
  if (rig.bellMesh) {
    const pulse = Math.sin(entity.wingPhase * 1.15) + entity.biteAnim * 0.35;
    rig.bellMesh.scale.set(1.0 + pulse * 0.14, 1.0 + pulse * 0.14, 0.94 - pulse * 0.16);
  }

  // Medusa oral arms & tentacles spread gently on approach, then constrict around captured food!
  const engulf =
    -gape * 0.2 +
    biteClamp * 0.55 +
    thrash * 0.32 +
    (entity.mouthMorselTimer > 0.05 ? 0.22 : 0);
  for (let i = 0; i < rig.oralArms.length; i++) {
    const arm = rig.oralArms[i];
    arm.pivot.rotation.x = Math.sin(entity.swimPhase * 0.68 + arm.phaseOffset) * (0.16 + engulf * 0.4);
    arm.pivot.rotation.y = Math.cos(entity.swimPhase * 0.62 + arm.phaseOffset) * (0.16 + engulf * 0.4);
  }

  for (let i = 0; i < rig.tentacles.length; i++) {
    const t = rig.tentacles[i];
    const baseX = Math.sin(entity.swimPhase * 0.78 + t.phaseOffset) * 0.22;
    const baseY = Math.cos(entity.swimPhase * 0.70 + t.phaseOffset) * 0.20;
    if (t.radialAngle !== undefined && engulf > 0.01) {
      // Curl rim tentacles inward around captured food
      t.pivot.rotation.x = baseX + Math.sin(t.radialAngle) * engulf * 0.75;
      t.pivot.rotation.y = baseY - Math.cos(t.radialAngle) * engulf * 0.75;
    } else {
      t.pivot.rotation.x = baseX;
      t.pivot.rotation.y = baseY;
    }
  }

  // Articulated 2-joint paddling legs (front 2 trilopod leg pairs reach & clutch inward when tearing food!)
  for (let i = 0; i < rig.legs.length; i++) {
    const l = rig.legs[i];
    const stroke = Math.sin(entity.paddlePhase + l.phaseOffset);
    const feeding = gape > 0.1 || entity.biteAnim > 0.05 || entity.mouthMorselTimer > 0.05;
    const clutch =
      l.row < 2 && feeding
        ? 0.42 + biteClamp * 0.34 + (entity.mouthMorselTimer > 0.05 ? Math.sin(entity.chewPhase + l.row) * 0.14 : 0)
        : 0;
    l.upperPivot.rotation.y = stroke * 0.34 + l.side * clutch;
    l.lowerPivot.rotation.z = Math.cos(entity.paddlePhase + l.phaseOffset) * 0.28 - l.side * clutch * 0.65;
  }

  // Sensory antennae sweep (excited twitching when feeding)
  const antBoost = 1.0 + entity.biteAnim * 1.4 + (entity.mouthMorselTimer > 0 ? 0.6 : 0);
  for (let i = 0; i < rig.antennae.length; i++) {
    const ant = rig.antennae[i];
    ant.pivot.rotation.y = Math.sin(time * 2.4 * antBoost + entity.id + i) * 0.16;
    ant.pivot.rotation.x = Math.cos(time * 1.9 * antBoost + entity.id) * 0.09;
  }

  // Snapping serrated pincer mandibles (wide spread on approach -> violent inward shear -> chewing chomps)
  for (let i = 0; i < rig.mandibles.length; i++) {
    const m = rig.mandibles[i];
    const spread = -gape * 0.56;
    const clampShear = biteClamp * 0.46;
    const chew =
      entity.mouthMorselTimer > 0.05
        ? Math.sin(entity.chewPhase + i * 0.55) * 0.22
        : 0;
    const idle = Math.sin(time * 2.2 + entity.id) * 0.05;
    m.pivot.rotation.y = m.baseY - m.side * (spread + clampShear + chew + idle);
  }

  for (let i = 0; i < rig.eyeStalks.length; i++) {
    const st = rig.eyeStalks[i];
    st.pivot.rotation.x = Math.sin(time * 1.8 + entity.id + i) * 0.08;
  }

  if (rig.lurePivot) {
    rig.lurePivot.rotation.z = Math.sin(time * 2.8 + entity.id) * 0.16;
    rig.lurePivot.rotation.x = Math.cos(time * 2.1 + entity.id) * 0.08;
  }

  // Nocturnal bioluminescence glow boost + combat hit flash + metamorphosis/molt shimmer
  const nightBoost = 1.0 + (1.0 - daylight) * 1.35;
  const pulse = 0.88 + 0.12 * Math.sin(time * 3.0 + entity.id * 1.7);
  const stageLum = entity.lifeStage === 'spawn' ? 0.72 : entity.lifeStage === 'adult' ? 1.0 : 0.88;
  const moltBoost = entity.moltAnim > 0.01 ? entity.moltAnim * 1.15 : 0;
  if (entity.hitFlash > 0) {
    rig.bodyMat.emissiveIntensity = 1.65;
  } else {
    rig.bodyMat.emissiveIntensity = rig.baseEmissive * nightBoost * pulse * stageLum + moltBoost * 0.55;
  }
  rig.glowMat.emissiveIntensity = rig.glowEmissive * nightBoost * pulse * stageLum + moltBoost;
}

export function updateCorpseRig(rig: ArticulatedAnimalRig, corpse: CorpseEntity): void {
  rig.group.position.copy(corpse.position);
  rig.group.quaternion.copy(corpse.quaternion);
  rig.group.scale.setScalar(corpse.scale);
  rig.morselGroup.visible = false;

  // Physical shudder & recoil jerk whenever scavengers tear a chunk off the carcass!
  if (corpse.joltAnim > 0.01) {
    const j = corpse.joltAnim;
    rig.bodyRoot.position.set(
      Math.sin(j * Math.PI * 7.0) * j * 0.09,
      Math.abs(Math.sin(j * Math.PI * 4.0)) * j * 0.06,
      Math.cos(j * Math.PI * 6.0) * j * 0.09
    );
    rig.bodyRoot.rotation.set(
      Math.sin(j * Math.PI * 5.0) * j * 0.22,
      Math.cos(j * Math.PI * 6.0) * j * 0.26,
      Math.sin(j * Math.PI * 4.0) * j * 0.24
    );
  } else {
    rig.bodyRoot.position.set(0, 0, 0);
    rig.bodyRoot.rotation.set(0, 0, 0);
  }

  const op = corpse.opacity;
  for (let i = 0; i < rig.materials.length; i++) {
    const m = rig.materials[i] as THREE.MeshStandardMaterial;
    if (op < 0.99) {
      m.transparent = true;
      m.opacity = op;
    }
    if ('emissiveIntensity' in m && typeof m.emissiveIntensity === 'number') {
      m.emissiveIntensity = op * 0.12;
    }
  }
}
