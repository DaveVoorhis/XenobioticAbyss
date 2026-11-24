import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { TANK } from '../src/core/config';
import { buildAquariumEnvironment } from '../src/rendering/EnvironmentBuilder';
import { getGeometryLibrary } from '../src/rendering/GeometryLibrary';
import { createSharedUniforms } from '../src/rendering/Shaders';

describe('GeometryLibrary', () => {
  it('builds all sculpted animal and flora geometries with finite vertices and normals', () => {
    const lib = getGeometryLibrary();
    const entries = Object.entries(lib);
    expect(entries.length).toBeGreaterThanOrEqual(52);

    for (const [name, geo] of entries) {
      const pos = geo.attributes.position;
      const norm = geo.attributes.normal;
      const col = geo.attributes.color;
      expect(pos, `${name} missing position attribute`).toBeDefined();
      expect(pos.count, `${name} has empty geometry`).toBeGreaterThan(0);
      expect(norm, `${name} missing normal attribute`).toBeDefined();
      expect(col, `${name} missing vertex color attribute`).toBeDefined();
      expect(col.count, `${name} color attribute length mismatch`).toBe(pos.count);

      for (let i = 0; i < pos.count; i++) {
        expect(Number.isFinite(pos.getX(i)), `${name} pos.x NaN at ${i}`).toBe(true);
        expect(Number.isFinite(pos.getY(i)), `${name} pos.y NaN at ${i}`).toBe(true);
        expect(Number.isFinite(pos.getZ(i)), `${name} pos.z NaN at ${i}`).toBe(true);
        expect(Number.isFinite(norm.getX(i)), `${name} norm.x NaN at ${i}`).toBe(true);
        expect(Number.isFinite(norm.getY(i)), `${name} norm.y NaN at ${i}`).toBe(true);
        expect(Number.isFinite(norm.getZ(i)), `${name} norm.z NaN at ${i}`).toBe(true);
        expect(Number.isFinite(col.getX(i)), `${name} color.r NaN at ${i}`).toBe(true);
        expect(Number.isFinite(col.getY(i)), `${name} color.g NaN at ${i}`).toBe(true);
        expect(Number.isFinite(col.getZ(i)), `${name} color.b NaN at ${i}`).toBe(true);
      }
    }
  });

  it('provides high-resolution vertex density for hero fauna and flora meshes', () => {
    const lib = getGeometryLibrary();
    expect(lib.fusiformBody.attributes.position.count).toBeGreaterThan(1400);
    expect(lib.medusaBell.attributes.position.count).toBeGreaterThan(1600);
    expect(lib.trilopodPlate.attributes.position.count).toBeGreaterThan(700);
    expect(lib.kelpBlade.attributes.position.count).toBeGreaterThan(600);
    expect(lib.coralPolypCup.attributes.position.count).toBeGreaterThan(240);
    expect(lib.sporeCap.attributes.position.count).toBeGreaterThan(1200);
    expect(lib.anemoneColumn.attributes.position.count).toBeGreaterThan(600);
    // Newly added anatomical detail meshes
    expect(lib.toothRow.attributes.position.count).toBeGreaterThan(100);
    expect(lib.gillArch.attributes.position.count).toBeGreaterThan(100);
    expect(lib.medusaManubrium.attributes.position.count).toBeGreaterThan(180);
    expect(lib.eelFangs.attributes.position.count).toBeGreaterThan(100);
    expect(lib.trilopodSternum.attributes.position.count).toBeGreaterThan(80);
    expect(lib.trilopodCompoundEye.attributes.position.count).toBeGreaterThan(100);
    expect(lib.bulbStamen.attributes.position.count).toBeGreaterThan(40);
    expect(lib.eggEmbryo.attributes.position.count).toBeGreaterThan(250);
  });
});

