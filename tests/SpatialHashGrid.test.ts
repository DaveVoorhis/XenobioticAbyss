import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { SpatialHashGrid } from '../src/core/SpatialHashGrid';

interface MockEnt {
  id: number;
  alive: boolean;
  position: THREE.Vector3;
}

describe('SpatialHashGrid', () => {
  it('accurately queries neighbors within radius across negative and positive cell coordinates', () => {
    const grid = new SpatialHashGrid<MockEnt>(3.0);
    const a: MockEnt = { id: 1, alive: true, position: new THREE.Vector3(-4.2, 2.0, -1.5) };
    const b: MockEnt = { id: 2, alive: true, position: new THREE.Vector3(-2.5, 2.4, -0.8) };
    const far: MockEnt = { id: 3, alive: true, position: new THREE.Vector3(8.0, 9.0, 5.0) };
    const dead: MockEnt = { id: 4, alive: false, position: new THREE.Vector3(-4.0, 2.0, -1.5) };

    grid.insert(a);
    grid.insert(b);
    grid.insert(far);
    grid.insert(dead);

    const results = grid.query(-4.0, 2.0, -1.5, 3.0);
    const ids = results.map((e) => e.id).sort();
    expect(ids).toEqual([1, 2]);
  });

  it('reuses pooled buckets safely after clear()', () => {
    const grid = new SpatialHashGrid<MockEnt>(2.5);
    const e1: MockEnt = { id: 1, alive: true, position: new THREE.Vector3(1, 2, 3) };
    grid.insert(e1);
    expect(grid.query(1, 2, 3, 1.0)).toHaveLength(1);

    grid.clear();
    expect(grid.query(1, 2, 3, 1.0)).toHaveLength(0);

    const e2: MockEnt = { id: 2, alive: true, position: new THREE.Vector3(1, 2, 3) };
    grid.insert(e2);
    const out: MockEnt[] = [];
    grid.query(1, 2, 3, 1.0, out);
    expect(out.map((e) => e.id)).toEqual([2]);
  });
});
