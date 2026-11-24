import { safeRatio } from '../core/math';
import type { PopulationSample } from '../simulation/types';

export class PopulationGraph {
  private readonly canvas: HTMLCanvasElement | null;

  constructor(canvasId = 'pop-graph-canvas') {
    this.canvas = document.getElementById(canvasId) as HTMLCanvasElement | null;
  }

  render(history: readonly PopulationSample[]): void {
    const canvas = this.canvas;
    if (!canvas) return;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (w < 4 || h < 4) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const tw = Math.max(1, Math.round(w * dpr));
    const th = Math.max(1, Math.round(h * dpr));
    if (canvas.width !== tw || canvas.height !== th) {
      canvas.width = tw;
      canvas.height = th;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    // Subtle horizontal grid lines
    ctx.strokeStyle = 'rgba(94, 216, 248, 0.12)';
    ctx.lineWidth = 1;
    for (let k = 1; k < 4; k++) {
      const y = (h / 4) * k;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }

    if (history.length < 2) return;

    let maxV = 20;
    for (let i = 0; i < history.length; i++) {
      const s = history[i];
      maxV = Math.max(maxV, s.animals, s.plants, s.species, s.detritus);
    }

    const plotSeries = (
      key: 'animals' | 'plants' | 'species' | 'detritus',
      color: string,
      fillAlpha = 0
    ) => {
      ctx.beginPath();
      for (let i = 0; i < history.length; i++) {
        const x = (i / (history.length - 1)) * (w - 8) + 4;
        const y = h - 5 - safeRatio(history[i][key], maxV) * (h - 10);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.65;
      ctx.stroke();

      if (fillAlpha > 0) {
        ctx.lineTo(w - 4, h - 2);
        ctx.lineTo(4, h - 2);
        ctx.closePath();
        ctx.fillStyle = color;
        ctx.globalAlpha = fillAlpha;
        ctx.fill();
        ctx.globalAlpha = 1;
      }
    };

    plotSeries('animals', '#38e8ff', 0.10);
    plotSeries('plants', '#34f5a8', 0.08);
    plotSeries('species', '#fbbf24', 0);
    plotSeries('detritus', '#e879f9', 0);

    // Subtle scale watermark
    ctx.fillStyle = 'rgba(186, 234, 250, 0.42)';
    ctx.font = '500 8px "JetBrains Mono", monospace';
    ctx.textAlign = 'right';
    ctx.fillText(`${maxV}`, w - 4, 10);
  }
}
