import * as THREE from 'three';
import { SoundBus } from '../ai/SoundBus';
import { AudioManager } from '../audio/AudioManager';
import { AreaId, LevelConfig } from '../core/Levels';
import { Materials, scaleBoxUVs } from '../rendering/Materials';

interface Zone {
  area: AreaId;
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  inside: boolean;
}

const zone = (area: AreaId, x0: number, x1: number, z0: number, z1: number): Zone => ({
  area, x0, x1, z0, z1, inside: false,
});

/** Every loose patch in the cellar, in the order nights enable them. */
const ZONES: Zone[] = [
  zone('hall', -1.5, 1.5, -0.8, 1.2),
  zone('north', -1.2, 1.2, -4.6, -3.2),
  zone('east', 4.2, 5.9, -1.4, 1.4),
  zone('hall', -5.6, -3.2, 3.0, 4.6),
  zone('east', 8.2, 10.6, -1.2, 1.0),
  zone('north', -1.6, 1.6, -8.2, -6.6),
  zone('west', -10.6, -8.4, -1.2, 1.2),
  zone('crypt', -10.5, -8.5, -6.9, -5.4),
  zone('west', -5.8, -4.2, -1.2, 1.2),
  zone('hall', 2.6, 5.0, 2.8, 4.6),
];

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
    this.zones = ZONES.filter((z) => cfg.areas.includes(z.area))
      .slice(0, cfg.creakZones)
      .map((z) => ({ ...z }));
    // slightly darker, raised patches so players can learn where they are
    const mat = mats.wood.clone();
    mat.color.setHex(0x8a7a6a);
    mat.userData.shared = false; // the clone belongs to this level
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
