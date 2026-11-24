import * as THREE from 'three';
import type { SkinPattern } from '../genetics/types';

export interface ProceduralTextures {
  readonly skinPatterns: Record<SkinPattern, THREE.CanvasTexture>;
  readonly skinAlbedo: THREE.CanvasTexture;
  readonly floraAlbedo: THREE.CanvasTexture;
  readonly fleshAlbedo: THREE.CanvasTexture;
  readonly fleshNormal: THREE.CanvasTexture;
  readonly scaleBump: THREE.CanvasTexture;
  readonly scaleNormal: THREE.CanvasTexture;
  readonly scaleRoughness: THREE.CanvasTexture;
  readonly chitinBump: THREE.CanvasTexture;
  readonly chitinNormal: THREE.CanvasTexture;
  readonly membraneAlpha: THREE.CanvasTexture;
  readonly floraVein: THREE.CanvasTexture;
  readonly floraVeinNormal: THREE.CanvasTexture;
  readonly coralPoreBump: THREE.CanvasTexture;
  readonly coralPoreNormal: THREE.CanvasTexture;
  readonly anemoneSkinBump: THREE.CanvasTexture;
  readonly anemoneSkinNormal: THREE.CanvasTexture;
  readonly mushroomGillBump: THREE.CanvasTexture;
  readonly mushroomGillNormal: THREE.CanvasTexture;
  readonly crystalFacetBump: THREE.CanvasTexture;
  readonly crystalFacetNormal: THREE.CanvasTexture;
  readonly spinedBarkBump: THREE.CanvasTexture;
  readonly spinedBarkNormal: THREE.CanvasTexture;
  readonly sandNormal: THREE.CanvasTexture;
  readonly rockNormal: THREE.CanvasTexture;
  readonly eyeIris: THREE.CanvasTexture;
  readonly eyeIrisPredator: THREE.CanvasTexture;
  readonly bubbleSprite: THREE.CanvasTexture;
  readonly marineSnowSprite: THREE.CanvasTexture;
}

/**
 * Returns true when running in a browser DOM environment capable of generating CanvasTextures.
 */
export function hasCanvasSupport(): boolean {
  return typeof document !== 'undefined' && typeof document.createElement === 'function';
}

function makeCanvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  return [canvas, ctx];
}

function makeRng(seedStart: number): () => number {
  let seed = seedStart;
  return () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
}

function finalizeTexture(
  canvas: HTMLCanvasElement,
  repeatX = 1,
  repeatY = 1,
  isColor = false,
  clampT = false
): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = clampT ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping;
  tex.repeat.set(repeatX, repeatY);
  tex.anisotropy = 8;
  if (isColor) {
    tex.colorSpace = THREE.SRGBColorSpace;
  }
  tex.needsUpdate = true;
  return tex;
}

/**
 * Converts a grayscale heightfield canvas into a crisp tangent-space RGB NormalMap
 * using a tile-wrapping 3x3 Sobel gradient kernel for photorealistic micro-surface lighting.
 */
function heightCanvasToNormalTexture(
  heightCanvas: HTMLCanvasElement,
  strength = 2.4,
  repeatX = 1,
  repeatY = 1,
  clampT = false
): THREE.CanvasTexture {
  const w = heightCanvas.width;
  const h = heightCanvas.height;
  const srcCtx = heightCanvas.getContext('2d')!;
  const src = srcCtx.getImageData(0, 0, w, h).data;

  const [outCanvas, outCtx] = makeCanvas(w, h);
  const outImg = outCtx.createImageData(w, h);
  const dst = outImg.data;

  const sample = (x: number, y: number): number => {
    const wx = ((x % w) + w) % w;
    const wy = clampT ? Math.max(0, Math.min(h - 1, y)) : ((y % h) + h) % h;
    return src[(wy * w + wx) * 4] / 255.0;
  };

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const tl = sample(x - 1, y - 1);
      const t = sample(x, y - 1);
      const tr = sample(x + 1, y - 1);
      const l = sample(x - 1, y);
      const r = sample(x + 1, y);
      const bl = sample(x - 1, y + 1);
      const b = sample(x, y + 1);
      const br = sample(x + 1, y + 1);

      const dX = (tr + 2.0 * r + br) - (tl + 2.0 * l + bl);
      const dY = (bl + 2.0 * b + br) - (tl + 2.0 * t + tr);

      let nx = -dX * strength;
      let ny = dY * strength;
      let nz = 1.0;
      const invLen = 1.0 / Math.hypot(nx, ny, nz);
      nx *= invLen;
      ny *= invLen;
      nz *= invLen;

      const idx = (y * w + x) * 4;
      dst[idx] = Math.round((nx * 0.5 + 0.5) * 255);
      dst[idx + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      dst[idx + 2] = Math.round((nz * 0.5 + 0.5) * 255);
      dst[idx + 3] = 255;
    }
  }
  outCtx.putImageData(outImg, 0, 0);
  return finalizeTexture(outCanvas, repeatX, repeatY, false, clampT);
}

/**
 * 512x512 high-resolution biological skin bioluminescence pattern maps.
 */
