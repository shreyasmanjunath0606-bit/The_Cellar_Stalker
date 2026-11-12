import * as THREE from 'three';
import { SoundBus } from '../ai/SoundBus';
import { AudioManager } from '../audio/AudioManager';
import { LevelConfig } from '../core/Levels';
import { Materials, scaleBoxUVs } from '../rendering/Materials';
import { FLOOR_H } from './HouseKit';
import { CREAK_ZONES } from './Layout';

interface Zone {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  y: number;
  inside: boolean;
}

/** Worn boards that creak underfoot. Crouching mostly avoids them. */
export class Floorboards {
  readonly group = new THREE.Group();
  private readonly zones: Zone[];
  private cooldown = 0;

  constructor(
    mats: Materials,
    private readonly bus: SoundBus,
    private readonly audio: AudioManager,
    cfg: LevelConfig,
  ) {
    this.zones = CREAK_ZONES.slice(0, cfg.creakZones).map(([x0, x1, z0, z1, level]) => ({
      x0, x1, z0, z1, y: level * FLOOR_H, inside: false,
    }));
    // slightly paler, raised patches so players can learn where they are
    const mat = mats.wood.clone();
    mat.color.setHex(0x9a8a78);
    mat.userData.shared = false; // the clone belongs to this level
    for (const z of this.zones) {
      const w = z.x1 - z.x0;
      const d = z.z1 - z.z0;
      const geo = new THREE.BoxGeometry(w, 0.012, d);
      scaleBoxUVs(geo, w, 0.012, d);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set((z.x0 + z.x1) / 2, z.y + 0.022, (z.z0 + z.z1) / 2);
      mesh.receiveShadow = true;
      this.group.add(mesh);
    }
  }

  /** `feet` is the local player's feet position. */
  update(dt: number, feet: THREE.Vector3, moving: boolean, crouching: boolean, sprinting: boolean): void {
    this.cooldown = Math.max(0, this.cooldown - dt);
    for (const z of this.zones) {
      const inside =
        feet.x > z.x0 && feet.x < z.x1 && feet.z > z.z0 && feet.z < z.z1 && Math.abs(feet.y - z.y) < 0.6;
      const entered = inside && !z.inside;
      z.inside = inside;
      if (!inside || !moving || this.cooldown > 0) continue;
      if (entered || sprinting) this.creak(feet, crouching, sprinting);
    }
  }

  private creak(feet: THREE.Vector3, crouching: boolean, sprinting: boolean): void {
    if (crouching && Math.random() < 0.7) return;
    this.cooldown = 1.2;
    const at = new THREE.Vector3(feet.x, feet.y + 0.1, feet.z);
    this.audio.playCreak(at, crouching ? 0.5 : 1);
    this.bus.emit(at, crouching ? 6 : sprinting ? 18 : 14, 'floorboard');
  }
}
