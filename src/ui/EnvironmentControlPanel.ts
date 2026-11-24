import { ECOSYSTEM_PRESETS, type EcosystemPresetId } from '../core/config';
import {
  ANIMAL_BODY_PLANS,
  ANIMAL_DIETS,
  PLANT_FORMS,
  PLANT_METABOLISMS,
} from '../genetics/taxonomy';
import type { AnimalBodyPlan, AnimalDiet, PlantForm, PlantMetabolism } from '../genetics/types';
import type { SimulationEngine } from '../simulation/SimulationEngine';
import type { SimulationSnapshot } from '../simulation/types';

function formatClock(timeOfDay: number): string {
  const totalMinutes = Math.floor(((timeOfDay % 1) + 1) % 1 * 24 * 60);
  const hh = String(Math.floor(totalMinutes / 60)).padStart(2, '0');
  const mm = String(totalMinutes % 60).padStart(2, '0');
  const phase =
    timeOfDay < 0.2 || timeOfDay >= 0.84
      ? 'Abyssal Night'
      : timeOfDay < 0.34
      ? 'Dawn'
      : timeOfDay < 0.68
      ? 'Sunlit Day'
      : 'Twilight';
  return `${hh}:${mm} · ${phase}`;
}

export class EnvironmentControlPanel {
  private readonly panel: HTMLElement | null;
  private open = false;

  constructor(
    private readonly sim: SimulationEngine,
    private readonly onPresetLoaded: (presetId: EcosystemPresetId) => void
  ) {
    this.panel = document.getElementById('lab-drawer');
    this.populateSelects();
    this.bindControls();
    this.syncFromEnv();
  }

  private populateSelects(): void {
    const fill = (id: string, items: readonly string[], anyLabel: string) => {
      const sel = document.getElementById(id) as HTMLSelectElement | null;
      if (!sel) return;
      sel.innerHTML =
        `<option value="">${anyLabel}</option>` +
        items
          .map((v) => `<option value="${v}">${v.replace(/_/g, ' ')}</option>`)
          .join('');
    };

    fill('lab-animal-plan', ANIMAL_BODY_PLANS, 'Any Body Plan');
    fill('lab-animal-diet', ANIMAL_DIETS, 'Any Diet');
    fill('lab-plant-form', PLANT_FORMS, 'Any Flora Form');
    fill('lab-plant-met', PLANT_METABOLISMS, 'Any Metabolism');

    const presetBox = document.getElementById('lab-presets-grid');
    if (presetBox) {
      presetBox.innerHTML = '';
      for (const p of ECOSYSTEM_PRESETS) {
        const btn = document.createElement('button');
        btn.className = 'hud-btn lab-preset-btn';
        btn.title = p.description;
        btn.textContent = p.name;
        btn.addEventListener('click', () => {
          this.sim.seedPreset(p.id);
          this.syncFromEnv();
          this.onPresetLoaded(p.id);
          this.sim.events.emit('toast', { message: `Loaded: ${p.name}` });
        });
        presetBox.appendChild(btn);
      }
    }
  }

