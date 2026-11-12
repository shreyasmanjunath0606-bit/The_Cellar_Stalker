import * as THREE from 'three';

/** Fully synthesized audio — no external assets. */
export class AudioManager {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private noise!: AudioBuffer;
  private readonly fwd = new THREE.Vector3();
  private proxGain!: GainNode;
  private heartTimer = 0;
  private volume = 0.8;
  private ducked = false;
  private ambienceTimer = 12;

  /** Must be called from a user gesture. */
  start(): void {
    if (!this.ctx) {
      const Ctor =
        window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return; // no Web Audio: the game simply runs silent
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      // the jumpscare stacks several loud layers; a limiter keeps it from clipping
      const limiter = this.ctx.createDynamicsCompressor();
      limiter.threshold.value = -10;
      limiter.knee.value = 8;
      limiter.ratio.value = 12;
      limiter.attack.value = 0.003;
      limiter.release.value = 0.2;
      this.master.connect(limiter).connect(this.ctx.destination);
      this.noise = this.makeNoise(2);
      this.startAmbient();
      this.applyGain(0);
    }
    void this.ctx.resume();
  }

  /** Master volume 0..1. */
  setVolume(v: number): void {
    this.volume = v;
    this.applyGain(0.05);
  }

  /** Pull the mix down while a menu is over the game. */
  setDucked(ducked: boolean): void {
    this.ducked = ducked;
    this.applyGain(0.25);
  }

  private applyGain(timeConstant: number): void {
    if (!this.ctx) return;
    const target = this.volume * (this.ducked ? 0.3 : 1);
    if (timeConstant <= 0) this.master.gain.value = target;
    else this.master.gain.setTargetAtTime(target, this.ctx.currentTime, timeConstant);
  }

