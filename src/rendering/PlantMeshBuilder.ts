import * as THREE from 'three';
import { disableFrustumCulling, randRange } from '../core/math';
import type { PlantGenome } from '../genetics/types';
import type { PlantEntity } from '../simulation/types';
import { getGeometryLibrary } from './GeometryLibrary';
import { enhanceMaterialWithUnderwaterCaustics, type SharedShaderUniforms } from './Shaders';
import { getProceduralTextures } from './TextureLibrary';

export interface PlantRig {
  group: THREE.Group;
  materials: THREE.Material[];
  tipMat: THREE.MeshStandardMaterial;
  translucentMat: THREE.MeshPhysicalMaterial;
  fronds: Array<{
    pivot: THREE.Group;
    phase: number;
    baseTilt: number;
    isAnemoneTentacle?: boolean;
    swayScale?: number;
  }>;
  kelpTiers: Array<{ node: THREE.Object3D; tier: number; phase: number }>;
  baseGlow: number;
}

export function createPlantRig(
  genome: PlantGenome,
  sharedUniforms?: SharedShaderUniforms
): PlantRig {
  const geo = getGeometryLibrary();
  const tex = getProceduralTextures();
  const group = new THREE.Group();

  const isCoral = genome.form === 'coral_fan';
  const isAnemone = genome.form === 'tendril_anemone';
  const isSpore = genome.form === 'spore_stalk';
  const isSeagrass = genome.form === 'ribbon_seagrass';
  const isSponge = genome.form === 'crystal_sponge';
  const surf = genome.surfaceTexture ?? 'veined';
  const leafMorph = genome.leafMorphology ?? 'broad_blade';
  const def = genome.defense ?? 'none';
  const rootSys = genome.rootSystem ?? 'holdfast_anchor';
  const spread = genome.canopySpread ?? 1.0;

  const primaryNormal =
    surf === 'porous_coral' || isCoral
      ? tex.coralPoreNormal
      : surf === 'crystalline' || isSponge
      ? tex.crystalFacetNormal
      : surf === 'spined_bark'
      ? tex.spinedBarkNormal
      : surf === 'velvet_biofilm' || isAnemone
      ? tex.anemoneSkinNormal
      : tex.floraVeinNormal;

  const isCrystalLike = surf === 'crystalline' || leafMorph === 'crystalline_lattice' || isSponge;
  const isMucus = def === 'mucus_sheath';
  const normStrength = isCoral || surf === 'spined_bark' ? 1.18 : isAnemone ? 0.96 : 0.88;

  const stemMat = new THREE.MeshPhysicalMaterial({
    color: genome.baseHex,
    map: tex.floraAlbedo,
    vertexColors: true,
    roughness: isMucus ? 0.16 : isCrystalLike ? 0.22 : isCoral ? 0.62 : isAnemone ? 0.34 : 0.38,
    metalness: isCrystalLike ? 0.18 : 0.04,
    clearcoat: isMucus ? 0.94 : isCrystalLike ? 0.82 : isCoral ? 0.14 : 0.52,
    clearcoatRoughness: 0.24,
    iridescence: isCrystalLike ? 0.72 : isMucus ? 0.54 : 0.16,
    iridescenceIOR: 1.36,
    sheen: isCoral ? 0.12 : 0.45,
    sheenRoughness: 0.5,
    sheenColor: new THREE.Color(genome.accentHex),
    normalMap: primaryNormal,
    normalScale: new THREE.Vector2(normStrength, normStrength),
    emissive: new THREE.Color(genome.baseHex),
    emissiveIntensity: 0.16,
    side: THREE.DoubleSide,
  });

  const accentMat = new THREE.MeshPhysicalMaterial({
    color: genome.accentHex,
    map: tex.floraAlbedo,
    vertexColors: true,
    roughness: isSpore ? 0.32 : 0.28,
    metalness: 0.04,
    clearcoat: 0.56,
    clearcoatRoughness: 0.18,
    iridescence: isCoral ? 0.18 : 0.42,
    iridescenceIOR: 1.33,
    sheen: 0.5,
    sheenColor: new THREE.Color(genome.glowHex),
    normalMap: isSpore ? tex.mushroomGillNormal : primaryNormal,
    normalScale: new THREE.Vector2(isSpore ? 1.05 : 0.82, isSpore ? 1.05 : 0.82),
    emissive: new THREE.Color(genome.accentHex),
    emissiveIntensity: 0.24,
    side: THREE.DoubleSide,
  });

  const translucentMat = new THREE.MeshPhysicalMaterial({
    color: genome.glowHex,
    map: tex.floraAlbedo,
    vertexColors: true,
    roughness: 0.18,
    metalness: 0.02,
    clearcoat: 0.72,
    clearcoatRoughness: 0.12,
    iridescence: 0.62,
    iridescenceIOR: 1.34,
    sheen: 0.65,
    sheenColor: new THREE.Color(genome.glowHex),
    normalMap: tex.floraVeinNormal,
    normalScale: new THREE.Vector2(0.75, 0.75),
    emissive: new THREE.Color(genome.accentHex),
    emissiveIntensity: 0.36,
    transparent: true,
    opacity: 0.74,
    alphaTest: 0.04,
    side: THREE.DoubleSide,
    depthWrite: true,
  });

  if (sharedUniforms) {
    enhanceMaterialWithUnderwaterCaustics(stemMat, sharedUniforms, {
      causticStrength: isCoral ? 0.52 : 0.46,
      subsurfaceStrength: isCoral ? 0.22 : 0.48,
      subsurfaceColor: genome.accentHex,
      ventBounceStrength: 0.38,
    });
    enhanceMaterialWithUnderwaterCaustics(accentMat, sharedUniforms, {
      causticStrength: 0.48,
      subsurfaceStrength: 0.54,
      subsurfaceColor: genome.glowHex,
      ventBounceStrength: 0.38,
    });
    enhanceMaterialWithUnderwaterCaustics(translucentMat, sharedUniforms, {
      causticStrength: 0.38,
      subsurfaceStrength: 0.72,
      subsurfaceColor: genome.glowHex,
      ventBounceStrength: 0.36,
    });
  }

  const baseGlow =
    (genome.metabolism === 'Chemosynthetic' ? 0.92 : 0.58) * (genome.biolumIntensity ?? 0.85);
  const tipColor = new THREE.Color(genome.glowHex);
  if (def === 'alkaloid_toxin') {
    tipColor.lerp(new THREE.Color(0xb9ff4a), 0.35);
  }
  const tipMat = new THREE.MeshStandardMaterial({
    color: tipColor,
    roughness: 0.18,
    metalness: 0.04,
    emissive: tipColor,
    emissiveIntensity: baseGlow,
    transparent: true,
    opacity: 0.95,
    side: THREE.DoubleSide,
  });

  const materials: THREE.Material[] = [stemMat, accentMat, translucentMat, tipMat];
  const fronds: PlantRig['fronds'] = [];
  const kelpTiers: PlantRig['kelpTiers'] = [];

  if (isAnemone) {
    const column = new THREE.Mesh(geo.anemoneColumn, stemMat);
    group.add(column);

    const oralDisc = new THREE.Mesh(geo.anemoneOralDisc, tipMat);
    oralDisc.position.y = 0.385;
    group.add(oralDisc);
  } else {
    const holdfast = new THREE.Mesh(geo.holdfastRoot, stemMat);
    const rootSpread = rootSys === 'deep_rhizome' ? 1.42 : rootSys === 'symbiotic_mycelia' ? 1.24 : 1.05;
    holdfast.scale.set(rootSpread, rootSys === 'deep_rhizome' ? 0.88 : 1.0, rootSpread);
    group.add(holdfast);

    if (rootSys === 'symbiotic_mycelia') {
      // Luminous symbiotic mycelial ring radiating along the root collar
      const myceliaRing = new THREE.Mesh(geo.anemoneOralDisc, tipMat);
      myceliaRing.scale.set(1.38, 0.35, 1.38);
      myceliaRing.position.y = 0.04;
      group.add(myceliaRing);
    }
  }

  if (isAnemone) {
    const outerCount = Math.max(8, genome.frondCount + 4);
    const midCount = Math.max(6, Math.round(outerCount * 0.75));
    const innerCount = 5;

    const tiers = [
      { count: outerCount, radius: 0.23, tilt: 0.62, scaleY: 1.12, scaleXZ: 0.92, mat: stemMat },
      { count: midCount, radius: 0.16, tilt: 0.36, scaleY: 0.88, scaleXZ: 0.78, mat: accentMat },
      { count: innerCount, radius: 0.09, tilt: 0.14, scaleY: 0.62, scaleXZ: 0.64, mat: translucentMat },
    ];

    let idx = 0;
    for (let tIdx = 0; tIdx < tiers.length; tIdx++) {
      const tier = tiers[tIdx];
      for (let i = 0; i < tier.count; i++) {
        const ang = (i / tier.count) * Math.PI * 2 + tIdx * 0.42 + randRange(-0.08, 0.08);
        const piv = new THREE.Group();
        piv.rotation.y = -ang;
        piv.position.set(Math.cos(ang) * tier.radius, 0.37, Math.sin(ang) * tier.radius);

        const tent = new THREE.Mesh(geo.anemoneTentacle, tier.mat);
        tent.scale.set(tier.scaleXZ, tier.scaleY, tier.scaleXZ);
        tent.rotation.z = -tier.tilt;
        piv.add(tent);

        const tip = new THREE.Mesh(geo.coralPolypTip, tipMat);
        tip.scale.setScalar(0.88 - tIdx * 0.14);
        tip.position.set(0.145, 0.70, -0.01);
        tent.add(tip);

        group.add(piv);
        fronds.push({
          pivot: piv,
          phase: idx * 0.72 + tIdx * 1.3,
          baseTilt: tier.tilt,
          isAnemoneTentacle: true,
          swayScale: 1.0 - tIdx * 0.15,
        });
        idx++;
      }
    }
  } else {
    const count = genome.frondCount || 5;
    const morphWidth =
      leafMorph === 'broad_blade'
        ? 1.28
        : leafMorph === 'succulent_lobe'
        ? 1.22
        : leafMorph === 'serrated_frond'
        ? 0.82
        : 1.0;
    const morphHeight =
      leafMorph === 'serrated_frond' ? 1.15 : leafMorph === 'succulent_lobe' ? 0.88 : 1.0;

    for (let i = 0; i < count; i++) {
      const ang = (i / count) * Math.PI * 2 + randRange(-0.18, 0.18);
      const piv = new THREE.Group();
      piv.rotation.y = -ang;
      let baseTilt = 0;
      let thornHost: THREE.Object3D = piv;

      if (genome.form === 'spiral_kelp') {
        piv.position.set(Math.cos(ang) * 0.11, 0.06, Math.sin(ang) * 0.11);
        let parentNode: THREE.Object3D = piv;
        const tiers = 4;

        for (let s = 0; s < tiers; s++) {
          const tierNode = new THREE.Group();
          tierNode.position.y = s === 0 ? 0.0 : 0.52;
          tierNode.rotation.y = 0.56;
          tierNode.rotation.z = -0.06;

          const sc = 1.0 - s * 0.15;

          const stipe = new THREE.Mesh(geo.kelpStipe, stemMat);
          stipe.scale.set(sc * 0.9, 0.85, sc * 0.9);
          tierNode.add(stipe);

          const bladeMat = s === tiers - 1 ? translucentMat : s % 2 === 0 ? stemMat : accentMat;
          const mainBlade = new THREE.Mesh(geo.kelpBlade, bladeMat);
          mainBlade.scale.set(sc * morphWidth, 0.92 * sc * morphHeight, sc);
          mainBlade.position.set(0.02, 0.08, 0);
          mainBlade.rotation.z = -0.14;
          tierNode.add(mainBlade);

          if (s < tiers - 1) {
            const sideBlade = new THREE.Mesh(geo.kelpBlade, s % 2 === 0 ? accentMat : translucentMat);
            sideBlade.scale.set(sc * 0.72, 0.66 * sc, sc * 0.72);
            sideBlade.position.set(-0.02, 0.24, 0.02);
            sideBlade.rotation.y = Math.PI * 0.85;
            sideBlade.rotation.z = 0.28;
            tierNode.add(sideBlade);

            const bladder = new THREE.Mesh(geo.kelpBladder, tipMat);
            bladder.scale.setScalar(0.88 * sc);
            bladder.position.set(0.05, 0.14, 0.02);
            bladder.rotation.z = -0.35;
            tierNode.add(bladder);
          }

          parentNode.add(tierNode);
          kelpTiers.push({ node: tierNode, tier: s, phase: i * 1.15 - s * 0.55 });
          if (s === 0) thornHost = tierNode;
          parentNode = tierNode;
        }
      } else if (isSeagrass) {
        // Dense undulating meadows of serrated ribbon seagrass blades
        baseTilt = (0.14 + (i % 3) * 0.09) * spread;
        const rad = 0.06 + (i % 3) * 0.065 * spread;
        piv.position.set(Math.cos(ang) * rad, 0.05, Math.sin(ang) * rad);

        const blade = new THREE.Mesh(geo.ribbonBlade, i % 2 === 0 ? stemMat : accentMat);
        const hSc = (0.85 + (i % 3) * 0.18) * morphHeight;
        blade.scale.set(morphWidth, hSc, 1.0);
        blade.rotation.z = -baseTilt;
        piv.add(blade);
        thornHost = blade;

        // Delicate translucent twin shoot alongside primary ribbon
        const innerBlade = new THREE.Mesh(geo.ribbonBlade, translucentMat);
        innerBlade.scale.set(0.62 * morphWidth, hSc * 0.72, 0.75);
        innerBlade.rotation.y = 0.55;
        innerBlade.rotation.z = -baseTilt * 0.6;
        piv.add(innerBlade);
      } else if (isSponge) {
        // Fluted porous tubular sea-sponge chimneys with glowing osculum lips
        baseTilt = (0.12 + (i % 2) * 0.14) * spread;
        const rad = i === 0 ? 0.02 : 0.14 * spread;
        piv.position.set(Math.cos(ang) * rad, 0.04, Math.sin(ang) * rad);

        const hSc = (i === 0 ? 1.24 : 0.78 + (i % 3) * 0.16) * morphHeight;
        const wSc = (i === 0 ? 1.15 : 0.82 + (i % 2) * 0.16) * morphWidth;
        const tube = new THREE.Mesh(geo.spongeTube, i % 2 === 0 ? stemMat : accentMat);
        tube.scale.set(wSc, hSc, wSc);
        tube.rotation.z = -baseTilt;
        piv.add(tube);
        thornHost = tube;

        // Glowing crystalline osculum rim at the top opening of each sponge chimney
        const rim = new THREE.Mesh(geo.anemoneOralDisc, tipMat);
        rim.scale.set(0.54, 0.45, 0.54);
        rim.position.set(0.03, 1.16, 0);
        tube.add(rim);
      } else if (genome.form === 'coral_fan') {
        baseTilt = (0.22 + (i % 2) * 0.16) * spread;
        piv.position.set(Math.cos(ang) * 0.08, 0.08, Math.sin(ang) * 0.08);

        const trunk = new THREE.Mesh(geo.coralBranch, stemMat);
        trunk.scale.set(morphWidth * 0.95, morphHeight, morphWidth * 0.95);
        trunk.rotation.z = -baseTilt;
        piv.add(trunk);
        thornHost = trunk;

        for (let p = 0; p < 3; p++) {
          const sidePolyp = new THREE.Mesh(geo.coralPolypCup, tipMat);
          sidePolyp.scale.setScalar(0.62 + (p % 2) * 0.08);
          sidePolyp.position.set((p % 2 === 0 ? 1 : -1) * 0.054, 0.18 + p * 0.12, (p - 1) * 0.025);
          sidePolyp.rotation.z = (p % 2 === 0 ? -1 : 1) * 0.95;
          trunk.add(sidePolyp);
        }

        for (const fork of [-1, 1]) {
          const sub = new THREE.Mesh(geo.coralBranch, accentMat);
          sub.scale.set(0.68, 0.74, 0.68);
          sub.position.set(0.03, 0.44, 0.0);
          sub.rotation.z = fork * 0.50;
          sub.rotation.x = fork * 0.22;
          trunk.add(sub);

          const twig = new THREE.Mesh(geo.coralBranch, accentMat);
          twig.scale.set(0.62, 0.64, 0.62);
          twig.position.set(0.02, 0.34, 0);
          twig.rotation.z = -fork * 0.58;
          twig.rotation.x = 0.24;
          sub.add(twig);

          const twigPolyp = new THREE.Mesh(geo.coralPolypCup, tipMat);
          twigPolyp.scale.setScalar(0.95);
          twigPolyp.position.set(0.04, 0.53, 0.01);
          twig.add(twigPolyp);

          const subPolyp = new THREE.Mesh(geo.coralPolypCup, tipMat);
          subPolyp.scale.setScalar(1.12);
          subPolyp.position.set(0.04, 0.53, 0.01);
          sub.add(subPolyp);
        }

        const crownPolyp = new THREE.Mesh(geo.coralPolypCup, tipMat);
        crownPolyp.scale.setScalar(1.0);
        crownPolyp.position.set(0.04, 0.53, 0.01);
        trunk.add(crownPolyp);
      } else if (genome.form === 'bioluminescent_bulb') {
        baseTilt = (0.24 + randRange(-0.08, 0.1)) * spread;
        piv.position.set(Math.cos(ang) * 0.08, 0.06, Math.sin(ang) * 0.08);

        const st = new THREE.Mesh(geo.bulbStem, stemMat);
        st.scale.set(0.9 * morphWidth, (1.05 + (i % 2) * 0.14) * morphHeight, 0.9 * morphWidth);
        st.rotation.z = -baseTilt;
        piv.add(st);
        thornHost = st;

        for (let b = 0; b < 2; b++) {
          const bract = new THREE.Mesh(geo.bulbPetal, stemMat);
          bract.scale.set(0.65, 0.65, 0.65);
          bract.position.set(0.03, 0.16 + b * 0.12, 0);
          bract.rotation.y = b * Math.PI + 0.6;
          bract.rotation.x = 0.72;
          st.add(bract);
        }

        const bloomNode = new THREE.Group();
        bloomNode.position.set(0.04, 0.60, -0.01);
        st.add(bloomNode);

        const innerCore = new THREE.Mesh(geo.bulbInnerCore, tipMat);
        innerCore.scale.setScalar(0.86);
        bloomNode.add(innerCore);

        const pod = new THREE.Mesh(geo.bulbPod, translucentMat);
        pod.scale.setScalar(0.88);
        bloomNode.add(pod);

        // Delicate glowing botanical stamen filaments curving inside the lantern bloom
        for (let stIdx = 0; stIdx < 5; stIdx++) {
          const stam = new THREE.Mesh(geo.bulbStamen, tipMat);
          stam.rotation.y = (stIdx / 5) * Math.PI * 2 + 0.3;
          stam.position.y = 0.12;
          stam.scale.setScalar(0.82);
          bloomNode.add(stam);
        }

        for (let p = 0; p < 5; p++) {
          const petal = new THREE.Mesh(geo.bulbPetal, accentMat);
          petal.rotation.y = (p / 5) * Math.PI * 2;
          petal.rotation.x = 0.58;
          bloomNode.add(petal);
        }

        for (let p = 0; p < 5; p++) {
          const innerPetal = new THREE.Mesh(geo.bulbPetal, translucentMat);
          innerPetal.scale.set(0.76, 0.82, 0.76);
          innerPetal.rotation.y = ((p + 0.5) / 5) * Math.PI * 2;
          innerPetal.rotation.x = 0.28;
          bloomNode.add(innerPetal);
        }
      } else {
        baseTilt = (0.14 + (i % 2) * 0.12) * spread;
        piv.position.set(Math.cos(ang) * 0.10, 0.05, Math.sin(ang) * 0.10);

        const hScale = (0.92 + (i % 3) * 0.18) * morphHeight;
        const st = new THREE.Mesh(geo.sporeStalk, stemMat);
        st.scale.set(0.92, hScale, 0.92);
        st.rotation.z = -baseTilt;
        piv.add(st);
        thornHost = st;

        const annulus = new THREE.Mesh(geo.sporeAnnulus, translucentMat);
        annulus.position.set(0.032, 0.54, -0.005);
        st.add(annulus);

        const capNode = new THREE.Group();
        capNode.position.set(0.015, 0.74, 0.0);
        capNode.scale.setScalar(0.92 + (i % 2) * 0.14);
        st.add(capNode);

        const cap = new THREE.Mesh(geo.sporeCap, accentMat);
        capNode.add(cap);

        const gills = new THREE.Mesh(geo.sporeGills, tipMat);
        gills.position.y = -0.005;
        capNode.add(gills);

        for (let d = 0; d < 4; d++) {
          const da = (d / 4) * Math.PI * 2 + i;
          const drop = new THREE.Mesh(geo.coralPolypTip, tipMat);
          drop.scale.setScalar(0.45);
          drop.position.set(Math.cos(da) * 0.24, -0.055, Math.sin(da) * 0.24);
          capNode.add(drop);
        }
      }

      // Recombinant botanical defenses & float bladders attached cleanly to each frond!
      if (def === 'calcified_thorns') {
        for (let th = 0; th < 2; th++) {
          const thorn = new THREE.Mesh(geo.plantThorn, tipMat);
          thorn.position.set(0.04, 0.24 + th * 0.28, 0);
          thorn.rotation.y = th * Math.PI + i * 0.7;
          thorn.scale.setScalar(0.92);
          thornHost.add(thorn);
        }
      }
      if (rootSys === 'pneumatocyst_float' && genome.form !== 'spiral_kelp') {
        const floatPod = new THREE.Mesh(geo.kelpBladder, tipMat);
        floatPod.position.set(0.06, 0.42, 0.02);
        floatPod.scale.setScalar(0.95);
        thornHost.add(floatPod);
      }

      group.add(piv);
      fronds.push({
        pivot: piv,
        phase: i * 1.15,
        baseTilt,
        swayScale: isCoral || isSponge ? 0.32 : isSeagrass ? 1.25 : 1.0,
      });
    }
  }

  // Enable soft underwater shadows on primary opaque flora structures
  group.traverse((obj) => {
    if (obj instanceof THREE.Mesh) {
      const mat = obj.material as THREE.Material;
      if (!mat.transparent) {
        obj.castShadow = true;
        obj.receiveShadow = true;
      }
    }
  });
  disableFrustumCulling(group);
  return { group, materials, tipMat, translucentMat, fronds, kelpTiers, baseGlow };
}

