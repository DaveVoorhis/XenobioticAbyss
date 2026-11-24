import type { EventBus } from '../core/EventBus';

/**
 * Procedural Web Audio underwater soundscape engine.
 * Zero external audio assets required; generates deep abyssal drone,
 * filtered water current noise, and subtle resonant chimes for genesis/speciation.
 * Starts muted by default to respect browser autoplay policies.
 */
export class AmbientAudioEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private noiseFilter: BiquadFilterNode | null = null;
  private tearNoiseBuffer: AudioBuffer | null = null;
  private lastTearTime = 0;
  private enabled = false;

  constructor(events: EventBus) {
    events.on('audio:cue', ({ type }) => {
      if (!this.enabled) return;
      this.playCue(type);
    });
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  toggle(): boolean {
    if (!this.enabled) {
      this.enable();
    } else {
      this.disable();
    }
    return this.enabled;
  }

  private initAudioGraph(): void {
    if (this.ctx) return;
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;

    const ctx = new AudioCtx();
    const master = ctx.createGain();
    master.gain.value = 0.0001;
    master.connect(ctx.destination);

    // 1. Deep abyssal harmonic drone (two softly detuned sine/triangle oscillators)
    const oscA = ctx.createOscillator();
    oscA.type = 'sine';
    oscA.frequency.value = 55; // A1
    const oscB = ctx.createOscillator();
    oscB.type = 'triangle';
    oscB.frequency.value = 82.41; // E2

    const droneFilter = ctx.createBiquadFilter();
    droneFilter.type = 'lowpass';
    droneFilter.frequency.value = 160;

    const droneGain = ctx.createGain();
    droneGain.gain.value = 0.12;
    oscA.connect(droneFilter);
    oscB.connect(droneFilter);
    droneFilter.connect(droneGain);
    droneGain.connect(master);
    oscA.start();
    oscB.start();

    // 2. Filtered underwater current / hydrothermal vent rumble (looping brown-ish noise)
    const bufLen = ctx.sampleRate * 2;
    const buffer = ctx.createBuffer(1, bufLen, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let lastOut = 0;
    for (let i = 0; i < bufLen; i++) {
      const white = Math.random() * 2 - 1;
      data[i] = (lastOut + 0.02 * white) / 1.02;
      lastOut = data[i];
      data[i] *= 2.8;
    }

    const noiseSrc = ctx.createBufferSource();
    noiseSrc.buffer = buffer;
    noiseSrc.loop = true;

    const noiseFilter = ctx.createBiquadFilter();
    noiseFilter.type = 'lowpass';
    noiseFilter.frequency.value = 240;
    noiseFilter.Q.value = 1.4;

    const noiseGain = ctx.createGain();
    noiseGain.gain.value = 0.16;

    noiseSrc.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(master);
    noiseSrc.start();

    // 3. Short white-noise buffer reused for subtle muffled underwater tearing/crunch cues
    const tearLen = Math.max(1, Math.floor(ctx.sampleRate * 0.12));
    const tearBuf = ctx.createBuffer(1, tearLen, ctx.sampleRate);
    const tearData = tearBuf.getChannelData(0);
    for (let i = 0; i < tearLen; i++) {
      const env = Math.sin((i / tearLen) * Math.PI);
      tearData[i] = (Math.random() * 2 - 1) * env;
    }

    this.ctx = ctx;
    this.masterGain = master;
    this.noiseFilter = noiseFilter;
    this.tearNoiseBuffer = tearBuf;
  }

  enable(): void {
    try {
      this.initAudioGraph();
      if (!this.ctx || !this.masterGain) return;
      if (this.ctx.state === 'suspended') {
        void this.ctx.resume();
      }
      const now = this.ctx.currentTime;
      this.masterGain.gain.cancelScheduledValues(now);
      this.masterGain.gain.setTargetAtTime(0.32, now, 0.35);
      this.enabled = true;
    } catch {
      this.enabled = false;
    }
  }

  disable(): void {
    this.enabled = false;
    if (this.ctx && this.masterGain) {
      const now = this.ctx.currentTime;
      this.masterGain.gain.cancelScheduledValues(now);
      this.masterGain.gain.setTargetAtTime(0.0001, now, 0.25);
    }
  }

  updateCurrentAmbience(currentStrength: number): void {
    if (!this.enabled || !this.ctx || !this.noiseFilter) return;
    const targetFreq = 160 + currentStrength * 220;
    this.noiseFilter.frequency.setTargetAtTime(targetFreq, this.ctx.currentTime, 0.4);
  }

  private playCue(
    type: 'biogenesis' | 'phytogenesis' | 'speciation' | 'feed' | 'strike' | 'bubble' | 'tear'
  ): void {
    if (!this.ctx || !this.masterGain) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;

    if (type === 'tear') {
      // Rate-limit tearing cues so active feeding frenzies stay clean and underwater-muffled
      if (now - this.lastTearTime < 0.14) return;
      this.lastTearTime = now;

      if (this.tearNoiseBuffer) {
        const noise = ctx.createBufferSource();
        noise.buffer = this.tearNoiseBuffer;

        const filter = ctx.createBiquadFilter();
        filter.type = 'bandpass';
        const startFreq = 460 + Math.random() * 260;
        filter.frequency.setValueAtTime(startFreq, now);
        filter.frequency.exponentialRampToValueAtTime(190, now + 0.095);
        filter.Q.value = 1.8;

        const nGain = ctx.createGain();
        nGain.gain.setValueAtTime(0.001, now);
        nGain.gain.linearRampToValueAtTime(0.09, now + 0.012);
        nGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.105);

        noise.connect(filter);
        filter.connect(nGain);
        nGain.connect(this.masterGain);
        noise.start(now);
        noise.stop(now + 0.11);
      }

      // Soft muffled jaw snap / bite thump
      const thump = ctx.createOscillator();
      const tGain = ctx.createGain();
      thump.type = 'triangle';
      const thumpBase = 175 + Math.random() * 45;
      thump.frequency.setValueAtTime(thumpBase, now);
      thump.frequency.exponentialRampToValueAtTime(72, now + 0.065);
      tGain.gain.setValueAtTime(0.001, now);
      tGain.gain.linearRampToValueAtTime(0.055, now + 0.008);
      tGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.075);
      thump.connect(tGain);
      tGain.connect(this.masterGain);
      thump.start(now);
      thump.stop(now + 0.085);
      return;
    }

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    if (type === 'biogenesis') {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(329.63, now);
      osc.frequency.exponentialRampToValueAtTime(523.25, now + 0.45);
      gain.gain.setValueAtTime(0.001, now);
      gain.gain.linearRampToValueAtTime(0.14, now + 0.06);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.9);
      osc.connect(gain);
      gain.connect(this.masterGain);
      osc.start(now);
      osc.stop(now + 0.95);
    } else if (type === 'phytogenesis') {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(261.63, now);
      osc.frequency.exponentialRampToValueAtTime(392.0, now + 0.4);
      gain.gain.setValueAtTime(0.001, now);
      gain.gain.linearRampToValueAtTime(0.12, now + 0.06);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.85);
      osc.connect(gain);
      gain.connect(this.masterGain);
      osc.start(now);
      osc.stop(now + 0.9);
    } else if (type === 'speciation') {
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(440, now);
      osc.frequency.exponentialRampToValueAtTime(659.25, now + 0.32);
      gain.gain.setValueAtTime(0.001, now);
      gain.gain.linearRampToValueAtTime(0.1, now + 0.04);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.7);
      osc.connect(gain);
      gain.connect(this.masterGain);
      osc.start(now);
      osc.stop(now + 0.75);
    } else if (type === 'feed' || type === 'bubble') {
      // Soft underwater bubble pop
      osc.type = 'sine';
      const base = 360 + Math.random() * 240;
      osc.frequency.setValueAtTime(base, now);
      osc.frequency.exponentialRampToValueAtTime(base * 1.9, now + 0.09);
      gain.gain.setValueAtTime(0.001, now);
      gain.gain.linearRampToValueAtTime(0.08, now + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);
      osc.connect(gain);
      gain.connect(this.masterGain);
      osc.start(now);
      osc.stop(now + 0.14);
    } else if (type === 'strike') {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(140, now);
      osc.frequency.exponentialRampToValueAtTime(52, now + 0.14);
      gain.gain.setValueAtTime(0.001, now);
      gain.gain.linearRampToValueAtTime(0.09, now + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);
      osc.connect(gain);
      gain.connect(this.masterGain);
      osc.start(now);
      osc.stop(now + 0.2);
    }
  }
}