describe('EnvironmentBuilder (Genesis Vent & Aquarium)', () => {
  it('constructs the Genesis Vent and aquarium meshes with finite attributes and updates cleanly', () => {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x041d30);
    scene.fog = new THREE.FogExp2(0x041d30, 0.023);
    const shared = createSharedUniforms();
    const rig = buildAquariumEnvironment(scene, shared);

    let meshCount = 0;
    let ventBasaltCount = 0;
    scene.traverse((obj) => {
      if (obj instanceof THREE.Mesh || obj instanceof THREE.Points) {
        meshCount++;
        const geo = obj.geometry;
        const pos = geo.attributes.position;
        expect(pos).toBeDefined();
        expect(pos.count).toBeGreaterThan(0);

        const norm = geo.attributes.normal;
        const ventMeta = geo.attributes.aVentMeta;
        if (ventMeta) {
          ventBasaltCount++;
          expect(ventMeta.count).toBe(pos.count);
        }

        for (let i = 0; i < pos.count; i++) {
          expect(Number.isFinite(pos.getX(i))).toBe(true);
          expect(Number.isFinite(pos.getY(i))).toBe(true);
          expect(Number.isFinite(pos.getZ(i))).toBe(true);
          if (norm) {
            expect(Number.isFinite(norm.getX(i))).toBe(true);
            expect(Number.isFinite(norm.getY(i))).toBe(true);
            expect(Number.isFinite(norm.getZ(i))).toBe(true);
          }
          if (ventMeta) {
            expect(Number.isFinite(ventMeta.getX(i))).toBe(true);
            expect(Number.isFinite(ventMeta.getY(i))).toBe(true);
            expect(Number.isFinite(ventMeta.getZ(i))).toBe(true);
          }
        }
      }
    });

    // Main mound + primary chimney + 3 parasitic side spires
    expect(ventBasaltCount).toBe(5);
    expect(meshCount).toBeGreaterThan(60);

    // Step across daylight, dusk, and night with varying current and vent pulse energy
    rig.update(0.016, 0.75, 0.9, 0.95, 0.48);
    rig.update(0.016, 0.4, 0.35, 0.15, 0.05);
    expect(Number.isFinite(rig.ventLight.intensity)).toBe(true);
    expect(Number.isFinite(rig.ventPlumeMat.uniforms.uCurrent.value)).toBe(true);

    // Verify dormant vent (pulse = 0) completely turns off vent illumination and molten core
    rig.update(0.016, 0.5, 0.0, 0.9, 0.5);
    expect(rig.ventLight.intensity).toBe(0);
    expect(rig.ventCore.visible).toBe(false);

    // Verify horizontally unbounded water surface & seabed extending to worldRadius with zero tank walls
    scene.updateMatrixWorld(true);
    const v = new THREE.Vector3();
    let foundUnboundedWaterSurface = false;
    let foundUnboundedSeabed = false;
    let foundTankWall = false;
    scene.traverse((obj) => {
      if (!(obj instanceof THREE.Mesh)) return;
      const pos = obj.geometry.attributes.position;
      let maxR = 0;
      let minY = Infinity;
      let maxY = -Infinity;
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(obj.matrixWorld);
        const r = Math.hypot(v.x, v.z);
        if (r > maxR) maxR = r;
        if (v.y < minY) minY = v.y;
        if (v.y > maxY) maxY = v.y;
      }
      if (
        Math.abs(minY - TANK.waterY) < 0.02 &&
        Math.abs(maxY - TANK.waterY) < 0.02 &&
        maxR >= TANK.worldRadius * 0.95
      ) {
        foundUnboundedWaterSurface = true;
      } else if (maxR >= TANK.worldRadius * 0.95 && maxY < TANK.waterY - 2.0 && minY > -3.0) {
        foundUnboundedSeabed = true;
      }
      if (
        obj.geometry instanceof THREE.CylinderGeometry &&
        (obj.geometry.parameters.radiusTop > TANK.coreRadius * 0.8 ||
          obj.geometry.parameters.radiusBottom > TANK.coreRadius * 0.8)
      ) {
        foundTankWall = true;
      }
    });
    expect(foundUnboundedWaterSurface).toBe(true);
    expect(foundUnboundedSeabed).toBe(true);
    expect(foundTankWall).toBe(false);
  });
});
