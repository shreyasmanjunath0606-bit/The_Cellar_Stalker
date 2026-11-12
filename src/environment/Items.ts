import * as THREE from 'three';
import { LevelConfig } from '../core/Levels';
import { Rng } from '../core/Rng';
import { Materials } from '../rendering/Materials';
import { ItemType } from '../player/Inventory';
import { FLOOR_H } from './HouseKit';
import { ITEM_SPOTS, Spot } from './Layout';

export interface Item {
  id: number;
  type: ItemType;
  mesh: THREE.Object3D;
  baseY: number;
  seed: number;
  collected: boolean;
}

const REACH = 2.3;
/** Too bulky to sit on a shelf: these only ever lie on the floor. */
const BULKY: ItemType[] = ['fuel', 'carbattery', 'ladderA', 'ladderB'];
/** Halo colour tells you which way out an item belongs to. */
const HALO: Record<ItemType, number> = {
  key: 0xffc050, hammer: 0xffc050, cutters: 0xffc050,
  carkey: 0xff6a3a, fuel: 0xff6a3a, carbattery: 0xff6a3a, crank: 0xff6a3a,
  balconykey: 0x5ad0ff, ladderA: 0x5ad0ff, ladderB: 0x5ad0ff, rope: 0x5ad0ff,
  crossbow: 0xc080ff, dart: 0xc080ff, battery: 0x60ff70,
};

const std = (color: number, metalness = 0.2, roughness = 0.5, emissive = 0): THREE.MeshStandardMaterial =>
  new THREE.MeshStandardMaterial({ color, metalness, roughness, emissive, emissiveIntensity: 1 });

/** Everything that can be picked up, scattered differently (but identically for every player) each attempt. */
export class Items {
  readonly group = new THREE.Group();
  readonly items: Item[] = [];
  private readonly m = {
    brass: std(0xd8b04a, 0.9, 0.3, 0x5a3c08),
    steel: std(0xa8acb0, 0.9, 0.35, 0x101214),
    iron: std(0x3a3d40, 0.8, 0.5),
    red: std(0xb02a1c, 0.3, 0.45, 0x3a0a06),
    wood: std(0x7a5230, 0, 0.8, 0x1a1008),
    black: std(0x141416, 0.2, 0.6),
    rope: std(0xb89a62, 0, 0.9, 0x2a2010),
    green: std(0x4a8f4a, 0.3, 0.4, 0x145a14),
    violet: std(0x7a4ab0, 0.3, 0.4, 0x2a1050),
  };

  constructor(private readonly mats: Materials, cfg: LevelConfig, rng: Rng) {
    const wanted: ItemType[] = [
      ...Array<ItemType>(cfg.keys).fill('key'),
      'hammer', 'cutters', 'carkey', 'fuel', 'carbattery', 'crank',
      'balconykey', 'ladderA', 'ladderB', 'rope', 'crossbow',
      ...Array<ItemType>(cfg.darts).fill('dart'),
      ...Array<ItemType>(cfg.batteries).fill('battery'),
    ];
    const spots = rng.shuffle([...ITEM_SPOTS]);
    const takeSpot = (floorOnly: boolean): Spot => {
      const i = spots.findIndex((s) => !floorOnly || s[1] < 0.2);
      return spots.splice(Math.max(0, i), 1)[0];
    };
    // bulky things first, while there are still floor spots to choose from
    const order = [...wanted.filter((t) => BULKY.includes(t)), ...wanted.filter((t) => !BULKY.includes(t))];
    for (const type of order) {
      const [x, y, z, level] = takeSpot(BULKY.includes(type));
      const mesh = this.build(type);
      const lying = type === 'ladderA' || type === 'ladderB';
      const py = level * FLOOR_H + y + (lying ? -0.08 : 0.05);
      mesh.position.set(x, py, z);
      mesh.rotation.y = rng.next() * Math.PI * 2;
      this.group.add(mesh);
      this.items.push({ id: this.items.length, type, mesh, baseY: py, seed: rng.next() * 10, collected: false });
    }
  }

  update(elapsed: number): void {
    for (const it of this.items) {
      if (it.collected || BULKY.includes(it.type)) continue;
      it.mesh.rotation.y = elapsed * 1.2 + it.seed;
      it.mesh.position.y = it.baseY + Math.sin(elapsed * 2 + it.seed) * 0.02;
    }
  }

