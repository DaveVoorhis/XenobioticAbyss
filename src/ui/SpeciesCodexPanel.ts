import type { SpeciesRecord } from '../genetics/types';
import type { SimulationEngine } from '../simulation/SimulationEngine';

type CodexFilter = 'all' | 'fauna' | 'flora' | 'extinct';

function hexToCss(hex: number): string {
  return `#${hex.toString(16).padStart(6, '0')}`;
}

export class SpeciesCodexPanel {
  private readonly panel: HTMLElement | null;
  private readonly listEl: HTMLElement | null;
  private readonly summaryEl: HTMLElement | null;
  private filter: CodexFilter = 'all';
  private open = false;

  constructor(
    private readonly sim: SimulationEngine,
    private readonly onLocate: (kind: 'fauna' | 'flora', speciesId: number) => void
  ) {
    this.panel = document.getElementById('codex-drawer');
    this.listEl = document.getElementById('codex-list');
    this.summaryEl = document.getElementById('codex-summary');

    document.getElementById('codex-close-btn')?.addEventListener('click', () => this.setOpen(false));

    const filters: CodexFilter[] = ['all', 'fauna', 'flora', 'extinct'];
    for (const f of filters) {
      document.getElementById(`codex-filter-${f}`)?.addEventListener('click', () => {
        this.filter = f;
        for (const f2 of filters) {
          document.getElementById(`codex-filter-${f2}`)?.classList.toggle('active-btn', f2 === f);
        }
        this.render();
      });
    }
  }

  isOpen(): boolean {
    return this.open;
  }

  setOpen(open: boolean): void {
    this.open = open;
    this.panel?.classList.toggle('hidden', !open);
    document.getElementById('btn-codex')?.classList.toggle('active-btn', open);
    if (open) this.render();
  }

  toggle(): void {
    this.setOpen(!this.open);
  }

  render(): void {
    if (!this.open || !this.listEl) return;
    this.sim.speciesRegistry.recomputeCounts(this.sim.animals, this.sim.plants, this.sim.simTime);
    const all = this.sim.speciesRegistry.getAll();

    const extantCount = all.filter((r) => r.currentPopulation > 0).length;
    const extinctCount = all.length - extantCount;
    if (this.summaryEl) {
      this.summaryEl.textContent = `${extantCount} extant · ${extinctCount} extinct · ${all.length} total lineages`;
    }

    const filtered = all
      .filter((r) => {
        if (this.filter === 'fauna') return r.kind === 'fauna' && r.currentPopulation > 0;
        if (this.filter === 'flora') return r.kind === 'flora' && r.currentPopulation > 0;
        if (this.filter === 'extinct') return r.currentPopulation === 0;
        return r.currentPopulation > 0;
      })
      .sort((a, b) => b.currentPopulation - a.currentPopulation || b.peakPopulation - a.peakPopulation);

    if (filtered.length === 0) {
      this.listEl.innerHTML = `<div class="codex-empty">No species matching this filter yet.</div>`;
      return;
    }

    const byId = new Map<number, SpeciesRecord>();
    for (const r of all) byId.set(r.speciesId, r);

    this.listEl.innerHTML = '';
    for (const r of filtered) {
      const card = document.createElement('div');
      card.className = `codex-item${r.currentPopulation === 0 ? ' codex-extinct' : ''}`;
      const parentRec = r.parentSpeciesId ? byId.get(r.parentSpeciesId) : null;
      const lineageText = parentRec
        ? `Evolved from ${parentRec.speciesName}`
        : 'Primordial Vent Lineage';

      const swatchA = hexToCss(r.baseHex);
      const swatchB = hexToCss(r.glowHex);

      card.innerHTML = `
        <div class="codex-item-top">
          <div class="codex-swatch" style="background: radial-gradient(circle at 35% 35%, ${swatchB}, ${swatchA});"></div>
          <div class="codex-meta">
            <div class="codex-name">${r.speciesName}</div>
            <div class="codex-sub">${r.kind.toUpperCase()} · Gen ${r.maxGeneration} · ${lineageText}</div>
          </div>
          <div class="codex-pop">
            <span class="codex-pop-num">${r.currentPopulation}</span>
            <span class="codex-pop-peak">peak ${r.peakPopulation}</span>
          </div>
        </div>
        <div class="codex-traits">
          ${r.summaryTraits
            .slice(0, 6)
            .map((t) => `<span class="trait-badge">${t.replace(/_/g, ' ')}</span>`)
            .join('')}
        </div>
      `;

      if (r.currentPopulation > 0) {
        const btn = document.createElement('button');
        btn.className = 'hud-btn codex-locate-btn';
        btn.textContent = 'Locate & Inspect';
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.onLocate(r.kind, r.speciesId);
        });
        card.appendChild(btn);
      }

      this.listEl.appendChild(card);
    }
  }
}