  private bindControls(): void {
    document.getElementById('lab-close-btn')?.addEventListener('click', () => this.setOpen(false));

    // Time of Day slider
    const todSlider = document.getElementById('lab-tod-slider') as HTMLInputElement | null;
    todSlider?.addEventListener('input', () => {
      this.sim.env.timeOfDay = parseFloat(todSlider.value);
      this.sim.env.dayNightAutoCycle = false;
      this.syncFromEnv();
    });

    document.getElementById('lab-daycycle-toggle')?.addEventListener('click', () => {
      this.sim.env.dayNightAutoCycle = !this.sim.env.dayNightAutoCycle;
      this.syncFromEnv();
    });

    const quickTimes: Array<[string, number]> = [
      ['lab-time-dawn', 0.26],
      ['lab-time-noon', 0.5],
      ['lab-time-dusk', 0.77],
      ['lab-time-night', 0.03],
    ];
    for (const [id, val] of quickTimes) {
      document.getElementById(id)?.addEventListener('click', () => {
        this.sim.env.timeOfDay = val;
        this.syncFromEnv();
      });
    }

    // Current Strength slider
    const curSlider = document.getElementById('lab-current-slider') as HTMLInputElement | null;
    curSlider?.addEventListener('input', () => {
      this.sim.env.currentStrength = parseFloat(curSlider.value);
      this.syncFromEnv();
    });

    // Mutation Rate slider
    const mutSlider = document.getElementById('lab-mutation-slider') as HTMLInputElement | null;
    mutSlider?.addEventListener('input', () => {
      this.sim.env.mutationRateMultiplier = parseFloat(mutSlider.value);
      this.syncFromEnv();
    });

    // Auto Genesis toggle
    document.getElementById('lab-autogen-toggle')?.addEventListener('click', () => {
      this.sim.env.autoGenesisEnabled = !this.sim.env.autoGenesisEnabled;
      this.syncFromEnv();
    });

    // Targeted Spawners
    document.getElementById('lab-spawn-animal')?.addEventListener('click', () => {
      const plan = ((document.getElementById('lab-animal-plan') as HTMLSelectElement | null)?.value || null) as AnimalBodyPlan | null;
      const diet = ((document.getElementById('lab-animal-diet') as HTMLSelectElement | null)?.value || null) as AnimalDiet | null;
      this.sim.triggerBiogenesis(diet, plan);
    });

    document.getElementById('lab-spawn-plant')?.addEventListener('click', () => {
      const form = ((document.getElementById('lab-plant-form') as HTMLSelectElement | null)?.value || null) as PlantForm | null;
      const met = ((document.getElementById('lab-plant-met') as HTMLSelectElement | null)?.value || null) as PlantMetabolism | null;
      this.sim.triggerPhytogenesis(met, form);
    });

    // Export / Import JSON Snapshot
    document.getElementById('lab-export-btn')?.addEventListener('click', () => {
      const snap = this.sim.exportSnapshot();
      const blob = new Blob([JSON.stringify(snap, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `xenobiotic-abyss-${Date.now()}.json`;
      a.click();
      URL.revokeObjectURL(url);
      this.sim.events.emit('toast', { message: 'Exported biosphere snapshot (.json)' });
    });

    const fileInput = document.getElementById('lab-import-file') as HTMLInputElement | null;
    document.getElementById('lab-import-btn')?.addEventListener('click', () => fileInput?.click());
    fileInput?.addEventListener('change', () => {
      const file = fileInput.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const snap = JSON.parse(String(reader.result)) as SimulationSnapshot;
          this.sim.importSnapshot(snap);
          this.syncFromEnv();
          this.sim.events.emit('toast', { message: 'Biosphere snapshot restored!' });
        } catch (err) {
          this.sim.events.emit('toast', {
            message: `Import failed: ${err instanceof Error ? err.message : 'Invalid file'}`,
          });
        }
      };
      reader.readAsText(file);
      fileInput.value = '';
    });
  }

  isOpen(): boolean {
    return this.open;
  }

  setOpen(open: boolean): void {
    this.open = open;
    this.panel?.classList.toggle('hidden', !open);
    document.getElementById('btn-lab')?.classList.toggle('active-btn', open);
    if (open) this.syncFromEnv();
  }

  toggle(): void {
    this.setOpen(!this.open);
  }

  syncFromEnv(): void {
    const todSlider = document.getElementById('lab-tod-slider') as HTMLInputElement | null;
    if (todSlider) todSlider.value = this.sim.env.timeOfDay.toFixed(3);
    const todVal = document.getElementById('lab-tod-val');
    if (todVal) todVal.textContent = formatClock(this.sim.env.timeOfDay);

    const dayBtn = document.getElementById('lab-daycycle-toggle');
    if (dayBtn) {
      dayBtn.textContent = this.sim.env.dayNightAutoCycle ? 'Auto Cycle: ON' : 'Auto Cycle: OFF';
      dayBtn.classList.toggle('active-btn', this.sim.env.dayNightAutoCycle);
    }

    const curSlider = document.getElementById('lab-current-slider') as HTMLInputElement | null;
    if (curSlider) curSlider.value = this.sim.env.currentStrength.toFixed(2);
    const curVal = document.getElementById('lab-current-val');
    if (curVal) curVal.textContent = `${Math.round(this.sim.env.currentStrength * 100)}%`;

    const mutSlider = document.getElementById('lab-mutation-slider') as HTMLInputElement | null;
    if (mutSlider) mutSlider.value = this.sim.env.mutationRateMultiplier.toFixed(2);
    const mutVal = document.getElementById('lab-mutation-val');
    if (mutVal) mutVal.textContent = `${this.sim.env.mutationRateMultiplier.toFixed(1)}x`;

    const autoBtn = document.getElementById('lab-autogen-toggle');
    if (autoBtn) {
      autoBtn.textContent = this.sim.env.autoGenesisEnabled ? 'Auto Vent Genesis: ON' : 'Auto Vent Genesis: OFF';
      autoBtn.classList.toggle('active-btn', this.sim.env.autoGenesisEnabled);
    }
  }
}
