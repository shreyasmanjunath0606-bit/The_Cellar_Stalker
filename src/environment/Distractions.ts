import * as THREE from 'three';
import { SoundBus } from '../ai/SoundBus';
import { AudioManager } from '../audio/AudioManager';
import { Materials } from '../rendering/Materials';
import { FLOOR_H } from './HouseKit';

export type DistractionKind = 'radio' | 'alarm' | 'musicbox' | 'piano';

interface Tuning {
  /** What E does. */
  verb: string;
  /** Seconds before it starts making noise. */
  delay: number;
  /** Seconds it keeps going. */
  duration: number;
  /** How far she hears it. */
  radius: number;
}

const TUNING: Record<DistractionKind, Tuning> = {
  radio: { verb: 'switch on the radio', delay: 0, duration: 24, radius: 22 },
  alarm: { verb: 'wind the alarm clock — it rings in 10 seconds', delay: 10, duration: 14, radius: 26 },
  musicbox: { verb: 'wind up the music box', delay: 0, duration: 18, radius: 17 },
  piano: { verb: 'slam the piano keys', delay: 0, duration: 1.2, radius: 26 },
};

/** Seconds before a used distraction can be set off again. */
const COOLDOWN = 35;

export interface Distraction {
  id: number;
  kind: DistractionKind;
  pos: THREE.Vector3;
  mesh: THREE.Object3D | null;
  /** Seconds until it starts (counting down), then seconds of noise left. */
  delay: number;
  left: number;
  cooldown: number;
  tick: number;
}

/** [kind, x, height above the floor, z, level] */
const PLACES: [DistractionKind, number, number, number, number][] = [
  ['radio', -5.42, 0.94, 3.1, 0],
  ['piano', -9.4, 0.95, 8.25, 0],
  ['alarm', 4.55, 0.85, 6.6, 0],
  ['radio', 21.5, 0.9, 6.2, 0],
  ['radio', -12.4, 0.92, -10.55, 0],
  ['alarm', -5.55, 0.78, 4.55, 1],
  ['alarm', 12.95, 0.94, -0.56, 1],
  ['musicbox', 13.4, 0.7, -8.5, 1],
  ['musicbox', -13.58, 0.94, -9.1, 1],
];

/** Things around the house that make a racket on purpose, to pull her away from where you need to be. */
export class Distractions {
  readonly group = new THREE.Group();
  readonly list: Distraction[] = [];
  private readonly to = new THREE.Vector3();

  constructor(
    private readonly mats: Materials,
    private readonly bus: SoundBus,
    private readonly audio: AudioManager,
  ) {
    for (const [kind, x, y, z, level] of PLACES) {
      const pos = new THREE.Vector3(x, level * FLOOR_H + y, z);
      const mesh = this.build(kind);
      if (mesh) {
        mesh.position.copy(pos);
        this.group.add(mesh);
      }
      this.list.push({ id: this.list.length, kind, pos, mesh, delay: 0, left: 0, cooldown: 0, tick: 0 });
    }
  }

  verb(d: Distraction): string {
    return TUNING[d.kind].verb;
  }

  ready(d: Distraction): boolean {
    return d.left <= 0 && d.delay <= 0 && d.cooldown <= 0;
  }

  /** The distraction the player is standing at and looking at, if any. */
  focus(origin: THREE.Vector3, dir: THREE.Vector3): Distraction | null {
    for (const d of this.list) {
      const to = this.to.copy(d.pos).sub(origin);
      const dist = to.length();
      if (dist < 2.2 && to.divideScalar(dist).dot(dir) > 0.8) return d;
    }
    return null;
  }

  trigger(id: number): boolean {
    const d = this.list[id];
    if (!d || !this.ready(d)) return false;
    const t = TUNING[d.kind];
    d.delay = t.delay;
    d.left = t.duration;
    d.tick = 0;
    return true;
  }

  /** She has reached it and shut it up. */
  silence(id: number): void {
    const d = this.list[id];
    if (!d || d.left <= 0) return;
    d.left = 0;
    d.delay = 0;
    d.cooldown = COOLDOWN;
  }

  /** Ids of everything currently making noise. */
  active(): Distraction[] {
    return this.list.filter((d) => d.left > 0 && d.delay <= 0);
  }

  update(dt: number, elapsed: number): void {
    for (const d of this.list) {
      d.cooldown = Math.max(0, d.cooldown - dt);
      if (d.left <= 0) continue;
      if (d.delay > 0) {
        d.delay -= dt;
        if (d.mesh) d.mesh.rotation.z = Math.sin(elapsed * 30) * 0.02; // ticking
        continue;
      }
      d.left -= dt;
      d.tick -= dt;
      if (d.mesh) {
        d.mesh.rotation.z = d.kind === 'alarm' ? Math.sin(elapsed * 70) * 0.12 : 0;
        if (d.kind === 'musicbox') d.mesh.rotation.y = elapsed * 2;
      }
      if (d.tick <= 0) {
        d.tick = d.kind === 'alarm' ? 0.9 : 1.6;
        this.audio.playDistraction(d.kind, d.pos);
        this.bus.emit(d.pos, TUNING[d.kind].radius, 'distraction');
      }
      if (d.left <= 0) {
        d.cooldown = COOLDOWN;
        if (d.mesh) d.mesh.rotation.z = 0;
      }
    }
  }

  private build(kind: DistractionKind): THREE.Object3D | null {
    if (kind === 'piano') return null; // the piano is part of the furniture
    const g = new THREE.Group();
    const { trim, metal, enamel, black } = this.mats;
    const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.castShadow = true;
      g.add(m);
      return m;
    };
    if (kind === 'radio') {
      add(new THREE.BoxGeometry(0.34, 0.22, 0.14), trim, 0, 0.11, 0);
      add(new THREE.BoxGeometry(0.16, 0.13, 0.01), black, -0.06, 0.11, 0.075);
      add(new THREE.CylinderGeometry(0.025, 0.025, 0.02, 10), metal, 0.1, 0.14, 0.075).rotation.x = Math.PI / 2;
      add(new THREE.CylinderGeometry(0.018, 0.018, 0.02, 10), metal, 0.1, 0.07, 0.075).rotation.x = Math.PI / 2;
      add(new THREE.CylinderGeometry(0.004, 0.004, 0.3, 5), metal, 0.14, 0.36, -0.04).rotation.z = -0.3;
    } else if (kind === 'alarm') {
      add(new THREE.CylinderGeometry(0.07, 0.07, 0.05, 16), metal, 0, 0.09, 0).rotation.x = Math.PI / 2;
      add(new THREE.CylinderGeometry(0.06, 0.06, 0.052, 16), enamel, 0, 0.09, 0.002).rotation.x = Math.PI / 2;
      for (const sx of [-1, 1]) {
        add(new THREE.SphereGeometry(0.03, 10, 8, 0, Math.PI * 2, 0, Math.PI / 2), metal, sx * 0.045, 0.155, 0);
        add(new THREE.CylinderGeometry(0.006, 0.006, 0.04, 5), metal, sx * 0.04, 0.015, 0);
      }
    } else {
      add(new THREE.BoxGeometry(0.2, 0.09, 0.14), trim, 0, 0.045, 0);
      add(new THREE.BoxGeometry(0.2, 0.012, 0.14), trim, 0, 0.13, -0.065).rotation.x = -1.1;
      add(new THREE.CylinderGeometry(0.02, 0.03, 0.07, 8), enamel, 0, 0.125, 0);
      add(new THREE.SphereGeometry(0.018, 8, 6), enamel, 0, 0.17, 0);
    }
    return g;
  }
}