export function updatePlantRig(
  rig: PlantRig,
  entity: PlantEntity,
  daylight: number,
  currentStrength: number,
  time: number
): void {
  rig.group.position.copy(entity.position);
  if (entity.wilting) {
    rig.group.position.y -= (1.0 - entity.opacity) * 0.24;
  }
  rig.group.quaternion.copy(entity.quaternion);
  if (entity.wiltTilt > 0.001) {
    rig.group.rotateX(entity.wiltTilt);
  }
  rig.group.scale.setScalar(entity.scale);

  const swayAmp = entity.wilting ? 0.032 : 0.088 + currentStrength * 0.072;
  // Vigorous recoil whip when a herbivore tears a bite off the plant!
  const rustle = entity.rustleAnim;
  // Tighter writhing inward curl when a carnivorous anemone snares & pulls prey
  const curl = entity.snareAnim > 0.01 ? Math.sin(entity.snareAnim * Math.PI) * 0.88 : 0;

  for (let i = 0; i < rig.fronds.length; i++) {
    const fr = rig.fronds[i];
    const amp = swayAmp * (fr.swayScale ?? 1.0);
    const rustleKick =
      rustle > 0.01
        ? Math.sin(rustle * Math.PI * 5.0 + fr.phase) * rustle * 0.34 * (fr.swayScale ?? 1.0)
        : 0;
    fr.pivot.rotation.x = Math.sin(entity.swayPhase + fr.phase) * amp + rustleKick;
    fr.pivot.rotation.z =
      Math.cos(entity.swayPhase * 0.82 + fr.phase) * amp * 0.85 +
      rustleKick * 0.85 +
      (fr.isAnemoneTentacle ? curl : 0);
  }

  // Cascading phase-lag current ripple (+ grazing tug whip) up each kelp frond tier
  for (let i = 0; i < rig.kelpTiers.length; i++) {
    const kt = rig.kelpTiers[i];
    const tierAmp = swayAmp * (0.45 + kt.tier * 0.22);
    const rustleWhip =
      rustle > 0.01 ? Math.sin(rustle * Math.PI * 6.0 + kt.phase) * rustle * (0.2 + kt.tier * 0.1) : 0;
    kt.node.rotation.z = -0.06 + Math.sin(entity.swayPhase * 1.15 + kt.phase) * tierAmp + rustleWhip;
    kt.node.rotation.x = Math.cos(entity.swayPhase * 0.9 + kt.phase) * tierAmp * 0.7 + rustleWhip * 0.7;
  }

  // Nocturnal bioluminescent glow pulse (+ brief bioluminescent flash when grazed/snaring!)
  const nightBoost = 1.0 + (1.0 - daylight) * 1.45;
  const pulse = 0.86 + 0.14 * Math.sin(time * 2.2 + entity.id);
  const stressFlash = 1.0 + rustle * 0.65 + entity.snareAnim * 0.85;

  if (entity.wilting) {
    for (let i = 0; i < rig.materials.length; i++) {
      const m = rig.materials[i] as THREE.MeshStandardMaterial;
      m.transparent = true;
      m.opacity = entity.opacity;
      if ('emissiveIntensity' in m && typeof m.emissiveIntensity === 'number') {
        m.emissiveIntensity = entity.opacity * 0.2;
      }
    }
  } else {
    rig.tipMat.emissiveIntensity = rig.baseGlow * nightBoost * pulse * stressFlash;
    rig.translucentMat.emissiveIntensity = 0.34 * nightBoost * pulse * stressFlash;
  }
}