function createPatternTexture(pattern: SkinPattern): THREE.CanvasTexture {
  const S = 512;
  const [canvas, ctx] = makeCanvas(S, S);
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, S, S);
  const seedMap: Record<SkinPattern, number> = {
    striped: 101,
    spotted: 1337,
    iridescent: 4099,
    photophore: 5151,
    marbled: 6203,
    chevron: 7309,
    ocellated: 8423,
    abyssal_veins: 9547,
  };
  const rand = makeRng(seedMap[pattern]);

  if (pattern === 'striped') {
    // Organic undulating reef/tiger bands with delicate marginal speckles
    const bands = 11;
    for (let i = 0; i < bands; i++) {
      const baseY = ((i + 0.5) / bands) * S;
      const thickness = 10 + (i % 3) * 3.5;
      const grad = ctx.createLinearGradient(0, baseY - thickness * 1.4, 0, baseY + thickness * 1.4);
      grad.addColorStop(0, 'rgba(255,255,255,0)');
      grad.addColorStop(0.3, 'rgba(220,245,255,0.45)');
      grad.addColorStop(0.5, 'rgba(255,255,255,0.96)');
      grad.addColorStop(0.7, 'rgba(220,245,255,0.45)');
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = grad;

      ctx.beginPath();
      for (let x = 0; x <= S; x += 8) {
        const wave =
          Math.sin((x / S) * Math.PI * 4 + i * 0.85) * 11 +
          Math.sin((x / S) * Math.PI * 8 - i * 1.3) * 3.5;
        const wy = baseY + wave;
        if (x === 0) ctx.moveTo(x, wy - thickness);
        else ctx.lineTo(x, wy - thickness);
      }
      for (let x = S; x >= 0; x -= 8) {
        const wave =
          Math.sin((x / S) * Math.PI * 4 + i * 0.85) * 11 +
          Math.sin((x / S) * Math.PI * 8 - i * 1.3) * 3.5;
        const wy = baseY + wave;
        ctx.lineTo(x, wy + thickness);
      }
      ctx.closePath();
      ctx.fill();
    }

    // Fine chromatophore sparkle dots along stripe borders
    for (let i = 0; i < 180; i++) {
      const x = rand() * S;
      const y = rand() * S;
      const r = 1.5 + rand() * 3.2;
      const g = ctx.createRadialGradient(x, y, 0.2, x, y, r);
      g.addColorStop(0, 'rgba(255,255,255,0.75)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (pattern === 'spotted') {
    // Biological ocelli (ringed leopard/reef spots + tiny satellite micro-spots)
    for (let i = 0; i < 64; i++) {
      const x = rand() * S;
      const y = rand() * S;
      const r = 9 + rand() * 22;
      const isRing = rand() < 0.48;
      const g = ctx.createRadialGradient(x, y, r * 0.08, x, y, r);
      if (isRing) {
        g.addColorStop(0, 'rgba(255,255,255,0.35)');
        g.addColorStop(0.42, 'rgba(255,255,255,0.98)');
        g.addColorStop(0.68, 'rgba(210,255,255,0.45)');
        g.addColorStop(1, 'rgba(0,0,0,0)');
      } else {
        g.addColorStop(0, 'rgba(255,255,255,1)');
        g.addColorStop(0.5, 'rgba(235,255,255,0.62)');
        g.addColorStop(1, 'rgba(0,0,0,0)');
      }
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    // Fine bioluminescent freckling
    for (let i = 0; i < 240; i++) {
      const x = rand() * S;
      const y = rand() * S;
      const r = 1.2 + rand() * 3.8;
      const g = ctx.createRadialGradient(x, y, 0.1, x, y, r);
      g.addColorStop(0, 'rgba(255,255,255,0.85)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (pattern === 'photophore') {
    // Deep-sea lateral line glowing photophore arrays with subtle connecting nerve veins
    const rows = 6;
    for (let row = 0; row < rows; row++) {
      const x = ((row + 0.5) / rows) * S;
      ctx.strokeStyle = 'rgba(255,255,255,0.22)';
      ctx.lineWidth = 2.0;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, S);
      ctx.stroke();

      const dots = 22;
      for (let k = 0; k < dots; k++) {
        const y = ((k + 0.5) / dots) * S;
        const r = k % 2 === 0 ? 9.5 : 5.5;
        const g = ctx.createRadialGradient(x, y, 0.8, x, y, r);
        g.addColorStop(0, 'rgba(255,255,255,1)');
        g.addColorStop(0.35, 'rgba(255,255,255,0.82)');
        g.addColorStop(0.7, 'rgba(180,245,255,0.25)');
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  } else if (pattern === 'marbled') {
    // Swirling reef-cuttlefish organic marble ribbons
    const ribbons = 16;
    for (let i = 0; i < ribbons; i++) {
      const startY = (i / ribbons) * S;
      ctx.strokeStyle = i % 2 === 0 ? 'rgba(255,255,255,0.82)' : 'rgba(195,242,255,0.52)';
      ctx.lineWidth = 4 + (i % 3) * 4.5;
      ctx.beginPath();
      for (let x = 0; x <= S; x += 8) {
        const nx = (x / S) * Math.PI * 2;
        const y =
          (startY +
            Math.sin(nx * 2 + i * 0.9) * 34 +
            Math.cos(nx * 5 - i * 1.4) * 14 +
            S) %
          S;
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    for (let i = 0; i < 120; i++) {
      const x = rand() * S;
      const y = rand() * S;
      const r = 4 + rand() * 14;
      const g = ctx.createRadialGradient(x, y, 0.5, x, y, r);
      g.addColorStop(0, 'rgba(255,255,255,0.65)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (pattern === 'chevron') {
    // Hydrodynamic directional chevron V-bands with luminous flank edges
    const bands = 10;
    for (let i = 0; i < bands; i++) {
      const cy = ((i + 0.5) / bands) * S;
      ctx.strokeStyle = 'rgba(255,255,255,0.92)';
      ctx.lineWidth = 10;
      ctx.beginPath();
      ctx.moveTo(0, cy - 26);
      ctx.lineTo(S * 0.5, cy + 28);
      ctx.lineTo(S, cy - 26);
      ctx.stroke();

      ctx.strokeStyle = 'rgba(180,248,255,0.45)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(0, cy - 10);
      ctx.lineTo(S * 0.5, cy + 44);
      ctx.lineTo(S, cy - 10);
      ctx.stroke();
    }
  } else if (pattern === 'ocellated') {
    // Large defensive decoy eyespots with double luminous halos
    for (let i = 0; i < 24; i++) {
      const x = rand() * S;
      const y = rand() * S;
      const r = 18 + rand() * 26;
      const g = ctx.createRadialGradient(x, y, r * 0.1, x, y, r);
      g.addColorStop(0, 'rgba(255,255,255,0.98)');
      g.addColorStop(0.28, 'rgba(60,80,100,0.12)');
      g.addColorStop(0.58, 'rgba(255,255,255,0.96)');
      g.addColorStop(0.76, 'rgba(180,245,255,0.45)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (pattern === 'abyssal_veins') {
    // Branching bioluminescent neural capillary web
    for (let i = 0; i < 38; i++) {
      let x = rand() * S;
      let y = rand() * S;
      let ang = rand() * Math.PI * 2;
      ctx.strokeStyle = i % 3 === 0 ? 'rgba(255,255,255,0.92)' : 'rgba(185,245,255,0.58)';
      ctx.lineWidth = i % 3 === 0 ? 3.2 : 1.6;
      ctx.beginPath();
      ctx.moveTo(x, y);
      for (let s = 0; s < 14; s++) {
        ang += (rand() - 0.5) * 0.95;
        x += Math.cos(ang) * 18;
        y += Math.sin(ang) * 18;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  } else {
    // Iridescent organic reticulated reef-caustic & scale shimmer web
    const step = 16;
    for (let y = 0; y < S; y += step) {
      for (let x = 0; x < S; x += step) {
        const nx = (x / S) * Math.PI * 2;
        const ny = (y / S) * Math.PI * 2;
        const v1 = Math.sin(nx * 3 + Math.cos(ny * 4) * 1.8);
        const v2 = Math.cos(ny * 5 - Math.sin(nx * 3) * 1.6);
        const ridge = Math.pow(Math.max(0, 1.0 - Math.abs(v1 + v2) * 0.65), 2.2);
        const rad = 14;
        const g = ctx.createRadialGradient(x + 8, y + 8, 1, x + 8, y + 8, rad);
        g.addColorStop(0, `rgba(255,255,255,${(ridge * 0.88).toFixed(3)})`);
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.fillRect(x - 6, y - 6, 28, 28);
      }
    }
  }

  return finalizeTexture(canvas, 1, 1, false, false);
}

/**
 * 512x512 organic chromatophore mottling & subtle countershading albedo multiplier
 * so animal bodies have rich natural tonal variation rather than flat plastic color.
 */
function createSkinAlbedoTexture(): THREE.CanvasTexture {
  const S = 512;
  const [canvas, ctx] = makeCanvas(S, S);
  const rand = makeRng(7721);

  // Realistic marine countershading (deeper dorsal back -> pearlescent mid-flank -> luminous pale belly)
  const baseGrad = ctx.createLinearGradient(0, 0, S, 0);
  baseGrad.addColorStop(0.0, '#aeb9c4');
  baseGrad.addColorStop(0.18, '#dce5ec');
  baseGrad.addColorStop(0.32, '#f4f9fc');
  baseGrad.addColorStop(0.50, '#b8c4cf');
  baseGrad.addColorStop(0.68, '#f6fbfe');
  baseGrad.addColorStop(0.82, '#dde6ed');
  baseGrad.addColorStop(1.0, '#aeb9c4');
  ctx.fillStyle = baseGrad;
  ctx.fillRect(0, 0, S, S);

  // Soft biological dermal mottling patches
  for (let i = 0; i < 160; i++) {
    const x = rand() * S;
    const y = rand() * S;
    const r = 14 + rand() * 44;
    const bright = rand() > 0.48;
    const g = ctx.createRadialGradient(x, y, 2, x, y, r);
    g.addColorStop(0, bright ? 'rgba(255,255,255,0.16)' : 'rgba(55,75,92,0.16)');
    g.addColorStop(1, 'rgba(128,128,128,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  // Delicate lateral-line sensory pore chain along the flanks
  for (const flankX of [S * 0.25, S * 0.75]) {
    ctx.strokeStyle = 'rgba(255,255,255,0.22)';
    ctx.lineWidth = 2.0;
    ctx.beginPath();
    ctx.moveTo(flankX, 0);
    ctx.lineTo(flankX, S);
    ctx.stroke();
    for (let y = 8; y < S; y += 12) {
      ctx.fillStyle = 'rgba(22,38,52,0.28)';
      ctx.beginPath();
      ctx.arc(flankX, y, 1.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // High-density biological micro chromatophore & iridophore speckling
  for (let i = 0; i < 1600; i++) {
    const x = rand() * S;
    const y = rand() * S;
    const r = 0.7 + rand() * 2.2;
    const pick = rand();
    ctx.fillStyle =
      pick > 0.62
        ? 'rgba(255,255,255,0.18)'
        : pick > 0.26
        ? 'rgba(22,36,48,0.15)'
        : 'rgba(180,235,255,0.14)';
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  return finalizeTexture(canvas, 1, 1, true, false);
}

/**
 * 512x512 imbricated overlapping marine scale bump + matching roughness map.
 */
function createScaleMaps(): {
  bump: THREE.CanvasTexture;
  normal: THREE.CanvasTexture;
  roughness: THREE.CanvasTexture;
} {
  const S = 512;
  const [bCanvas, bCtx] = makeCanvas(S, S);
  const [rCanvas, rCtx] = makeCanvas(S, S);

  bCtx.fillStyle = '#4c4c4c';
  bCtx.fillRect(0, 0, S, S);
  rCtx.fillStyle = '#5c5c5c'; // Low roughness (wet glossy)
  rCtx.fillRect(0, 0, S, S);

  const step = 20;
  const rows = Math.ceil(S / (step * 0.82)) + 2;
  const cols = Math.ceil(S / step) + 2;

  for (let row = -1; row < rows; row++) {
    const xOff = (row & 1) ? step * 0.5 : 0;
    for (let col = -1; col < cols; col++) {
      const cx = col * step + xOff;
      const cy = row * (step * 0.82);

      // Raised overlapping scale arch with dark crease border
      const grad = bCtx.createRadialGradient(cx, cy - 3.5, 1.5, cx, cy, step * 0.68);
      grad.addColorStop(0.0, '#f4f4f4');
      grad.addColorStop(0.45, '#c2c2c2');
      grad.addColorStop(0.82, '#787878');
      grad.addColorStop(1.0, '#242424');
      bCtx.fillStyle = grad;
      bCtx.beginPath();
      bCtx.arc(cx, cy, step * 0.66, 0, Math.PI * 2);
      bCtx.fill();

      // Fine radial growth striae inside each scale
      bCtx.strokeStyle = 'rgba(255,255,255,0.22)';
      bCtx.lineWidth = 0.8;
      for (let k = -2; k <= 2; k++) {
        bCtx.beginPath();
        bCtx.moveTo(cx, cy + 4);
        bCtx.lineTo(cx + k * 3.2, cy - step * 0.52);
        bCtx.stroke();
      }

      // Glossy scale crown, slightly rougher crease
      const rGrad = rCtx.createRadialGradient(cx, cy - 3, 1, cx, cy, step * 0.66);
      rGrad.addColorStop(0.0, '#222222'); // Wet mirror-like scale center
      rGrad.addColorStop(0.72, '#4a4a4a');
      rGrad.addColorStop(1.0, '#969696'); // Matte scale seam
      rCtx.fillStyle = rGrad;
      rCtx.beginPath();
      rCtx.arc(cx, cy, step * 0.66, 0, Math.PI * 2);
      rCtx.fill();
    }
  }

  return {
    bump: finalizeTexture(bCanvas, 2.5, 2.5, false, false),
    normal: heightCanvasToNormalTexture(bCanvas, 2.6, 2.5, 2.5, false),
    roughness: finalizeTexture(rCanvas, 2.5, 2.5, false, false),
  };
}

/**
 * 512x512 calcified chitin carapace bump map for armored trilopods (ridges, sutures, micro-pores).
 */
function createChitinBumpTexture(): THREE.CanvasTexture {
  const S = 512;
  const [canvas, ctx] = makeCanvas(S, S);
  const rand = makeRng(9041);

  ctx.fillStyle = '#888888';
  ctx.fillRect(0, 0, S, S);

  // Transverse calcified growth ridges
  for (let y = 0; y < S; y += 24) {
    const g = ctx.createLinearGradient(0, y, 0, y + 24);
    g.addColorStop(0, '#5a5a5a');
    g.addColorStop(0.35, '#c6c6c6');
    g.addColorStop(0.75, '#929292');
    g.addColorStop(1, '#5a5a5a');
    ctx.fillStyle = g;
    ctx.fillRect(0, y, S, 24);
  }

  // Crustacean sensory tubercles and micro-pits
  for (let i = 0; i < 420; i++) {
    const x = rand() * S;
    const y = rand() * S;
    const r = 1.6 + rand() * 4.5;
    const raised = rand() > 0.35;
    const g = ctx.createRadialGradient(x, y, 0.3, x, y, r);
    if (raised) {
      g.addColorStop(0, '#efefef');
      g.addColorStop(0.65, '#9a9a9a');
      g.addColorStop(1, 'rgba(136,136,136,0)');
    } else {
      g.addColorStop(0, '#363636');
      g.addColorStop(0.7, '#6c6c6c');
      g.addColorStop(1, 'rgba(136,136,136,0)');
    }
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  return finalizeTexture(canvas, 2, 2, false, false);
}

/**
 * 512x512 delicate fin & jellyfish bell membrane with branching cartilaginous rays (lepidotrichia)
 * and gossamer feathered trailing margins.
 */
function createMembraneTexture(): THREE.CanvasTexture {
  const S = 512;
  const [canvas, ctx] = makeCanvas(S, S);

  const bg = ctx.createLinearGradient(0, 0, 0, S);
  bg.addColorStop(0.0, 'rgba(255,255,255,0.96)');
  bg.addColorStop(0.45, 'rgba(235,248,255,0.78)');
  bg.addColorStop(0.82, 'rgba(205,240,255,0.46)');
  bg.addColorStop(1.0, 'rgba(180,232,255,0.14)');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, S, S);

  // Delicate branching cartilaginous fin rays
  const rayCount = 28;
  for (let i = 0; i < rayCount; i++) {
    const x = ((i + 0.5) / rayCount) * S;
    ctx.strokeStyle = 'rgba(255,255,255,0.72)';
    ctx.lineWidth = 2.6;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    const midX = x + Math.sin(i * 1.1) * 5;
    ctx.quadraticCurveTo(midX, S * 0.45, x, S * 0.65);
    ctx.stroke();

    // Bifurcated delicate secondary tips near trailing edge
    ctx.strokeStyle = 'rgba(255,255,255,0.48)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(x, S * 0.62);
    ctx.quadraticCurveTo(x - 4, S * 0.82, x - 6, S);
    ctx.moveTo(x, S * 0.62);
    ctx.quadraticCurveTo(x + 4, S * 0.82, x + 6, S);
    ctx.stroke();
  }

  // Fine cross-striation banding (segmented fin-ray joints)
  ctx.strokeStyle = 'rgba(255,255,255,0.16)';
  ctx.lineWidth = 1.2;
  for (let y = 24; y < S; y += 22) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(S, y);
    ctx.stroke();
  }

  return finalizeTexture(canvas, 1, 1, false, true);
}

/**
 * 512x512 high-resolution marine flora leaf & kelp venation + cellular epidermis bump.
 */
function createFloraVeinTexture(): THREE.CanvasTexture {
  const S = 512;
  const [canvas, ctx] = makeCanvas(S, S);
  const rand = makeRng(3141);

  ctx.fillStyle = '#7e7e7e';
  ctx.fillRect(0, 0, S, S);

  // Subtle cellular epidermis micro-dimples
  for (let i = 0; i < 600; i++) {
    const x = rand() * S;
    const y = rand() * S;
    const rx = 3 + rand() * 6;
    const ry = 6 + rand() * 14;
    ctx.fillStyle = rand() > 0.5 ? 'rgba(175,175,175,0.22)' : 'rgba(85,85,85,0.22)';
    ctx.beginPath();
    ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // Prominent central midrib
  const midGrad = ctx.createLinearGradient(S * 0.45, 0, S * 0.55, 0);
  midGrad.addColorStop(0, 'rgba(255,255,255,0)');
  midGrad.addColorStop(0.5, 'rgba(255,255,255,0.95)');
  midGrad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = midGrad;
  ctx.fillRect(S * 0.45, 0, S * 0.1, S);

  // Primary + secondary dichotomous veins arching toward margins
  for (let y = 18; y < S; y += 22) {
    ctx.strokeStyle = 'rgba(240,240,240,0.82)';
    ctx.lineWidth = 3.2;
    ctx.beginPath();
    ctx.moveTo(S * 0.5, y);
    ctx.bezierCurveTo(S * 0.36, y - 6, S * 0.18, y - 22, 10, y - 42);
    ctx.moveTo(S * 0.5, y);
    ctx.bezierCurveTo(S * 0.64, y - 6, S * 0.82, y - 22, S - 10, y - 42);
    ctx.stroke();

    // Fine tertiary veinlets
    ctx.strokeStyle = 'rgba(215,215,215,0.45)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(S * 0.32, y - 12);
    ctx.lineTo(S * 0.22, y - 2);
    ctx.moveTo(S * 0.68, y - 12);
    ctx.lineTo(S * 0.78, y - 2);
    ctx.stroke();
  }

  return finalizeTexture(canvas, 1, 1, false, false);
}

/**
 * 512x512 calcareous coral skeleton bump map with star-shaped corallite cups & ridges.
 */
function createCoralPoreBumpTexture(): THREE.CanvasTexture {
  const S = 512;
  const [canvas, ctx] = makeCanvas(S, S);
  const rand = makeRng(5521);

  ctx.fillStyle = '#929292';
  ctx.fillRect(0, 0, S, S);

  // Longitudinal calcareous striations
  ctx.strokeStyle = 'rgba(210,210,210,0.28)';
  ctx.lineWidth = 2;
  for (let x = 0; x < S; x += 8) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.bezierCurveTo(x + Math.sin(x) * 6, S * 0.33, x - Math.cos(x) * 6, S * 0.66, x, S);
    ctx.stroke();
  }

  // Star-shaped corallite pore cups
  for (let i = 0; i < 110; i++) {
    const cx = rand() * S;
    const cy = rand() * S;
    const r = 7 + rand() * 11;

    // Raised rim
    const rim = ctx.createRadialGradient(cx, cy, r * 0.3, cx, cy, r);
    rim.addColorStop(0.0, '#1e1e1e'); // Deep cup center
    rim.addColorStop(0.55, '#424242');
    rim.addColorStop(0.82, '#ececec'); // Calcified septa rim
    rim.addColorStop(1.0, 'rgba(146,146,146,0)');
    ctx.fillStyle = rim;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();

    // Radial septa teeth inside corallite
    ctx.strokeStyle = '#dcdcdc';
    ctx.lineWidth = 1.2;
    for (let s = 0; s < 8; s++) {
      const a = (s / 8) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * r * 0.25, cy + Math.sin(a) * r * 0.25);
      ctx.lineTo(cx + Math.cos(a) * r * 0.85, cy + Math.sin(a) * r * 0.85);
      ctx.stroke();
    }
  }

  return finalizeTexture(canvas, 2, 2, false, false);
}

/**
 * 512x512 fleshy anemone column & tentacle bump map (muscular striations + verrucae tubercles).
 */
function createAnemoneSkinBumpTexture(): THREE.CanvasTexture {
  const S = 512;
  const [canvas, ctx] = makeCanvas(S, S);
  const rand = makeRng(8191);

  ctx.fillStyle = '#7c7c7c';
  ctx.fillRect(0, 0, S, S);

  // Longitudinal muscular folds
  for (let x = 0; x < S; x += 16) {
    const g = ctx.createLinearGradient(x, 0, x + 16, 0);
    g.addColorStop(0, '#545454');
    g.addColorStop(0.5, '#b6b6b6');
    g.addColorStop(1, '#545454');
    ctx.fillStyle = g;
    ctx.fillRect(x, 0, 16, S);
  }

  // Horizontal contraction rings
  ctx.strokeStyle = 'rgba(40,40,40,0.22)';
  ctx.lineWidth = 2.5;
  for (let y = 12; y < S; y += 18) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(S, y);
    ctx.stroke();
  }

  // Organic warty verrucae bumps
  for (let i = 0; i < 200; i++) {
    const x = rand() * S;
    const y = rand() * S;
    const r = 3 + rand() * 7;
    const g = ctx.createRadialGradient(x, y, 0.5, x, y, r);
    g.addColorStop(0, '#f0f0f0');
    g.addColorStop(0.7, '#999999');
    g.addColorStop(1, 'rgba(124,124,124,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  return finalizeTexture(canvas, 2, 1.5, false, false);
}

/**
 * 512x512 radial pleated fungal/spore gill lamellae bump map.
 */
function createMushroomGillBumpTexture(): THREE.CanvasTexture {
  const S = 512;
  const [canvas, ctx] = makeCanvas(S, S);

  ctx.fillStyle = '#404040';
  ctx.fillRect(0, 0, S, S);

  // Dense parallel gill blades (maps radially onto LatheGeometry)
  const stripes = 64;
  const w = S / stripes;
  for (let i = 0; i < stripes; i++) {
    const x = i * w;
    const g = ctx.createLinearGradient(x, 0, x + w, 0);
    g.addColorStop(0, '#222222');
    g.addColorStop(0.5, '#f2f2f2');
    g.addColorStop(1, '#222222');
    ctx.fillStyle = g;
    ctx.fillRect(x, 0, w, S);
  }

  return finalizeTexture(canvas, 1, 1, false, false);
}

/**
 * 512x512 ultra-detailed biological aquatic eye texture (deep pupil, golden tapetum ring,
 * intricate fibrous iris crypts, limbal ring, and specular wet catchlight).
 */
function createEyeIrisTexture(): THREE.CanvasTexture {
  const S = 512;
  const [canvas, ctx] = makeCanvas(S, S);
  const cx = S * 0.5;
  const cy = S * 0.5;
  const rand = makeRng(2049);

  // Dark metallic aquatic sclera + iris base radial gradient
  const iris = ctx.createRadialGradient(cx, cy, 42, cx, cy, S * 0.49);
  iris.addColorStop(0.0, '#020408');
  iris.addColorStop(0.30, '#050810');
  iris.addColorStop(0.34, '#fffae0'); // Bright tapetum lucidum pupillary ring
  iris.addColorStop(0.42, '#f7d47c'); // Warm golden inner collarette
  iris.addColorStop(0.62, '#62e5ff'); // Bioluminescent cyan-teal stroma
  iris.addColorStop(0.82, '#145873'); // Deep abyssal outer iris
  iris.addColorStop(0.91, '#081b28'); // Dark limbal ring
  iris.addColorStop(1.0, '#102430');
  ctx.fillStyle = iris;
  ctx.fillRect(0, 0, S, S);

  // Intricate radial iris stroma fibers (layered warm + cool highlights)
  for (let i = 0; i < 140; i++) {
    const ang = (i / 140) * Math.PI * 2 + (rand() - 0.5) * 0.03;
    const inner = 84 + rand() * 14;
    const outer = 195 + rand() * 28;
    ctx.strokeStyle =
      i % 3 === 0
        ? 'rgba(255,250,220,0.34)'
        : i % 3 === 1
        ? 'rgba(130,248,255,0.28)'
        : 'rgba(10,36,52,0.32)';
    ctx.lineWidth = 1.2 + rand() * 2.0;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(ang) * inner, cy + Math.sin(ang) * inner);
    const midA = ang + (rand() - 0.5) * 0.06;
    const midR = (inner + outer) * 0.5;
    ctx.quadraticCurveTo(
      cx + Math.cos(midA) * midR,
      cy + Math.sin(midA) * midR,
      cx + Math.cos(ang) * outer,
      cy + Math.sin(ang) * outer
    );
    ctx.stroke();
  }

  // Organic collarette ring & iris crypt spots
  for (let i = 0; i < 36; i++) {
    const ang = (i / 36) * Math.PI * 2;
    const dist = 128 + rand() * 44;
    const r = 4 + rand() * 9;
    const g = ctx.createRadialGradient(
      cx + Math.cos(ang) * dist,
      cy + Math.sin(ang) * dist,
      1,
      cx + Math.cos(ang) * dist,
      cy + Math.sin(ang) * dist,
      r
    );
    g.addColorStop(0, 'rgba(6,22,34,0.45)');
    g.addColorStop(1, 'rgba(6,22,34,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx + Math.cos(ang) * dist, cy + Math.sin(ang) * dist, r, 0, Math.PI * 2);
    ctx.fill();
  }

  // Crisp abyssal-black pupil with subtle inner lens sheen
  const pupil = ctx.createRadialGradient(cx - 8, cy - 8, 6, cx, cy, 80);
  pupil.addColorStop(0, '#0c1824');
  pupil.addColorStop(0.5, '#03060c');
  pupil.addColorStop(1, '#000000');
  ctx.fillStyle = pupil;
  ctx.beginPath();
  ctx.arc(cx, cy, 78, 0, Math.PI * 2);
  ctx.fill();

  // Dual glossy underwater specular catchlights
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.beginPath();
  ctx.ellipse(cx - 42, cy - 48, 24, 16, -0.45, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = 'rgba(180,248,255,0.58)';
  ctx.beginPath();
  ctx.ellipse(cx + 38, cy + 44, 10, 7, 0.35, 0, Math.PI * 2);
  ctx.fill();

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

/**
 * 512x512 crystalline mineral lattice facet bump map for siliceous/crystalline flora.
 */
function createCrystalFacetBumpTexture(): THREE.CanvasTexture {
  const S = 512;
  const [canvas, ctx] = makeCanvas(S, S);
  ctx.fillStyle = '#5a5a5a';
  ctx.fillRect(0, 0, S, S);
  const rand = makeRng(8841);

  for (let i = 0; i < 95; i++) {
    const cx = rand() * S;
    const cy = rand() * S;
    const rad = 18 + rand() * 48;
    const sides = 5 + Math.floor(rand() * 3);
    const rot = rand() * Math.PI * 2;
    const shade = Math.floor(110 + rand() * 135);
    ctx.fillStyle = `rgb(${shade},${shade},${shade})`;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    for (let k = 0; k < sides; k++) {
      const a = rot + (k / sides) * Math.PI * 2;
      const px = cx + Math.cos(a) * rad;
      const py = cy + Math.sin(a) * rad;
      if (k === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
  return finalizeTexture(canvas, 2, 2, false, false);
}

/**
 * 512x512 fibrous ridged & micro-spined botanical bark bump map.
 */
function createSpinedBarkBumpTexture(): THREE.CanvasTexture {
  const S = 512;
  const [canvas, ctx] = makeCanvas(S, S);
  ctx.fillStyle = '#484848';
  ctx.fillRect(0, 0, S, S);
  const rand = makeRng(9127);

  for (let i = 0; i < 64; i++) {
    const x = (i / 64) * S;
    ctx.strokeStyle = i % 2 === 0 ? 'rgba(215,215,215,0.65)' : 'rgba(28,28,28,0.6)';
    ctx.lineWidth = 3 + rand() * 4;
    ctx.beginPath();
    for (let y = 0; y <= S; y += 16) {
      const wx = x + Math.sin((y / S) * Math.PI * 6 + i) * 7;
      if (y === 0) ctx.moveTo(wx, y);
      else ctx.lineTo(wx, y);
    }
    ctx.stroke();
  }
  for (let i = 0; i < 140; i++) {
    const x = rand() * S;
    const y = rand() * S;
    const r = 3 + rand() * 6;
    const g = ctx.createRadialGradient(x, y, 0.5, x, y, r);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(1, 'rgba(60,60,60,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  return finalizeTexture(canvas, 2, 2, false, false);
}

/**
 * 512x512 organic botanical albedo tonal map with chlorophyll cellular mottling,
 * delicate translucent veins, and natural base-to-tip shading.
 */
function createFloraAlbedoTexture(): THREE.CanvasTexture {
  const S = 512;
  const [canvas, ctx] = makeCanvas(S, S);
  const rand = makeRng(4419);

  const g = ctx.createLinearGradient(0, S, 0, 0);
  g.addColorStop(0.0, '#96a2a8');
  g.addColorStop(0.28, '#ced8dc');
  g.addColorStop(0.75, '#f2f8fa');
  g.addColorStop(1.0, '#ffffff');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);

  // Organic translucent parenchyma cell patches
  for (let i = 0; i < 320; i++) {
    const x = rand() * S;
    const y = rand() * S;
    const rx = 5 + rand() * 14;
    const ry = 10 + rand() * 28;
    const bright = rand() > 0.44;
    const rg = ctx.createRadialGradient(x, y, 1, x, y, Math.max(rx, ry));
    rg.addColorStop(0, bright ? 'rgba(255,255,255,0.18)' : 'rgba(28,54,48,0.16)');
    rg.addColorStop(1, 'rgba(128,128,128,0)');
    ctx.fillStyle = rg;
    ctx.beginPath();
    ctx.ellipse(x, y, rx, ry, (rand() - 0.5) * 0.4, 0, Math.PI * 2);
    ctx.fill();
  }

  // Luminous central vascular midrib & fine translucent lateral veins
  const mid = ctx.createLinearGradient(S * 0.46, 0, S * 0.54, 0);
  mid.addColorStop(0, 'rgba(255,255,255,0)');
  mid.addColorStop(0.5, 'rgba(255,255,245,0.34)');
  mid.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = mid;
  ctx.fillRect(S * 0.46, 0, S * 0.08, S);

  ctx.strokeStyle = 'rgba(255,255,245,0.22)';
  ctx.lineWidth = 2.0;
  for (let y = 24; y < S; y += 26) {
    ctx.beginPath();
    ctx.moveTo(S * 0.5, y);
    ctx.bezierCurveTo(S * 0.34, y - 8, S * 0.16, y - 22, 8, y - 40);
    ctx.moveTo(S * 0.5, y);
    ctx.bezierCurveTo(S * 0.66, y - 8, S * 0.84, y - 22, S - 8, y - 40);
    ctx.stroke();
  }

  return finalizeTexture(canvas, 1, 1, true, false);
}

/**
 * 512x512 marbled striated marine muscle tissue albedo + normal maps for torn flesh morsels.
 */
function createFleshMaps(): { albedo: THREE.CanvasTexture; normal: THREE.CanvasTexture } {
  const S = 512;
  const [aCanvas, aCtx] = makeCanvas(S, S);
  const [hCanvas, hCtx] = makeCanvas(S, S);
  const rand = makeRng(6197);

  aCtx.fillStyle = '#c88c92';
  aCtx.fillRect(0, 0, S, S);
  hCtx.fillStyle = '#747474';
  hCtx.fillRect(0, 0, S, S);

  // Layered striated muscle fiber bundles & pearlescent fascia sinew
  for (let i = 0; i < 84; i++) {
    const yBase = (i / 84) * S;
    const isFascia = i % 7 === 0;
    aCtx.strokeStyle = isFascia
      ? 'rgba(255,232,230,0.42)'
      : i % 2 === 0
      ? 'rgba(138,48,58,0.46)'
      : 'rgba(218,120,126,0.38)';
    aCtx.lineWidth = isFascia ? 2.2 : 3.5 + rand() * 4.5;
    hCtx.strokeStyle = isFascia ? 'rgba(235,235,235,0.72)' : 'rgba(42,42,42,0.52)';
    hCtx.lineWidth = aCtx.lineWidth;

    aCtx.beginPath();
    hCtx.beginPath();
    for (let x = 0; x <= S; x += 16) {
      const wy =
        yBase +
        Math.sin((x / S) * Math.PI * 4 + i * 0.45) * 9 +
        Math.cos((x / S) * Math.PI * 8 - i * 0.7) * 3;
      if (x === 0) {
        aCtx.moveTo(x, wy);
        hCtx.moveTo(x, wy);
      } else {
        aCtx.lineTo(x, wy);
        hCtx.lineTo(x, wy);
      }
    }
    aCtx.stroke();
    hCtx.stroke();
  }

  // Organic cellular blotches & wet torn sinew highlights
  for (let i = 0; i < 140; i++) {
    const x = rand() * S;
    const y = rand() * S;
    const r = 6 + rand() * 18;
    const dark = rand() > 0.4;
    const g = aCtx.createRadialGradient(x, y, 1, x, y, r);
    g.addColorStop(0, dark ? 'rgba(95,28,36,0.28)' : 'rgba(255,222,218,0.25)');
    g.addColorStop(1, 'rgba(150,80,85,0)');
    aCtx.fillStyle = g;
    aCtx.beginPath();
    aCtx.arc(x, y, r, 0, Math.PI * 2);
    aCtx.fill();
  }

  return {
    albedo: finalizeTexture(aCanvas, 1.5, 1.5, true, false),
    normal: heightCanvasToNormalTexture(hCanvas, 2.8, 1.5, 1.5, false),
  };
}

/**
 * 512x512 wind/current-sculpted marine carbonate sand ripple & micro-grain normal map.
 */
function createSandNormalTexture(): THREE.CanvasTexture {
  const S = 512;
  const [canvas, ctx] = makeCanvas(S, S);
  const rand = makeRng(2719);

  const img = ctx.createImageData(S, S);
  const d = img.data;
  for (let y = 0; y < S; y++) {
    const v = (y / S) * Math.PI * 2;
    for (let x = 0; x < S; x++) {
      const u = (x / S) * Math.PI * 2;
      // Asymmetric current-swept carbonate sand ripples + cross-ripples + shell micro-grain
      const warp = Math.sin(v * 2.0 + Math.cos(u * 2.0) * 0.7) * 0.55;
      const primary = Math.sin(u * 6.0 + warp);
      const asym = Math.sin(u * 12.0 + warp * 2.0 - 0.8) * 0.25;
      const secondary = Math.sin(v * 8.0 - u * 3.0) * 0.14;
      const grain = (rand() - 0.5) * 0.26;
      const h = Math.max(0, Math.min(255, Math.round((0.5 + (primary * 0.44 + asym + secondary + grain) * 0.42) * 255)));
      const idx = (y * S + x) * 4;
      d[idx] = h;
      d[idx + 1] = h;
      d[idx + 2] = h;
      d[idx + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return heightCanvasToNormalTexture(canvas, 2.5, 9, 7, false);
}

/**
 * 512x512 fractured volcanic reef basalt & mineral-pitted rock normal map.
 */
function createRockNormalTexture(): THREE.CanvasTexture {
  const S = 512;
  const [canvas, ctx] = makeCanvas(S, S);
  const rand = makeRng(3917);

  ctx.fillStyle = '#7c7c7c';
  ctx.fillRect(0, 0, S, S);

  // Sedimentary/basaltic strata bands
  for (let y = 0; y < S; y += 14) {
    const g = ctx.createLinearGradient(0, y, 0, y + 14);
    g.addColorStop(0, '#3e3e3e');
    g.addColorStop(0.4, '#c4c4c4');
    g.addColorStop(0.8, '#848484');
    g.addColorStop(1, '#323232');
    ctx.fillStyle = g;
    ctx.fillRect(0, y, S, 14);
  }

  // Volcanic vesicle pits & eroded rock pockets
  for (let i = 0; i < 460; i++) {
    const x = rand() * S;
    const y = rand() * S;
    const r = 2 + rand() * 14;
    const pit = rand() > 0.38;
    const g = ctx.createRadialGradient(x, y, 0.5, x, y, r);
    g.addColorStop(0, pit ? 'rgba(20,20,20,0.65)' : 'rgba(235,235,235,0.48)');
    g.addColorStop(1, 'rgba(128,128,128,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  // Sharp rock fracture hairline cracks
  for (let i = 0; i < 26; i++) {
    ctx.strokeStyle = 'rgba(14,14,14,0.72)';
    ctx.lineWidth = 1.2 + rand() * 2.0;
    ctx.beginPath();
    let px = rand() * S;
    let py = rand() * S;
    ctx.moveTo(px, py);
    for (let s = 0; s < 6; s++) {
      px += (rand() - 0.5) * 75;
      py += (rand() - 0.5) * 65;
      ctx.lineTo(px, py);
    }
    ctx.stroke();
  }

  return heightCanvasToNormalTexture(canvas, 3.1, 2.5, 2.5, false);
}

/**
 * 512x512 piercing predatory aquatic eye iris (slit-keyhole pupil, fiery amber-gold tapetum ring,
 * high-contrast radial iris muscle striations, dark limbal rim, and wet lens catchlights).
 */
function createPredatorEyeIrisTexture(): THREE.CanvasTexture {
  const S = 512;
  const [canvas, ctx] = makeCanvas(S, S);
  const cx = S * 0.5;
  const cy = S * 0.5;
  const rand = makeRng(7933);

  const iris = ctx.createRadialGradient(cx, cy, 36, cx, cy, S * 0.49);
  iris.addColorStop(0.0, '#010204');
  iris.addColorStop(0.27, '#06080d');
  iris.addColorStop(0.32, '#fff5b8'); // Intense tapetum lucidum rim
  iris.addColorStop(0.45, '#ffaa28'); // Fiery golden-amber predator stroma
  iris.addColorStop(0.68, '#b84214'); // Deep copper-crimson outer iris
  iris.addColorStop(0.86, '#2a1210'); // Dark muscular iris edge
  iris.addColorStop(0.93, '#050c12'); // Crisp black limbal ring
  iris.addColorStop(1.0, '#0b1822');
  ctx.fillStyle = iris;
  ctx.fillRect(0, 0, S, S);

  // Dense radial iris fibers
  for (let i = 0; i < 180; i++) {
    const ang = (i / 180) * Math.PI * 2 + (rand() - 0.5) * 0.025;
    const inner = 72 + rand() * 14;
    const outer = 200 + rand() * 26;
    ctx.strokeStyle =
      i % 3 === 0
        ? 'rgba(255,244,175,0.42)'
        : i % 3 === 1
        ? 'rgba(255,126,38,0.34)'
        : 'rgba(18,8,8,0.42)';
    ctx.lineWidth = 1.1 + rand() * 2.1;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(ang) * inner, cy + Math.sin(ang) * inner);
    ctx.lineTo(cx + Math.cos(ang + (rand() - 0.5) * 0.05) * outer, cy + Math.sin(ang + (rand() - 0.5) * 0.05) * outer);
    ctx.stroke();
  }

  // Vertical-oval predatory pupil (razor-sharp focus)
  ctx.fillStyle = '#010205';
  ctx.beginPath();
  ctx.ellipse(cx, cy, 46, 92, 0, 0, Math.PI * 2);
  ctx.fill();

  // Subtle wet specular catchlights
  ctx.fillStyle = 'rgba(255,255,255,0.95)';
  ctx.beginPath();
  ctx.ellipse(cx - 44, cy - 50, 22, 14, -0.45, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = 'rgba(180,248,255,0.55)';
  ctx.beginPath();
  ctx.ellipse(cx + 36, cy + 44, 9, 6, 0.35, 0, Math.PI * 2);
  ctx.fill();

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}

/**
 * 128x128 photorealistic refractive underwater air-bubble sprite (crisp Fresnel cyan rim,
 * transparent glassy interior, and dual curved specular highlights).
 */
function createBubbleSpriteTexture(): THREE.CanvasTexture {
  const S = 128;
  const [canvas, ctx] = makeCanvas(S, S);
  const cx = S * 0.5;
  const cy = S * 0.5;
  const r = S * 0.44;

  ctx.clearRect(0, 0, S, S);

  // Refractive Fresnel shell
  const rim = ctx.createRadialGradient(cx, cy, r * 0.48, cx, cy, r);
  rim.addColorStop(0.0, 'rgba(140,235,255,0.03)');
  rim.addColorStop(0.68, 'rgba(150,235,255,0.16)');
  rim.addColorStop(0.88, 'rgba(210,250,255,0.78)');
  rim.addColorStop(0.97, 'rgba(255,255,255,0.92)');
  rim.addColorStop(1.0, 'rgba(255,255,255,0.0)');
  ctx.fillStyle = rim;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();

  // Crisp upper-left curved sun window highlight
  ctx.fillStyle = 'rgba(255,255,255,0.94)';
  ctx.beginPath();
  ctx.ellipse(cx - r * 0.34, cy - r * 0.34, r * 0.24, r * 0.13, -0.72, 0, Math.PI * 2);
  ctx.fill();

  // Subtle lower-right internal caustic bounce glow
  ctx.fillStyle = 'rgba(160,248,255,0.52)';
  ctx.beginPath();
  ctx.ellipse(cx + r * 0.28, cy + r * 0.34, r * 0.16, r * 0.08, -0.68, 0, Math.PI * 2);
  ctx.fill();

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/**
 * 64x64 soft organic underwater marine-snow bokeh floccule sprite (eliminates harsh pixel squares).
 */
function createMarineSnowSpriteTexture(): THREE.CanvasTexture {
  const S = 64;
  const [canvas, ctx] = makeCanvas(S, S);
  const cx = S * 0.5;
  const cy = S * 0.5;
  ctx.clearRect(0, 0, S, S);

  const g = ctx.createRadialGradient(cx, cy, 1, cx, cy, S * 0.46);
  g.addColorStop(0.0, 'rgba(235,252,255,0.92)');
  g.addColorStop(0.35, 'rgba(195,240,255,0.52)');
  g.addColorStop(0.72, 'rgba(130,210,235,0.16)');
  g.addColorStop(1.0, 'rgba(100,190,220,0.0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(cx, cy, S * 0.46, 0, Math.PI * 2);
  ctx.fill();

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

let cachedTextures: ProceduralTextures | null = null;

export function getProceduralTextures(): ProceduralTextures {
  if (!cachedTextures) {
    const scaleMaps = createScaleMaps();
    const fleshMaps = createFleshMaps();
    const chitinBump = createChitinBumpTexture();
    const floraVein = createFloraVeinTexture();
    const coralPoreBump = createCoralPoreBumpTexture();
    const anemoneSkinBump = createAnemoneSkinBumpTexture();
    const mushroomGillBump = createMushroomGillBumpTexture();
    const crystalFacetBump = createCrystalFacetBumpTexture();
    const spinedBarkBump = createSpinedBarkBumpTexture();

    cachedTextures = {
      skinPatterns: {
        striped: createPatternTexture('striped'),
        spotted: createPatternTexture('spotted'),
        iridescent: createPatternTexture('iridescent'),
        photophore: createPatternTexture('photophore'),
        marbled: createPatternTexture('marbled'),
        chevron: createPatternTexture('chevron'),
        ocellated: createPatternTexture('ocellated'),
        abyssal_veins: createPatternTexture('abyssal_veins'),
      },
      skinAlbedo: createSkinAlbedoTexture(),
      floraAlbedo: createFloraAlbedoTexture(),
      fleshAlbedo: fleshMaps.albedo,
      fleshNormal: fleshMaps.normal,
      scaleBump: scaleMaps.bump,
      scaleNormal: scaleMaps.normal,
      scaleRoughness: scaleMaps.roughness,
      chitinBump,
      chitinNormal: heightCanvasToNormalTexture(chitinBump.image as HTMLCanvasElement, 2.7, 2, 2, false),
      membraneAlpha: createMembraneTexture(),
      floraVein,
      floraVeinNormal: heightCanvasToNormalTexture(floraVein.image as HTMLCanvasElement, 2.4, 1, 1, false),
      coralPoreBump,
      coralPoreNormal: heightCanvasToNormalTexture(coralPoreBump.image as HTMLCanvasElement, 3.0, 2, 2, false),
      anemoneSkinBump,
      anemoneSkinNormal: heightCanvasToNormalTexture(anemoneSkinBump.image as HTMLCanvasElement, 2.6, 2, 1.5, false),
      mushroomGillBump,
      mushroomGillNormal: heightCanvasToNormalTexture(mushroomGillBump.image as HTMLCanvasElement, 3.0, 1, 1, false),
      crystalFacetBump,
      crystalFacetNormal: heightCanvasToNormalTexture(crystalFacetBump.image as HTMLCanvasElement, 3.2, 2, 2, false),
      spinedBarkBump,
      spinedBarkNormal: heightCanvasToNormalTexture(spinedBarkBump.image as HTMLCanvasElement, 2.9, 2, 2, false),
      sandNormal: createSandNormalTexture(),
      rockNormal: createRockNormalTexture(),
      eyeIris: createEyeIrisTexture(),
      eyeIrisPredator: createPredatorEyeIrisTexture(),
      bubbleSprite: createBubbleSpriteTexture(),
      marineSnowSprite: createMarineSnowSpriteTexture(),
    };
  }
  return cachedTextures;
}
