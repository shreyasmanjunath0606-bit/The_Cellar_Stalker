import * as THREE from 'three';

/** Fully synthesized audio — no external assets. */
export class AudioManager {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private noise!: AudioBuffer;
  private readonly fwd = new THREE.Vector3();
  private proxGain!: GainNode;
  private heartTimer = 0;

  /** Must be called from a user gesture. */
  start(): void {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.8;
      this.master.connect(this.ctx.destination);
      this.noise = this.makeNoise(2);
      this.startAmbient();
    }
    void this.ctx.resume();
  }

  suspend(): void {
    void this.ctx?.suspend();
  }

  updateListener(camera: THREE.Camera): void {
    if (!this.ctx) return;
    const l = this.ctx.listener;
    camera.getWorldDirection(this.fwd);
    const p = camera.position;
    l.positionX.value = p.x;
    l.positionY.value = p.y;
    l.positionZ.value = p.z;
    l.forwardX.value = this.fwd.x;
    l.forwardY.value = this.fwd.y;
    l.forwardZ.value = this.fwd.z;
    l.upX.value = 0;
    l.upY.value = 1;
    l.upZ.value = 0;
  }

  /** Soft thud with a filtered-noise scuff. `intensity` 0..1. */
  playFootstep(pos: THREE.Vector3, intensity: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const out = this.spatial(pos);

    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 180 + Math.random() * 220;
    bp.Q.value = 0.9;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.5 * intensity, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
    src.connect(bp).connect(g).connect(out);
    src.start(t, Math.random(), 0.2);

    const thump = ctx.createOscillator();
    thump.frequency.setValueAtTime(95, t);
    thump.frequency.exponentialRampToValueAtTime(40, t + 0.12);
    const tg = ctx.createGain();
    tg.gain.setValueAtTime(0.35 * intensity, t);
    tg.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
    thump.connect(tg).connect(out);
    thump.start(t);
    thump.stop(t + 0.2);
  }

  /** Wood creak — a descending, wobbling sawtooth through a resonant filter. */
  playCreak(pos: THREE.Vector3, intensity = 1): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const dur = 0.5 + Math.random() * 0.5;
    const out = this.spatial(pos);

    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    const f0 = 140 + Math.random() * 120;
    osc.frequency.setValueAtTime(f0, t);
    osc.frequency.linearRampToValueAtTime(f0 * (0.6 + Math.random() * 0.8), t + dur);
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 22 + Math.random() * 20;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 18;
    lfo.connect(lfoGain).connect(osc.frequency);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 600 + Math.random() * 500;
    bp.Q.value = 8;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.25 * intensity, t + 0.05);
    g.gain.linearRampToValueAtTime(0, t + dur);
    osc.connect(bp).connect(g).connect(out);
    osc.start(t);
    lfo.start(t);
    osc.stop(t + dur);
    lfo.stop(t + dur);
  }

  /** Object hitting the floor. Metallic ones ring; others thud. `intensity` 0..1. */
  playImpact(pos: THREE.Vector3, intensity: number, metallic = false): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const out = this.spatial(pos);
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    const g = ctx.createGain();
    if (metallic) {
      f.type = 'bandpass';
      f.frequency.value = 1800 + Math.random() * 1200;
      f.Q.value = 5;
      g.gain.setValueAtTime(0.7 * intensity, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
      for (const freq of [520 + Math.random() * 80, 830 + Math.random() * 120]) {
        const o = ctx.createOscillator();
        o.frequency.value = freq;
        const og = ctx.createGain();
        og.gain.setValueAtTime(0.25 * intensity, t);
        og.gain.exponentialRampToValueAtTime(0.001, t + 0.7);
        o.connect(og).connect(out);
        o.start(t);
        o.stop(t + 0.75);
      }
    } else {
      f.type = 'lowpass';
      f.frequency.value = 700;
      g.gain.setValueAtTime(0.9 * intensity, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
      const thump = ctx.createOscillator();
      thump.frequency.setValueAtTime(130, t);
      thump.frequency.exponentialRampToValueAtTime(45, t + 0.2);
      const tg = ctx.createGain();
      tg.gain.setValueAtTime(0.6 * intensity, t);
      tg.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
      thump.connect(tg).connect(out);
      thump.start(t);
      thump.stop(t + 0.3);
    }
    src.connect(f).connect(g).connect(out);
    src.start(t, Math.random(), 0.8);
  }

  /** Ceramic shattering: a cluster of bright noise grains. */
  playShatter(pos: THREE.Vector3): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const out = this.spatial(pos);
    for (let i = 0; i < 10; i++) {
      const start = t + (i === 0 ? 0 : Math.random() * 0.45);
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 2500 + Math.random() * 5000;
      bp.Q.value = 2;
      const g = ctx.createGain();
      g.gain.setValueAtTime(i === 0 ? 0.9 : 0.35 * Math.random(), start);
      g.gain.exponentialRampToValueAtTime(0.001, start + 0.12 + Math.random() * 0.2);
      src.connect(bp).connect(g).connect(out);
      src.start(start, Math.random(), 0.4);
    }
  }

  /** Call every frame. `intensity` 0..1 sets both the tempo and loudness; below ~0.08 it is silent. */
  updateHeartbeat(dt: number, intensity: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    if (intensity < 0.08) {
      this.heartTimer = 0;
      return;
    }
    this.heartTimer -= dt;
    if (this.heartTimer > 0) return;
    this.heartTimer = 60 / (70 + 110 * intensity);
    const t = ctx.currentTime;
    const vol = 0.25 + 0.5 * intensity;
    this.thump(t, vol);
    this.thump(t + 0.17, vol * 0.7);
  }

  /** Swells a low dissonant drone as the stalker closes in. `k` 0..1. */
  setProximity(k: number): void {
    if (this.ctx) this.proxGain.gain.setTargetAtTime(k * 0.3, this.ctx.currentTime, 0.25);
  }

  /** Dissonant sting when the stalker starts chasing. */
  playStinger(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1100;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.3, t + 0.04);
    g.gain.exponentialRampToValueAtTime(0.001, t + 1.8);
    lp.connect(g).connect(this.master);
    for (const f of [196, 207.7, 277.2]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(f, t);
      o.frequency.exponentialRampToValueAtTime(f * 0.94, t + 1.8);
      o.connect(lp);
      o.start(t);
      o.stop(t + 1.9);
    }
    this.thump(t, 0.9);
  }

  /** The jumpscare: a distorted, wobbling shriek over a sub boom. */
  playScreech(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const shaper = ctx.createWaveShaper();
    const curve = new Float32Array(256);
    for (let i = 0; i < 256; i++) curve[i] = Math.tanh(((i / 255) * 2 - 1) * 4);
    shaper.curve = curve;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.55, t + 0.02);
    g.gain.setValueAtTime(0.55, t + 0.9);
    g.gain.exponentialRampToValueAtTime(0.001, t + 1.6);
    shaper.connect(g).connect(this.master);

    for (const [type, f0, f1] of [['sawtooth', 700, 2600], ['square', 1100, 3100]] as const) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.setValueAtTime(f0, t);
      o.frequency.exponentialRampToValueAtTime(f1, t + 0.9);
      const vib = ctx.createOscillator();
      vib.frequency.value = 40;
      const vg = ctx.createGain();
      vg.gain.value = 120;
      vib.connect(vg).connect(o.frequency);
      o.connect(shaper);
      o.start(t);
      vib.start(t);
      o.stop(t + 1.7);
      vib.stop(t + 1.7);
    }

    const noise = ctx.createBufferSource();
    noise.buffer = this.noise;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 1500;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.5, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.7);
    noise.connect(hp).connect(ng).connect(this.master);
    noise.start(t);

    const boom = ctx.createOscillator();
    boom.frequency.setValueAtTime(70, t);
    boom.frequency.exponentialRampToValueAtTime(28, t + 1);
    const bg = ctx.createGain();
    bg.gain.setValueAtTime(0.9, t);
    bg.gain.exponentialRampToValueAtTime(0.001, t + 1.1);
    boom.connect(bg).connect(this.master);
    boom.start(t);
    boom.stop(t + 1.2);
  }

  /** Heavy grinding of the cellar door rising. */
  playDoorOpen(pos: THREE.Vector3): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const out = this.spatial(pos);
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(48, t);
    o.frequency.linearRampToValueAtTime(62, t + 2);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 320;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.5, t + 0.2);
    g.gain.linearRampToValueAtTime(0, t + 2.2);
    o.connect(lp).connect(g).connect(out);
    o.start(t);
    o.stop(t + 2.3);

    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(200, t);
    bp.frequency.linearRampToValueAtTime(900, t + 2);
    bp.Q.value = 3;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.35, t);
    ng.gain.linearRampToValueAtTime(0, t + 2.2);
    src.connect(bp).connect(ng).connect(out);
    src.start(t, 0, 2.3);
  }

  private thump(t: number, vol: number): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(75, t);
    o.frequency.exponentialRampToValueAtTime(35, t + 0.12);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 0.2);
  }

  playPickup(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    for (const [i, freq] of [660, 990].entries()) {
      const o = ctx.createOscillator();
      o.frequency.value = freq;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t + i * 0.08);
      g.gain.exponentialRampToValueAtTime(0.18, t + i * 0.08 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.08 + 0.25);
      o.connect(g).connect(this.master);
      o.start(t + i * 0.08);
      o.stop(t + i * 0.08 + 0.3);
    }
  }

  private spatial(pos: THREE.Vector3): AudioNode {
    const ctx = this.ctx!;
    const panner = ctx.createPanner();
    panner.panningModel = 'HRTF';
    panner.distanceModel = 'inverse';
    panner.refDistance = 1.5;
    panner.rolloffFactor = 1.4;
    panner.positionX.value = pos.x;
    panner.positionY.value = pos.y;
    panner.positionZ.value = pos.z;
    panner.connect(this.master);
    return panner;
  }

  private makeNoise(seconds: number): AudioBuffer {
    const ctx = this.ctx!;
    const buf = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  private startAmbient(): void {
    const ctx = this.ctx!;
    const bus = ctx.createGain();
    bus.gain.value = 0.35;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 140;
    lp.connect(bus).connect(this.master);

    for (const [type, freq] of [['sawtooth', 38], ['sine', 55.4], ['sine', 27.5]] as const) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = freq;
      o.connect(lp);
      o.start();
    }

    // slow breathing of the hum
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.09;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.12;
    lfo.connect(lfoGain).connect(bus.gain);
    lfo.start();

    // stalker-proximity drone: silent until setProximity() raises it
    this.proxGain = ctx.createGain();
    this.proxGain.gain.value = 0;
    const proxLp = ctx.createBiquadFilter();
    proxLp.type = 'lowpass';
    proxLp.frequency.value = 220;
    proxLp.connect(this.proxGain).connect(this.master);
    for (const [type, freq] of [['sawtooth', 61], ['sine', 64.5]] as const) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = freq;
      o.connect(proxLp);
      o.start();
    }

    // distant air / draft
    const air = ctx.createBufferSource();
    air.buffer = this.noise;
    air.loop = true;
    const airLp = ctx.createBiquadFilter();
    airLp.type = 'lowpass';
    airLp.frequency.value = 380;
    const airGain = ctx.createGain();
    airGain.gain.value = 0.06;
    air.connect(airLp).connect(airGain).connect(this.master);
    air.start();
  }
}
