import * as THREE from 'three';
import { isFiniteVec3 } from './math';

export interface SpatialEntity {
  alive: boolean;
  position: THREE.Vector3;
}

const CELL_OFFSET = 512; // Supports cell coordinates in [-512, 511] per axis
const CELL_STRIDE_Y = 1024;
const CELL_STRIDE_Z = 1024 * 1024;

/**
 * Zero-string-allocation 3D spatial hash grid.
 * Packs integer cell coordinates into a single safe JS integer key and pools
 * bucket arrays between frames to avoid GC pauses at 60+ FPS.
 */
export class SpatialHashGrid<T extends SpatialEntity> {
  private readonly invCell: number;
  private readonly buckets = new Map<number, T[]>();
  private readonly arrayPool: T[][] = [];

  constructor(cellSize = 3.0) {
    this.invCell = 1.0 / cellSize;
  }

  private static hashCell(cx: number, cy: number, cz: number): number {
    return (cx + CELL_OFFSET) + (cy + CELL_OFFSET) * CELL_STRIDE_Y + (cz + CELL_OFFSET) * CELL_STRIDE_Z;
  }

  clear(): void {
    for (const arr of this.buckets.values()) {
      arr.length = 0;
      this.arrayPool.push(arr);
    }
    this.buckets.clear();
  }

  insert(entity: T): void {
    if (!entity || !entity.alive || !isFiniteVec3(entity.position)) return;
    const cx = Math.floor(entity.position.x * this.invCell);
    const cy = Math.floor(entity.position.y * this.invCell);
    const cz = Math.floor(entity.position.z * this.invCell);
    const key = SpatialHashGrid.hashCell(cx, cy, cz);

    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = this.arrayPool.pop() ?? [];
      this.buckets.set(key, bucket);
    }
    bucket.push(entity);
  }

  query(x: number, y: number, z: number, radius: number, out: T[] = []): T[] {
    out.length = 0;
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z) || !Number.isFinite(radius) || radius <= 0) {
      return out;
    }
    const rSq = radius * radius;
    const minX = Math.floor((x - radius) * this.invCell);
    const maxX = Math.floor((x + radius) * this.invCell);
    const minY = Math.floor((y - radius) * this.invCell);
    const maxY = Math.floor((y + radius) * this.invCell);
    const minZ = Math.floor((z - radius) * this.invCell);
    const maxZ = Math.floor((z + radius) * this.invCell);

    for (let cx = minX; cx <= maxX; cx++) {
      for (let cy = minY; cy <= maxY; cy++) {
        for (let cz = minZ; cz <= maxZ; cz++) {
          const bucket = this.buckets.get(SpatialHashGrid.hashCell(cx, cy, cz));
          if (!bucket) continue;
          for (let i = 0; i < bucket.length; i++) {
            const e = bucket[i];
            if (!e.alive) continue;
            const dx = e.position.x - x;
            const dy = e.position.y - y;
            const dz = e.position.z - z;
            if (dx * dx + dy * dy + dz * dz <= rSq) {
              out.push(e);
            }
          }
        }
      }
    }
    return out;
  }
}