  /** Menu tick. */
  playUi(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(190, t);
    o.frequency.exponentialRampToValueAtTime(110, t + 0.07);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.22, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 0.1);
  }

  /** Her tuneless humming while she wanders — the player's main way to track her by ear. */
  playMoan(pos: THREE.Vector3): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const dur = 1.6 + Math.random() * 1.2;
    const out = this.spatial(pos);
    const lp = ctx.createBiquadFilter();
    lp.type = 'bandpass';
    lp.frequency.value = 520;
    lp.Q.value = 1.4;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.5, t + 0.35);
    g.gain.linearRampToValueAtTime(0.35, t + dur * 0.7);
    g.gain.linearRampToValueAtTime(0, t + dur);
    lp.connect(g).connect(out);
    const base = 150 + Math.random() * 50;
    const fall = 0.82 + Math.random() * 0.12;
    for (const mult of [1, 1.006, 1.5]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(base * mult, t);
      o.frequency.linearRampToValueAtTime(base * mult * 1.12, t + dur * 0.3);
      o.frequency.linearRampToValueAtTime(base * mult * fall, t + dur);
      const vib = ctx.createOscillator();
      vib.frequency.value = 5.5;
      const vg = ctx.createGain();
      vg.gain.value = 4;
      vib.connect(vg).connect(o.frequency);
      o.connect(lp);
      o.start(t);
      vib.start(t);
      o.stop(t + dur + 0.05);
      vib.stop(t + dur + 0.05);
    }
  }

  /** A wet rattle in her throat when something catches her attention. */
  playGrowl(pos: THREE.Vector3): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const dur = 0.9;
    const out = this.spatial(pos);
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(82, t);
    o.frequency.linearRampToValueAtTime(58, t + dur);
    const rattle = ctx.createOscillator();
    rattle.type = 'square';
    rattle.frequency.value = 27;
    const am = ctx.createGain();
    am.gain.value = 0.5;
    const rg = ctx.createGain();
    rg.gain.value = 0.5;
    rattle.connect(rg).connect(am.gain);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 700;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.8, t + 0.08);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(am).connect(lp).connect(g).connect(out);
    o.start(t);
    rattle.start(t);
    o.stop(t + dur + 0.05);
    rattle.stop(t + dur + 0.05);
  }

  /** Electrical crackle from a surging bulb. */
  playSpark(pos: THREE.Vector3): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const out = this.spatial(pos);
    for (let i = 0; i < 5; i++) {
      const start = t + i * (0.02 + Math.random() * 0.05);
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 3000 + Math.random() * 3000;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.5 * Math.random() + 0.2, start);
      g.gain.exponentialRampToValueAtTime(0.001, start + 0.04);
      src.connect(hp).connect(g).connect(out);
      src.start(start, Math.random(), 0.06);
    }
    const hum = ctx.createOscillator();
    hum.type = 'sawtooth';
    hum.frequency.value = 100;
    const hg = ctx.createGain();
    hg.gain.setValueAtTime(0.12, t);
    hg.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
    hum.connect(hg).connect(out);
    hum.start(t);
    hum.stop(t + 0.55);
  }

  /** Night survived: a cold open fifth swelling out of the dark. */
  playEscape(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.28, t + 1.2);
    g.gain.linearRampToValueAtTime(0, t + 5);
    g.connect(this.master);
    for (const f of [110, 164.8, 220, 329.6, 440]) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f;
      const og = ctx.createGain();
      og.gain.value = f > 300 ? 0.35 : 1;
      o.connect(og).connect(g);
      o.start(t);
      o.stop(t + 5.1);
    }
  }

  /** Out of chances: a detuned cluster sinking into the floor. */
  playGameOver(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(900, t);
    lp.frequency.exponentialRampToValueAtTime(120, t + 3.5);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.3, t);
    g.gain.linearRampToValueAtTime(0, t + 4);
    lp.connect(g).connect(this.master);
    for (const f of [98, 103.8, 146.8]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(f, t);
      o.frequency.exponentialRampToValueAtTime(f * 0.5, t + 4);
      o.connect(lp);
      o.start(t);
      o.stop(t + 4.1);
    }
  }

  /** Call every frame while playing: now and then the house knocks or settles somewhere out of sight. */
  updateAmbience(dt: number, listener: THREE.Vector3): void {
    if (!this.ctx) return;
    this.ambienceTimer -= dt;
    if (this.ambienceTimer > 0) return;
    this.ambienceTimer = 16 + Math.random() * 26;
    const a = Math.random() * Math.PI * 2;
    const d = 9 + Math.random() * 6;
    const pos = new THREE.Vector3(listener.x + Math.cos(a) * d, 1 + Math.random() * 2, listener.z + Math.sin(a) * d);
    if (Math.random() < 0.5) {
      this.playCreak(pos, 3);
    } else {
      const knocks = 1 + Math.floor(Math.random() * 3);
      for (let i = 0; i < knocks; i++) window.setTimeout(() => this.playImpact(pos, 1), i * 260);
    }
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
  updateHeartbeat(dt: number, intensity: number): boolean {
    if (intensity < 0.08) {
      this.heartTimer = 0;
      return false;
    }
    this.heartTimer -= dt;
    if (this.heartTimer > 0) return false;
    this.heartTimer = 60 / (70 + 110 * intensity);
    const ctx = this.ctx;
    if (ctx) {
      const t = ctx.currentTime;
      const vol = 0.25 + 0.5 * intensity;
      this.thump(t, vol);
      this.thump(t + 0.17, vol * 0.7);
    }
    return true; // a beat landed this frame (drives the on-screen pulse even when muted)
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

  /** A short enveloped tone at a place in the world. */
  private tone(
    out: AudioNode, type: OscillatorType, freq: number, at: number, dur: number, gain: number, slideTo = freq,
  ): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime + at;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo !== freq) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  /** A burst of filtered noise at a place in the world. */
  private hiss(out: AudioNode, freq: number, q: number, at: number, dur: number, gain: number): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime + at;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = freq;
    bp.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(bp).connect(g).connect(out);
    src.start(t, Math.random(), dur + 0.1);
  }

  /** One "tick" of a noise-maker; called repeatedly while it is running. */
  playDistraction(kind: 'radio' | 'alarm' | 'musicbox' | 'piano', pos: THREE.Vector3): void {
    if (!this.ctx) return;
    const out = this.spatial(pos);
    if (kind === 'alarm') {
      // a hammer rattling between two bells
      for (let i = 0; i < 14; i++) this.tone(out, 'square', i % 2 ? 2350 : 2050, i * 0.06, 0.05, 0.3);
    } else if (kind === 'radio') {
      // static with a warbling dance-band tune buried in it
      this.hiss(out, 2600, 0.6, 0, 1.6, 0.22);
      const tune = [392, 440, 523, 494, 440, 392, 330, 349];
      for (let i = 0; i < 4; i++) {
        const f = tune[Math.floor(Math.random() * tune.length)];
        this.tone(out, 'sawtooth', f, i * 0.4, 0.36, 0.14, f * (0.98 + Math.random() * 0.04));
      }
    } else if (kind === 'musicbox') {
      const tune = [1319, 1568, 1760, 1568, 1319, 1175, 1047, 1175];
      for (let i = 0; i < 6; i++) {
        this.tone(out, 'sine', tune[(Math.floor(this.ctx.currentTime * 2) + i) % tune.length], i * 0.26, 0.5, 0.2);
      }
    } else {
      // a fistful of low keys
      for (const f of [65, 82, 98, 110, 139, 156, 233]) this.tone(out, 'triangle', f, Math.random() * 0.03, 1.6, 0.4);
      this.hiss(out, 300, 0.7, 0, 0.3, 0.5);
    }
  }

  /** The snap of the crossbow. */
  playDart(): void {
    if (!this.ctx) return;
    this.hiss(this.master, 1800, 1.2, 0, 0.12, 0.5);
    this.tone(this.master, 'triangle', 240, 0, 0.18, 0.35, 70);
  }

  /** A body hitting the floorboards. */
  playThud(pos: THREE.Vector3): void {
    if (!this.ctx) return;
    const out = this.spatial(pos);
    this.tone(out, 'sine', 90, 0.25, 0.4, 0.9, 32);
    this.hiss(out, 220, 0.8, 0.25, 0.3, 0.6);
  }

  /** The noise of working on a way out. */
  playWork(sfx: 'wood' | 'metal' | 'click' | 'engine' | 'pour' | 'winch', pos: THREE.Vector3): void {
    if (!this.ctx) return;
    const out = this.spatial(pos);
    switch (sfx) {
      case 'wood':
        for (let i = 0; i < 3; i++) {
          this.hiss(out, 500 + i * 180, 2, i * 0.28, 0.2, 0.7);
          this.tone(out, 'sawtooth', 180 - i * 20, i * 0.28, 0.24, 0.3, 90);
        }
        break;
      case 'metal':
        this.tone(out, 'square', 1900, 0, 0.5, 0.25, 1500);
        this.tone(out, 'triangle', 760, 0, 0.7, 0.3);
        this.hiss(out, 3200, 3, 0, 0.12, 0.6);
        break;
      case 'click':
        for (let i = 0; i < 3; i++) this.hiss(out, 2400, 5, i * 0.16, 0.05, 0.6);
        this.tone(out, 'triangle', 300, 0.48, 0.14, 0.3, 140);
        break;
      case 'pour':
        for (let i = 0; i < 9; i++) this.tone(out, 'sine', 300 + Math.random() * 500, i * 0.2, 0.18, 0.12, 180);
        this.hiss(out, 900, 0.8, 0, 2, 0.12);
        break;
      case 'winch':
        for (let i = 0; i < 22; i++) {
          this.hiss(out, 1500, 6, i * 0.22, 0.05, 0.5);
          this.tone(out, 'sawtooth', 70, i * 0.22, 0.2, 0.16, 55);
        }
        break;
      case 'engine': {
        // starter whine, a cough, then a rough idle that fades into the mix
        for (let i = 0; i < 7; i++) this.tone(out, 'sawtooth', 110 + i * 6, i * 0.14, 0.12, 0.3, 90);
        this.hiss(out, 180, 0.7, 1.0, 0.5, 0.9);
        const ctx = this.ctx;
        const t = ctx.currentTime + 1.1;
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.setValueAtTime(48, t);
        const lfo = ctx.createOscillator();
        lfo.frequency.value = 13;
        const lg = ctx.createGain();
        lg.gain.value = 9;
        lfo.connect(lg).connect(o.frequency);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.5, t + 0.3);
        g.gain.setValueAtTime(0.5, t + 20);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 26);
        o.connect(g).connect(out);
        o.start(t);
        lfo.start(t);
        o.stop(t + 26.5);
        lfo.stop(t + 26.5);
        break;
      }
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
