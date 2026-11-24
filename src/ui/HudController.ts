import type { AmbientAudioEngine } from '../audio/AmbientAudioEngine';
import { safeRatio } from '../core/math';
import type { EyeViewMode } from '../rendering/CreatureEyeSystem';
import type { SceneRenderer } from '../rendering/SceneRenderer';
import type { SimulationEngine } from '../simulation/SimulationEngine';
import type { AnimalEntity, CorpseEntity } from '../simulation/types';
import { EnvironmentControlPanel } from './EnvironmentControlPanel';
import { InspectorPanel } from './InspectorPanel';
import { PopulationGraph } from './PopulationGraph';
import { SpeciesCodexPanel } from './SpeciesCodexPanel';

function setElText(id: string, text: string): void {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

export class HudController {
  private readonly inspector: InspectorPanel;
  private readonly popGraph: PopulationGraph;
  private readonly codex: SpeciesCodexPanel;
  private readonly lab: EnvironmentControlPanel;

  private hudHiddenBeforeEye = false;
  private toastTimer: number | null = null;
  private lastHudRefresh = 0;

  readonly pipViewportEl: HTMLElement | null;
  readonly pipCanvasEl: HTMLCanvasElement | null;
  readonly fullEyeCanvasEl: HTMLCanvasElement | null;

  constructor(
    private readonly sim: SimulationEngine,
    private readonly sceneRenderer: SceneRenderer,
    private readonly audio: AmbientAudioEngine
  ) {
    this.pipViewportEl = document.getElementById('pip-viewport');
    this.pipCanvasEl = document.getElementById('pip-sensory-canvas') as HTMLCanvasElement | null;
    this.fullEyeCanvasEl = document.getElementById('eye-sensory-canvas') as HTMLCanvasElement | null;

    this.popGraph = new PopulationGraph('pop-graph-canvas');

    this.inspector = new InspectorPanel({
      onClose: () => this.sceneRenderer.selectEntity(null),
      onToggleFollow: () => this.setFollowCam(!this.sceneRenderer.followCam),
      onToggleEyeView: () => {
        if (!this.sceneRenderer.eyeSystem.canUseEyeView(this.sceneRenderer.selectedEntity)) return;
        const next = this.sceneRenderer.eyeSystem.mode === 'fullscreen' ? 'off' : 'fullscreen';
        this.setEyeViewMode(next);
      },
      onTogglePiP: () => {
        if (!this.sceneRenderer.eyeSystem.canUseEyeView(this.sceneRenderer.selectedEntity)) return;
        const next = this.sceneRenderer.eyeSystem.mode === 'pip' ? 'off' : 'pip';
        this.setEyeViewMode(next);
      },
      onNourish: () => {
        if (this.sceneRenderer.selectedEntity) {
          this.sim.nourishEntity(this.sceneRenderer.selectedEntity);
        }
      },
      onMutate: () => {
        if (this.sceneRenderer.selectedEntity) {
          const child = this.sim.induceMutation(this.sceneRenderer.selectedEntity);
          if (child) this.sceneRenderer.selectEntity(child, true);
        }
      },
      onCycleNext: () => this.cycleNextSpecimen(),
    });

    this.codex = new SpeciesCodexPanel(this.sim, (kind, speciesId) => {
      const specimen = this.sim.findLivingSpecimen(kind, speciesId);
      if (specimen) {
        this.sceneRenderer.selectEntity(specimen, true);
        this.showToast(`Located ${specimen.kind === 'animal' || specimen.kind === 'plant' ? specimen.genome.speciesName : 'specimen'}`);
      } else {
        this.showToast('No living specimen found');
      }
    });

    this.lab = new EnvironmentControlPanel(this.sim, () => {
      this.sceneRenderer.selectEntity(null);
      this.sceneRenderer.flyToPreset('tank');
    });

    this.bindToolbarAndOverlays();
    this.bindEvents();
    this.bindKeyboard();
  }

  private bindEvents(): void {
    const ev = this.sim.events;

    ev.on('log', ({ message, toneClass }) => {
      this.appendLog(message, toneClass);
    });

    ev.on('toast', ({ message }) => {
      this.showToast(message);
    });

    ev.on('selection:changed', ({ entity }) => {
      if (!entity) {
        this.setFollowCam(false);
        if (this.sceneRenderer.eyeSystem.mode !== 'off') this.setEyeViewMode('off');
      } else if (
        this.sceneRenderer.eyeSystem.mode !== 'off' &&
        !this.sceneRenderer.eyeSystem.canUseEyeView(entity)
      ) {
        this.setEyeViewMode('off');
      }
      this.inspector.update(entity, this.sceneRenderer.eyeSystem);
      this.syncEyeViewUI();
    });

    ev.on('ecosystem:reset', () => {
      if (this.sceneRenderer.eyeSystem.mode !== 'off') this.setEyeViewMode('off');
      this.sceneRenderer.selectEntity(null);
    });
  }

  private bindToolbarAndOverlays(): void {
    const on = (id: string, fn: () => void) => {
      document.getElementById(id)?.addEventListener('click', fn);
    };

    // Simulation speeds
    const speeds = [0, 0.5, 1, 2, 4];
    for (const sp of speeds) {
      on(`speed-${sp}`, () => {
        this.sim.simSpeed = sp;
        for (const s2 of speeds) {
          document.getElementById(`speed-${s2}`)?.classList.toggle('active-btn', s2 === sp);
        }
        this.showToast(sp === 0 ? 'Simulation Paused' : `Speed: ${sp}x`);
      });
    }

    on('btn-biogenesis', () => this.sim.triggerBiogenesis());
    on('btn-phytogenesis', () => this.sim.triggerPhytogenesis());
    on('btn-feed-mode', () => this.toggleFeedMode());
    on('btn-codex', () => {
      if (!this.codex.isOpen()) this.lab.setOpen(false);
      this.codex.toggle();
    });
    on('btn-lab', () => {
      if (!this.lab.isOpen()) this.codex.setOpen(false);
      this.lab.toggle();
    });
    on('btn-audio', () => {
      const active = this.audio.toggle();
      const btn = document.getElementById('btn-audio');
      if (btn) btn.classList.toggle('active-btn', active);
      setElText('btn-audio-label', active ? 'Audio: ON' : 'Audio');
      this.showToast(active ? 'Abyssal audio enabled' : 'Audio muted');
    });

    on('btn-hide-hud', () => this.setHudHidden(true));
    on('show-hud-btn', () => this.setHudHidden(false));

    // Camera presets
    on('cam-tank', () => {
      this.setFollowCam(false);
      this.sceneRenderer.flyToPreset('tank');
    });
    on('cam-vent', () => {
      this.setFollowCam(false);
      this.sceneRenderer.flyToPreset('vent');
    });
    on('cam-top', () => {
      this.setFollowCam(false);
      this.sceneRenderer.flyToPreset('top');
    });
    on('cam-reset', () => {
      this.setFollowCam(false);
      this.sceneRenderer.flyToPreset('reset');
    });

    // Eye POV & PiP overlay controls
    on('pip-optics-btn', () => this.toggleEyeOptics());
    on('pip-sensory-btn', () => this.toggleEyeSensory());
    on('pip-expand-btn', () => this.setEyeViewMode('fullscreen'));
    on('pip-close-btn', () => this.setEyeViewMode('off'));

    on('eye-optics-btn', () => this.toggleEyeOptics());
    on('eye-sensory-btn', () => this.toggleEyeSensory());
    on('eye-to-pip-btn', () => this.setEyeViewMode('pip'));
    on('eye-exit-top-btn', () => this.setEyeViewMode('off'));

    // Stop pointer/wheel events on interactive HUD surfaces from reaching OrbitControls
    const stopIds = [
      'pip-eyecam-container',
      'eye-hud-top',
      'eye-hud-bottom',
      'inspector-card',
      'codex-drawer',
      'lab-drawer',
      'top-toolbar',
      'bottom-left-graph',
      'bottom-cam-bar',
    ];
    for (const id of stopIds) {
      const el = document.getElementById(id);
      if (!el) continue;
      for (const evt of ['pointerdown', 'pointerup', 'click', 'wheel']) {
        el.addEventListener(evt, (e) => e.stopPropagation());
      }
    }
  }

  private bindKeyboard(): void {
    window.addEventListener('keydown', (e) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      const k = e.key.toLowerCase();

      if (k === 'v' && this.sceneRenderer.eyeSystem.canUseEyeView(this.sceneRenderer.selectedEntity)) {
        this.setEyeViewMode(this.sceneRenderer.eyeSystem.mode === 'fullscreen' ? 'off' : 'fullscreen');
      } else if (k === 'p' && this.sceneRenderer.eyeSystem.canUseEyeView(this.sceneRenderer.selectedEntity)) {
        this.setEyeViewMode(this.sceneRenderer.eyeSystem.mode === 'pip' ? 'off' : 'pip');
      } else if (k === 'f' && this.sceneRenderer.selectedEntity) {
        this.setFollowCam(!this.sceneRenderer.followCam);
      } else if (k === 'g' && this.sceneRenderer.eyeSystem.mode !== 'fullscreen') {
        this.toggleFeedMode();
      } else if (k === 'c' && this.sceneRenderer.eyeSystem.mode !== 'fullscreen') {
        if (!this.codex.isOpen()) this.lab.setOpen(false);
        this.codex.toggle();
      } else if (k === 'e' && this.sceneRenderer.eyeSystem.mode !== 'fullscreen') {
        if (!this.lab.isOpen()) this.codex.setOpen(false);
        this.lab.toggle();
      } else if (k === 'm') {
        const active = this.audio.toggle();
        document.getElementById('btn-audio')?.classList.toggle('active-btn', active);
        setElText('btn-audio-label', active ? 'Audio: ON' : 'Audio');
      } else if (k === 'h' && this.sceneRenderer.eyeSystem.mode !== 'fullscreen') {
        const hud = document.getElementById('hud-root');
        if (hud) this.setHudHidden(!hud.classList.contains('hidden'));
      } else if (e.key === ' ') {
        e.preventDefault();
        const next = this.sim.simSpeed === 0 ? 1 : 0;
        this.sim.simSpeed = next;
        for (const s2 of [0, 0.5, 1, 2, 4]) {
          document.getElementById(`speed-${s2}`)?.classList.toggle('active-btn', s2 === next);
        }
        this.showToast(next === 0 ? 'Simulation Paused' : 'Simulation Resumed (1x)');
      } else if (e.key === 'Escape') {
        if (this.sceneRenderer.eyeSystem.mode !== 'off') this.setEyeViewMode('off');
        else if (this.sceneRenderer.feedMode) this.toggleFeedMode(false);
        else if (this.codex.isOpen()) this.codex.setOpen(false);
        else if (this.lab.isOpen()) this.lab.setOpen(false);
      }
    });
  }

  private cycleNextSpecimen(): void {
    const sel = this.sceneRenderer.selectedEntity;
    if (!sel) return;
    if (sel.kind === 'animal' || sel.kind === 'corpse') {
      const alive = this.sim.animals.filter((a) => a.alive);
      if (alive.length === 0) return;
      const idx = alive.findIndex((a) => a.id === sel.id);
      const next = alive[(idx + 1) % alive.length];
      this.sceneRenderer.selectEntity(next, true);
    } else if (sel.kind === 'plant') {
      const alive = this.sim.plants.filter((p) => p.alive);
      if (alive.length === 0) return;
      const idx = alive.findIndex((p) => p.id === sel.id);
      const next = alive[(idx + 1) % alive.length];
      this.sceneRenderer.selectEntity(next, true);
    }
  }

  toggleFeedMode(force?: boolean): void {
    const next = force !== undefined ? force : !this.sceneRenderer.feedMode;
    this.sceneRenderer.feedMode = next;
    document.getElementById('btn-feed-mode')?.classList.toggle('active-btn', next);
    document.body.classList.toggle('cursor-feed', next);
    if (next) {
      this.showToast('Feed Mode ON — Click water surface to drop nutrient pellets (Esc/G to exit)');
    } else {
      this.showToast('Feed Mode OFF');
    }
  }

  setFollowCam(active: boolean): void {
    const ok = !!(active && this.sceneRenderer.selectedEntity && this.sceneRenderer.selectedEntity.alive);
    this.sceneRenderer.followCam = ok;
    this.inspector.setFollowState(ok);
  }

  setHudHidden(hidden: boolean): void {
    document.getElementById('hud-root')?.classList.toggle('hidden', hidden);
    document.getElementById('show-hud-btn')?.classList.toggle('hidden', !hidden);
  }

  setEyeViewMode(mode: EyeViewMode): void {
    const eye = this.sceneRenderer.eyeSystem;
    if (mode !== 'off' && !eye.canUseEyeView(this.sceneRenderer.selectedEntity)) mode = 'off';
    const prev = eye.mode;
    if (prev === mode) return;

    const hud = document.getElementById('hud-root');
    const showBtn = document.getElementById('show-hud-btn');
    const fullOverlay = document.getElementById('eye-fullscreen-overlay');
    const pipBox = document.getElementById('pip-eyecam-container');

    if (prev === 'fullscreen') {
      fullOverlay?.classList.add('hidden');
      this.sceneRenderer.renderer.domElement.style.filter = '';
      this.sceneRenderer.controls.enabled = true;
      this.setHudHidden(this.hudHiddenBeforeEye);
    }

    eye.mode = mode;

    if (mode === 'fullscreen') {
      this.toggleFeedMode(false);
      this.codex.setOpen(false);
      this.lab.setOpen(false);
      this.hudHiddenBeforeEye = hud ? hud.classList.contains('hidden') : false;
      hud?.classList.add('hidden');
      showBtn?.classList.add('hidden');
      pipBox?.classList.add('hidden');
      fullOverlay?.classList.remove('hidden');
      this.sceneRenderer.controls.enabled = false;
      eye.resetSmoothing();
      eye.camera.aspect = Math.max(1, window.innerWidth) / Math.max(1, window.innerHeight);
      eye.camera.updateProjectionMatrix();
    } else if (mode === 'pip') {
      pipBox?.classList.remove('hidden');
      eye.resetSmoothing();
    } else {
      pipBox?.classList.add('hidden');
      this.sceneRenderer.renderer.domElement.style.filter = '';
      if (this.pipViewportEl) this.pipViewportEl.style.backdropFilter = '';
    }

    this.syncEyeViewUI();
  }

  toggleEyeOptics(): void {
    const eye = this.sceneRenderer.eyeSystem;
    eye.opticsMode = eye.opticsMode === 'biological' ? 'natural' : 'biological';
    this.syncEyeViewUI();
  }

  toggleEyeSensory(): void {
    const eye = this.sceneRenderer.eyeSystem;
    eye.sensoryEnabled = !eye.sensoryEnabled;
    this.syncEyeViewUI();
  }

  syncEyeViewUI(): void {
    const eye = this.sceneRenderer.eyeSystem;
    const e = this.sceneRenderer.selectedEntity;
    const can = eye.canUseEyeView(e);

    const eyeBtn = document.getElementById('insp-eyeview-btn') as HTMLButtonElement | null;
    const pipBtn = document.getElementById('insp-pip-btn') as HTMLButtonElement | null;
    const noOc = document.getElementById('insp-no-ocular-note');

    if (eyeBtn && pipBtn) {
      eyeBtn.disabled = !can;
      pipBtn.disabled = !can;
      eyeBtn.title = can ? 'Full-Screen Creature Eye View (V)' : 'No ocular organs';
      pipBtn.title = can ? 'Live Picture-in-Picture Eye-Cam (P)' : 'No ocular organs';
      eyeBtn.classList.toggle('active-btn', eye.mode === 'fullscreen');
      pipBtn.classList.toggle('active-btn', eye.mode === 'pip');
      setElText('insp-eyeview-label', eye.mode === 'fullscreen' ? 'Exit POV (V)' : 'Eye View (V)');
      setElText('insp-pip-label', eye.mode === 'pip' ? 'PiP Cam: ON' : 'PiP Cam (P)');
      noOc?.classList.toggle('hidden', !e || can);
    }

    const bio = eye.opticsMode === 'biological';
    document.getElementById('eye-optics-btn')?.classList.toggle('active-btn', bio);
    document.getElementById('eye-sensory-btn')?.classList.toggle('active-btn', eye.sensoryEnabled);
    document.getElementById('pip-optics-btn')?.classList.toggle('active-btn', bio);
    document.getElementById('pip-sensory-btn')?.classList.toggle('active-btn', eye.sensoryEnabled);

    setElText('eye-optics-label', bio ? 'Optics: Biological' : 'Optics: Natural');
    setElText('eye-sensory-label', eye.sensoryEnabled ? 'Sensory HUD: ON' : 'Sensory HUD: OFF');
    setElText('pip-optics-pill', bio ? 'BIO OPTICS' : 'NATURAL');

    if (can) this.updateEyeTelemetry(e);
  }

  private updateEyeTelemetry(e: AnimalEntity | CorpseEntity): void {
    const eye = this.sceneRenderer.eyeSystem;
    const prof = eye.getVisionProfile(e.genome);
    const fov = eye.opticsMode === 'biological' ? prof.fov : 82;
    const modeTxt = eye.opticsMode === 'biological' ? prof.label : 'Natural Optics';

    setElText('eye-species-name', e.genome.speciesName);
    setElText('eye-vision-badge', `${modeTxt} · ${fov}° FOV`);
    setElText('eye-state-label', (e.state || 'Active').toUpperCase());
    setElText('eye-stage-label', e.stage || 'Adult');

    setElText('pip-species-name', e.genome.speciesName);
    setElText('pip-vision-meta', `${modeTxt} · ${fov}° FOV`);
    setElText('pip-state-badge', (e.state || 'Active').toUpperCase());

    const hpPct = e.kind === 'animal' ? Math.round(safeRatio(e.hp, e.maxHp) * 100) : 0;
    const enPct =
      e.kind === 'animal'
        ? Math.round(safeRatio(e.energy, e.maxEnergy) * 100)
        : Math.round(safeRatio(e.nutrients, e.maxNutrients) * 100);
    setElText('eye-hp-val', `${hpPct}%`);
    setElText('eye-en-val', `${enPct}%`);
    const hpF = document.getElementById('eye-hp-fill');
    const enF = document.getElementById('eye-en-fill');
    if (hpF) hpF.style.width = `${hpPct}%`;
    if (enF) enF.style.width = `${enPct}%`;
  }

  private appendLog(message: string, toneClass: string): void {
    const log = document.getElementById('event-log');
    if (!log) return;
    const row = document.createElement('div');
    row.className = `log-row ${toneClass}`;
    row.textContent = `• ${message}`;
    log.prepend(row);
    while (log.children.length > 28) {
      log.removeChild(log.lastChild!);
    }
  }

  showToast(message: string): void {
    const el = document.getElementById('toast-banner');
    if (!el) return;
    el.textContent = message;
    el.classList.add('toast-visible');
    if (this.toastTimer !== null) window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => {
      el.classList.remove('toast-visible');
    }, 2200);
  }

  refresh(nowMs: number, fps: number): void {
    if (nowMs - this.lastHudRefresh < 180) return;
    this.lastHudRefresh = nowMs;

    setElText('stat-animals', String(this.sim.animals.length));
    setElText('stat-plants', String(this.sim.plants.length));
    setElText('stat-species', String(this.sim.getActiveSpeciesCount()));
    setElText(
      'stat-vent-timer',
      this.sim.env.autoGenesisEnabled ? `${Math.max(0, Math.ceil(this.sim.genesisCountdown))}s` : 'OFF'
    );
    setElText('stat-fps', String(fps));

    // Solar time indicator in brand bar
    const tod = this.sim.env.timeOfDay;
    const solarIcon = tod < 0.22 || tod >= 0.82 ? '☾' : tod < 0.34 || tod > 0.72 ? '◐' : '☀';
    setElText('stat-solar', solarIcon);

    this.popGraph.render(this.sim.history);

    const sel = this.sceneRenderer.selectedEntity;
    if (sel && sel.alive) {
      this.inspector.update(sel, this.sceneRenderer.eyeSystem);
      if (this.sceneRenderer.eyeSystem.mode !== 'off' && this.sceneRenderer.eyeSystem.canUseEyeView(sel)) {
        this.updateEyeTelemetry(sel);
      }
    }

    if (this.codex.isOpen()) this.codex.render();
    if (this.lab.isOpen()) this.lab.syncFromEnv();
    this.audio.updateCurrentAmbience(this.sim.env.currentStrength);
  }
}
