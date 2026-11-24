import { clamp, safeRatio } from '../core/math';
import type { CreatureEyeSystem } from '../rendering/CreatureEyeSystem';
import { getLifecyclePathSummary } from '../simulation/lifecycle';
import type { Entity } from '../simulation/types';

function setElText(id: string, text: string): void {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

export interface InspectorCallbacks {
  onClose(): void;
  onToggleFollow(): void;
  onToggleEyeView(): void;
  onTogglePiP(): void;
  onNourish(): void;
  onMutate(): void;
  onCycleNext(): void;
}

export class InspectorPanel {
  private readonly card: HTMLElement | null;
  private lastTraitsKey = '';

  constructor(callbacks: InspectorCallbacks) {
    this.card = document.getElementById('inspector-card');

    const bind = (id: string, fn: () => void) => {
      document.getElementById(id)?.addEventListener('click', fn);
    };

    bind('insp-close-btn', callbacks.onClose);
    bind('insp-follow-btn', callbacks.onToggleFollow);
    bind('insp-eyeview-btn', callbacks.onToggleEyeView);
    bind('insp-pip-btn', callbacks.onTogglePiP);
    bind('insp-nourish-btn', callbacks.onNourish);
    bind('insp-mutate-btn', callbacks.onMutate);
    bind('insp-next-btn', callbacks.onCycleNext);
  }

  setVisible(visible: boolean): void {
    if (!this.card) return;
    this.card.classList.toggle('hidden', !visible);
    if (!visible) this.lastTraitsKey = '';
  }

  setFollowState(active: boolean): void {
    const btn = document.getElementById('insp-follow-btn');
    if (btn) btn.classList.toggle('active-btn', active);
    setElText('insp-follow-label', active ? 'Follow Cam (F): ON' : 'Follow Cam (F): OFF');
  }

  update(entity: Entity | null, eyeSystem: CreatureEyeSystem): void {
    if (!entity || !entity.alive) {
      this.setVisible(false);
      return;
    }
    this.setVisible(true);

    const kinds: Record<string, string> = {
      animal: 'FAUNA',
      corpse: 'CORPSE',
      plant: 'FLORA',
      egg: 'EGG',
      propagule: entity.kind === 'propagule' && entity.isSeed ? 'SEED' : 'SPORE',
      pellet: 'NUTRIENT',
    };

    setElText('insp-kind-badge', kinds[entity.kind] ?? 'ORGANISM');
    const gen = 'genome' in entity ? entity.genome.generation : 1;
    const spName = 'genome' in entity ? entity.genome.speciesName : 'Nutrient Pellet';
    setElText('insp-gen-badge', `Gen ${gen}`);
    setElText('insp-species-name', spName);
    const stageHeader =
      entity.kind === 'animal' && entity.lifeStage !== 'adult'
        ? `${entity.stage} (${Math.round(entity.maturity * 100)}%) · ${entity.state}`
        : `${entity.stage} · ${entity.state}`;
    setElText('insp-stage-state', stageHeader);
    setElText(
      'insp-offspring',
      'offspringCount' in entity ? String(entity.offspringCount) : '0'
    );

    const f1 = document.getElementById('insp-bar1-fill');
    const f2 = document.getElementById('insp-bar2-fill');
    const f3 = document.getElementById('insp-bar3-fill');

    if (entity.kind === 'animal') {
      const g = entity.genome;
      setElText('insp-bar1-label', 'HEALTH');
      setElText('insp-bar1-val', `${Math.round(entity.hp)} / ${entity.maxHp}`);
      if (f1) f1.style.width = `${clamp(safeRatio(entity.hp, entity.maxHp) * 100, 0, 100)}%`;
      setElText('insp-bar2-label', 'ENERGY');
      setElText('insp-bar2-val', `${Math.round(entity.energy)} / ${entity.maxEnergy}`);
      if (f2) f2.style.width = `${clamp(safeRatio(entity.energy, entity.maxEnergy) * 100, 0, 100)}%`;
      setElText('insp-bar3-val', `${Math.floor(entity.age)}s / ${Math.round(g.maxAge)}s`);
      if (f3) f3.style.width = `${clamp(safeRatio(entity.age, g.maxAge) * 100, 0, 100)}%`;
      const prof = eyeSystem.getVisionProfile(g);
      setElText('insp-optics', `${prof.label} (${prof.fov}°)`);
    } else if (entity.kind === 'corpse') {
      setElText('insp-bar1-label', 'HEALTH');
      setElText('insp-bar1-val', '0 (Deceased)');
      if (f1) f1.style.width = '0%';
      setElText('insp-bar2-label', 'NUTRIENTS');
      setElText('insp-bar2-val', `${Math.round(entity.nutrients)} / ${entity.maxNutrients}`);
      if (f2) f2.style.width = `${clamp(safeRatio(entity.nutrients, entity.maxNutrients) * 100, 0, 100)}%`;
      setElText('insp-bar3-val', `${Math.floor(entity.age)}s (${entity.cause})`);
      if (f3) f3.style.width = '100%';
      setElText('insp-optics', `${eyeSystem.getVisionProfile(entity.genome).label} (Fading)`);
    } else if (entity.kind === 'plant') {
      const g = entity.genome;
      setElText('insp-bar1-label', 'GROWTH');
      setElText('insp-bar1-val', `${Math.round(entity.growth * 100)}%`);
      if (f1) f1.style.width = `${clamp(entity.growth * 100, 0, 100)}%`;
      setElText('insp-bar2-label', 'BIOMASS');
      setElText('insp-bar2-val', `${Math.round(entity.biomass)} / ${entity.maxBiomass}`);
      if (f2) f2.style.width = `${clamp(safeRatio(entity.biomass, entity.maxBiomass) * 100, 0, 100)}%`;
      setElText('insp-bar3-val', `${Math.floor(entity.age)}s / ${Math.round(g.maxAge)}s`);
      if (f3) f3.style.width = `${clamp(safeRatio(entity.age, g.maxAge) * 100, 0, 100)}%`;
      setElText('insp-optics', 'No ocular organs');
    } else {
      const maxT = entity.kind === 'egg' ? entity.incubateDuration : entity.maxAge;
      const pr = safeRatio(entity.age, maxT);
      setElText('insp-bar1-label', entity.kind === 'egg' ? 'INCUBATION' : 'DISPERSAL');
      setElText('insp-bar1-val', `${Math.round(pr * 100)}%`);
      if (f1) f1.style.width = `${clamp(pr * 100, 0, 100)}%`;
      setElText('insp-bar2-label', 'NUTRIENTS');
      setElText('insp-bar2-val', String(Math.round(entity.nutrients)));
      if (f2) f2.style.width = '100%';
      setElText('insp-bar3-val', `${Math.floor(entity.age)}s / ${Math.round(maxT)}s`);
      if (f3) f3.style.width = `${clamp(pr * 100, 0, 100)}%`;
      setElText('insp-optics', 'No ocular organs');
    }

    // Action button availability
    const canInteractive = entity.kind === 'animal' || (entity.kind === 'plant' && !entity.wilting);
    const nourishBtn = document.getElementById('insp-nourish-btn') as HTMLButtonElement | null;
    const mutateBtn = document.getElementById('insp-mutate-btn') as HTMLButtonElement | null;
    if (nourishBtn) nourishBtn.disabled = !canInteractive;
    if (mutateBtn) mutateBtn.disabled = !canInteractive;

    // Avoid rebuilding trait badges DOM every refresh unless entity/genome changed
    const traitsKey = `${entity.id}_${entity.kind}`;
    if (traitsKey !== this.lastTraitsKey) {
      this.lastTraitsKey = traitsKey;
      const grid = document.getElementById('insp-traits-grid');
      if (grid && 'genome' in entity) {
        const g = entity.genome;
        const tags =
          entity.kind === 'animal' || entity.kind === 'corpse' || entity.kind === 'egg'
            ? [
                getLifecyclePathSummary(g as any),
                (g as any).bodyPlan,
                (g as any).diet,
                (g as any).physiology,
                (g as any).integument,
                (g as any).sensoryOrgan,
                (g as any).social,
                (g as any).combat,
                (g as any).appendage,
                (g as any).functionalPart,
                (g as any).reproduction,
                (g as any).skinPattern,
                (g as any).depthPref,
                `Armor ${Math.round(((g as any).armorDensity ?? 0) * 100)}%`,
                (g as any).toxicity > 0.2 ? `Toxin ${Math.round((g as any).toxicity * 100)}%` : null,
                `Elong ${(((g as any).bodyElongation ?? 1) as number).toFixed(2)}x`,
                `Fin ${(((g as any).finSpan ?? 1) as number).toFixed(2)}x`,
              ]
            : [
                (g as any).form,
                (g as any).metabolism,
                (g as any).propagation,
                (g as any).leafMorphology,
                (g as any).defense && (g as any).defense !== 'none' ? (g as any).defense : null,
                (g as any).rootSystem,
                (g as any).surfaceTexture,
                (g as any).toxicity > 0.2 ? `Toxin ${Math.round((g as any).toxicity * 100)}%` : null,
                `Spread ${(((g as any).canopySpread ?? 1) as number).toFixed(2)}x`,
                `Nutr ${Math.round(((g as any).nutrientEfficiency ?? 1) * 100)}%`,
              ];
        grid.innerHTML = tags
          .filter(Boolean)
          .map(
            (t) =>
              `<span class="trait-badge">${String(t).replace(/_/g, ' ')}</span>`
          )
          .join('');
      }
    }
  }
}
