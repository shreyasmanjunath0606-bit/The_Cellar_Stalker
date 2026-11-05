import * as THREE from 'three';
import { SoundBus } from '../ai/SoundBus';
import { AudioManager } from '../audio/AudioManager';
import { Materials, scaleBoxUVs } from '../rendering/Materials';

interface Zone {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  inside: boolean;
}

/** Worn boards that creak underfoot. Crouching mostly avoids them. */
export class Floorboards {
  readonly group = new THREE.Group();
  private readonly zones: Zone[] = [
    { x0: -1.5, x1: 1.5, z0: -0.8, z1: 1.2, inside: false },
    { x0: -1.2, x1: 1.2, z0: -4.6, z1: -3.2, inside: false },
    { x0: 4.2, x1: 5.9, z0: -1.4, z1: 1.4, inside: false },
    { x0: -5.6, x1: -3.2, z0: 3.0, z1: 4.6, inside: false },
  ];
  private cooldown = 0;

  constructor(
    mats: Materials,
    private readonly bus: SoundBus,
    private readonly audio: AudioManager,
  ) {
    // slightly darker, raised patches so players can learn where they are
    const mat = mats.wood.clone();
    mat.color.setHex(0x8a7a6a);
    for (const z of this.zones) {
      const w = z.x1 - z.x0;
      const d = z.z1 - z.z0;
      const geo = new THREE.BoxGeometry(w, 0.012, d);
      scaleBoxUVs(geo, w, 0.012, d);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set((z.x0 + z.x1) / 2, 0.006, (z.z0 + z.z1) / 2);
      mesh.receiveShadow = true;
      this.group.add(mesh);
    }
  }

  update(dt: number, pos: THREE.Vector3, moving: boolean, crouching: boolean, sprinting: boolean): void {
    this.cooldown = Math.max(0, this.cooldown - dt);
    for (const z of this.zones) {
      const inside = pos.x > z.x0 && pos.x < z.x1 && pos.z > z.z0 && pos.z < z.z1;
      const entered = inside && !z.inside;
      z.inside = inside;
      if (!inside || !moving || this.cooldown > 0) continue;
      if (entered || sprinting) this.creak(pos, crouching, sprinting);
    }
  }

  private creak(pos: THREE.Vector3, crouching: boolean, sprinting: boolean): void {
    if (crouching && Math.random() < 0.7) return;
    this.cooldown = 1.2;
    const at = new THREE.Vector3(pos.x, 0.1, pos.z);
    this.audio.playCreak(at, crouching ? 0.5 : 1);
    this.bus.emit(at, crouching ? 6 : sprinting ? 18 : 14, 'floorboard');
  }
}
