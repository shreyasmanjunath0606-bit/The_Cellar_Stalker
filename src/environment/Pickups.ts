import * as THREE from 'three';
import { AreaId, LevelConfig } from '../core/Levels';
import { Materials } from '../rendering/Materials';

export type PickupType = 'key' | 'battery';

export interface Pickup {
  type: PickupType;
  mesh: THREE.Object3D;
  baseY: number;
  seed: number;
  collected: boolean;
}

type Spot = [x: number, y: number, z: number];

const REACH = 2.2;

/** Places a key can turn up, per area. Each night draws a different set. */
const KEY_SPOTS: Record<AreaId, Spot[]> = {
  hall: [[-5.4, 0.15, 4.4], [5.3, 0.15, 4.3], [-4.8, 1.05, -3.6]],
  east: [[12.3, 0.15, 3.3], [11.65, 1.95, -2.4], [6.6, 0.15, -3.3], [12.3, 0.15, -0.4]],
  north: [[-3.5, 0.15, -11.4], [3.4, 0.15, -6.0], [3.1, 0.95, -10.8], [3.4, 0.15, -11.4]],
  west: [[-11.7, 0.15, -3.6], [-7.0, 0.15, 4.2], [-12.3, 0.15, 4.3], [-9.9, 1.05, 4.45]],
  crypt: [[-12.3, 0.15, -11.3], [-5.0, 0.8, -10.6], [-12.3, 0.15, -6.0], [-6.2, 0.15, -11.3]],
};

const BATTERY_SPOTS: Record<AreaId, Spot[]> = {
  hall: [[2.2, 0.08, 4.4], [-2.0, 0.08, -4.3]],
  east: [[7.4, 0.08, 3.4], [12.4, 0.08, -3.5]],
  north: [[3.4, 0.08, -6.9], [-3.4, 0.08, -7.0]],
  west: [[-7.0, 0.08, -4.2], [-12.3, 0.08, 0.2]],
  crypt: [[-12.2, 0.08, -8.5], [-6.5, 0.08, -5.8]],
};

function shuffle<T>(a: T[]): T[] {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Draws `n` spots round-robin across the open areas (side rooms before the hall) so they spread out. */
function draw(pool: Record<AreaId, Spot[]>, areas: AreaId[], n: number): Spot[] {
  const lists = shuffle(areas.filter((a) => a !== 'hall').map((a) => shuffle([...pool[a]])));
  if (areas.includes('hall')) lists.push(shuffle([...pool.hall]));
  const out: Spot[] = [];
  for (let i = 0; out.length < n && i < n * lists.length + lists.length; i++) {
    const spot = lists[i % lists.length].pop();
    if (spot) out.push(spot);
  }
  return out;
}

/** Hidden keys and spare batteries, scattered differently every attempt. */
export class Pickups {
  readonly group = new THREE.Group();
  private readonly items: Pickup[] = [];

  constructor(mats: Materials, cfg: LevelConfig) {
    const brass = new THREE.MeshStandardMaterial({
      color: 0xd8b04a, metalness: 0.9, roughness: 0.3, emissive: 0x7a5410, emissiveIntensity: 1.4,
    });
    const cell = new THREE.MeshStandardMaterial({
      color: 0x4a8f4a, metalness: 0.3, roughness: 0.4, emissive: 0x145a14, emissiveIntensity: 1.2,
    });
    const cap = new THREE.MeshStandardMaterial({ color: 0xb8b8b0, metalness: 0.9, roughness: 0.3 });

    for (const [x, y, z] of draw(KEY_SPOTS, cfg.areas, cfg.keys)) {
      const key = new THREE.Group();
      const add = (geo: THREE.BufferGeometry, px: number, py: number): void => {
        const m = new THREE.Mesh(geo, brass);
        m.position.set(px, py, 0);
        m.castShadow = true;
        key.add(m);
      };
      add(new THREE.TorusGeometry(0.045, 0.014, 8, 18), 0, 0.07);
      add(new THREE.BoxGeometry(0.02, 0.15, 0.014), 0, -0.045);
      add(new THREE.BoxGeometry(0.045, 0.02, 0.014), 0.03, -0.1);
      add(new THREE.BoxGeometry(0.035, 0.02, 0.014), 0.025, -0.065);
      key.add(this.halo(mats.glow, 0xffc050, 0.5, 0.42));
      this.place('key', key, x, y + 0.05, z);
    }

    for (const [x, y, z] of draw(BATTERY_SPOTS, cfg.areas, cfg.batteries)) {
      const bat = new THREE.Group();
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.13, 12), cell);
      body.rotation.z = Math.PI / 2;
      body.castShadow = true;
      const tip = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.025, 8), cap);
      tip.rotation.z = Math.PI / 2;
      tip.position.x = 0.075;
      bat.add(body, tip, this.halo(mats.glow, 0x60ff70, 0.22, 0.34));
      bat.rotation.y = Math.random() * Math.PI;
      this.place('battery', bat, x, y, z);
    }
  }

  private halo(map: THREE.Texture, color: number, opacity: number, size: number): THREE.Sprite {
    const s = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map, color, opacity, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
      }),
    );
    s.scale.setScalar(size);
    return s;
  }

  private place(type: PickupType, mesh: THREE.Object3D, x: number, y: number, z: number): void {
    mesh.position.set(x, y, z);
    this.group.add(mesh);
    this.items.push({ type, mesh, baseY: y, seed: Math.random() * 10, collected: false });
  }

  update(elapsed: number): void {
    for (const it of this.items) {
      if (it.collected || it.type !== 'key') continue;
      it.mesh.rotation.y = elapsed * 1.5 + it.seed;
      it.mesh.position.y = it.baseY + Math.sin(elapsed * 2 + it.seed) * 0.025;
    }
  }

  /** Item the player is close to and looking at, if any. */
  focus(origin: THREE.Vector3, dir: THREE.Vector3): Pickup | null {
    let best: Pickup | null = null;
    let bestScore = 0.9;
    const to = new THREE.Vector3();
    for (const it of this.items) {
      if (it.collected) continue;
      to.copy(it.mesh.position).sub(origin);
      const dist = to.length();
      if (dist > REACH) continue;
      const score = to.divideScalar(dist).dot(dir);
      if (score > bestScore) {
        bestScore = score;
        best = it;
      }
    }
    return best;
  }

  collect(item: Pickup): void {
    item.collected = true;
    item.mesh.visible = false;
  }
}