  /** Item the player is close to and looking at, if any. */
  focus(origin: THREE.Vector3, dir: THREE.Vector3): Item | null {
    let best: Item | null = null;
    let bestScore = 0.88;
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

  collect(id: number): Item | null {
    const item = this.items[id];
    if (!item || item.collected) return null;
    item.collected = true;
    item.mesh.visible = false;
    return item;
  }

  private build(type: ItemType): THREE.Group {
    const g = new THREE.Group();
    const m = this.m;
    const add = (
      geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0,
    ): void => {
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(x, y, z);
      mesh.rotation.set(rx, ry, rz);
      mesh.castShadow = true;
      g.add(mesh);
    };
    const box = (w: number, h: number, d: number): THREE.BoxGeometry => new THREE.BoxGeometry(w, h, d);
    const cyl = (r: number, h: number, r2 = r): THREE.CylinderGeometry => new THREE.CylinderGeometry(r2, r, h, 12);
    const keyShape = (mat: THREE.Material): void => {
      add(new THREE.TorusGeometry(0.045, 0.014, 8, 18), mat, 0, 0.07);
      add(box(0.02, 0.15, 0.014), mat, 0, -0.045);
      add(box(0.045, 0.02, 0.014), mat, 0.03, -0.1);
      add(box(0.035, 0.02, 0.014), mat, 0.025, -0.065);
    };
    let halo = 0.42;
    switch (type) {
      case 'key':
        keyShape(m.brass);
        break;
      case 'balconykey':
        keyShape(m.steel);
        break;
      case 'carkey':
        add(box(0.02, 0.11, 0.012), m.steel, 0, -0.05);
        add(box(0.07, 0.07, 0.022), m.black, 0, 0.04);
        add(new THREE.TorusGeometry(0.03, 0.006, 6, 14), m.steel, 0, 0.1);
        break;
      case 'hammer':
        add(cyl(0.016, 0.3), m.wood, 0, 0);
        add(box(0.12, 0.045, 0.045), m.iron, 0.01, 0.15);
        add(box(0.05, 0.02, 0.045), m.iron, -0.07, 0.17, 0, 0, 0, 0.5);
        break;
      case 'cutters':
        for (const s of [-1, 1]) {
          add(cyl(0.014, 0.3), m.red, s * 0.04, -0.08, 0, 0, 0, s * 0.14);
          add(box(0.03, 0.12, 0.02), m.iron, s * 0.012, 0.13, 0, 0, 0, -s * 0.1);
        }
        add(cyl(0.02, 0.03), m.iron, 0, 0.07, 0, Math.PI / 2);
        break;
      case 'fuel':
        add(box(0.3, 0.36, 0.16), m.red, 0, 0.13);
        add(box(0.16, 0.035, 0.035), m.red, -0.02, 0.36);
        for (const s of [-1, 1]) add(box(0.03, 0.05, 0.035), m.red, -0.02 + s * 0.07, 0.33);
        add(cyl(0.022, 0.12), m.iron, 0.13, 0.34, 0, 0, 0, -0.7);
        halo = 0.7;
        break;
      case 'carbattery':
        add(box(0.32, 0.22, 0.2), m.black, 0, 0.06);
        add(box(0.33, 0.03, 0.21), m.iron, 0, 0.18);
        add(cyl(0.022, 0.05), m.red, -0.1, 0.21);
        add(cyl(0.022, 0.05), m.steel, 0.1, 0.21);
        halo = 0.7;
        break;
      case 'crank':
        add(cyl(0.016, 0.26), m.iron, 0, 0, 0, 0, 0, Math.PI / 2);
        add(cyl(0.016, 0.16), m.iron, 0.13, 0.08);
        add(cyl(0.024, 0.12), m.wood, 0.13, 0.2);
        add(box(0.05, 0.05, 0.05), m.iron, -0.13, 0);
        break;
      case 'ladderA':
      case 'ladderB':
        for (const s of [-1, 1]) add(box(0.05, 0.05, 1.5), m.wood, s * 0.2, 0, 0);
        for (let i = 0; i < 5; i++) add(cyl(0.018, 0.4), m.wood, 0, 0, -0.6 + i * 0.3, 0, 0, Math.PI / 2);
        halo = 1.1;
        break;
      case 'rope':
        for (let i = 0; i < 3; i++) add(new THREE.TorusGeometry(0.11 - i * 0.012, 0.022, 8, 20), m.rope, 0, i * 0.04 - 0.03, 0, Math.PI / 2);
        halo = 0.6;
        break;
      case 'crossbow':
        add(box(0.05, 0.05, 0.42), m.wood, 0, 0, 0);
        add(box(0.46, 0.025, 0.035), m.iron, 0, 0.02, -0.17);
        add(box(0.04, 0.1, 0.05), m.wood, 0, -0.07, 0.12);
        add(cyl(0.006, 0.44), m.rope, 0, 0.03, -0.1, 0, 0, Math.PI / 2);
        halo = 0.75;
        break;
      case 'dart':
        add(cyl(0.008, 0.2), m.steel, 0, 0, 0, 0, 0, Math.PI / 2);
        add(cyl(0.001, 0.05, 0.012), m.steel, 0.12, 0, 0, 0, 0, -Math.PI / 2);
        add(cyl(0.03, 0.05, 0.004), m.violet, -0.1, 0, 0, 0, 0, -Math.PI / 2);
        break;
      case 'battery':
        add(cyl(0.045, 0.13), m.green, 0, 0, 0, 0, 0, Math.PI / 2);
        add(cyl(0.02, 0.025), m.steel, 0.075, 0, 0, 0, 0, Math.PI / 2);
        halo = 0.34;
        break;
    }
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: this.mats.glow, color: HALO[type], opacity: type === 'battery' ? 0.25 : 0.5,
        transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
      }),
    );
    sprite.scale.setScalar(halo);
    g.add(sprite);
    return g;
  }
}
