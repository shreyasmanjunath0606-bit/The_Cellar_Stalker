import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Physics, RAPIER } from '../core/Physics';
import { LevelConfig } from '../core/Levels';
import { Materials, scaleBoxUVs } from '../rendering/Materials';

/** Vertical distance between the ground floor and the upper floor. */
export const FLOOR_H = 3;
export const WALL_HEIGHT = 2.8;
export const DOOR_HEIGHT = 2.1;
/** Wall thickness. */
export const T = 0.3;
/** How many real lights follow the player around; every other lamp is just a glowing bulb. */
const LIGHT_POOL = 7;
const LAMP_RANGE = 10;

export type Facing = 'x+' | 'x-' | 'z+' | 'z-';
export const FACING: Record<Facing, { theta: number; fx: number; fz: number }> = {
  'z+': { theta: 0, fx: 0, fz: 1 },
  'x+': { theta: Math.PI / 2, fx: 1, fz: 0 },
  'z-': { theta: Math.PI, fx: 0, fz: -1 },
  'x-': { theta: -Math.PI / 2, fx: -1, fz: 0 },
};

/** Somewhere a player can disappear into: a wardrobe, or the gap under a bed. */
export interface HideSpot {
  id: number;
  kind: 'wardrobe' | 'bed';
  /** Where the player's body sits while hidden. */
  pos: THREE.Vector3;
  /** Camera yaw that looks straight out. */
  yaw: number;
  /** Where the player steps out to. */
  exit: THREE.Vector3;
  /** Point to look at to use it. */
  door: THREE.Vector3;
  /** Eye height above the body centre while inside. */
  eye: number;
}

interface Lamp {
  pos: THREE.Vector3;
  glow: THREE.MeshBasicMaterial;
  color: THREE.Color;
  base: number;
  seed: number;
  /** 'exit' and 'candle' ignore blackouts. */
  kind: 'bulb' | 'exit' | 'candle';
  surge: number;
  level: number;
  flame?: THREE.Object3D;
  slot: number;
  /** Decorative flames that share the flicker but never get a real light. */
  lit: boolean;
}

interface Slot {
  light: THREE.PointLight;
  lamp: Lamp | null;
  fade: number;
}

export interface BoxOpts {
  collide?: boolean;
  cast?: boolean;
}

/** Furniture is modelled in a local frame, then baked into the room's merged geometry. */
export interface Kit {
  box(w: number, h: number, d: number, px: number, py: number, pz: number, mat: THREE.Material, rx?: number): void;
  cyl(r: number, h: number, px: number, py: number, pz: number, mat: THREE.Material, axis?: 'x' | 'y' | 'z', r2?: number): void;
  geo(g: THREE.BufferGeometry, px: number, py: number, pz: number, mat: THREE.Material): void;
  /** Local point to world space. */
  world(px: number, py: number, pz: number): THREE.Vector3;
}

/**
 * Low-level building blocks for the house. Everything static is baked into one mesh per
 * room and material, so a large furnished house still costs only a handful of draw calls.
 */
export abstract class HouseKit {
  readonly group = new THREE.Group();
  readonly hideSpots: HideSpot[] = [];
  /** A dead bulb just surged (blackout nights). */
  onSpark: (pos: THREE.Vector3) => void = () => {};

  /** Floor height of the level currently being built. */
  protected y0 = 0;
  protected room = 'misc';
  private readonly batches = new Map<string, { mat: THREE.Material; cast: boolean; geos: THREE.BufferGeometry[] }>();
  private readonly lamps: Lamp[] = [];
  private readonly slots: Slot[] = [];
  private readonly m4 = new THREE.Matrix4();

  constructor(
    protected readonly physics: Physics,
    protected readonly mats: Materials,
    protected readonly cfg: LevelConfig,
  ) {
    for (let i = 0; i < LIGHT_POOL; i++) {
      const light = new THREE.PointLight(0xffffff, 0, LAMP_RANGE, 2);
      this.group.add(light);
      this.slots.push({ light, lamp: null, fade: 0 });
    }
  }

  // ---- lights -------------------------------------------------------------

  /** Flickers every bulb and hands the pooled lights to the lamps nearest the camera. */
  updateLamps(elapsed: number, dt: number, eye: THREE.Vector3): void {
    for (const b of this.lamps) {
      let n: number;
      if (b.kind === 'candle') {
        n = 0.8 + 0.2 * Math.sin(elapsed * 11 + b.seed) * Math.sin(elapsed * 4.3 + b.seed * 3);
        if (b.flame) b.flame.scale.set(1, 0.85 + 0.3 * Math.sin(elapsed * 13 + b.seed), 1);
      } else if (this.cfg.blackout && b.kind === 'bulb') {
        // dead, except for the odd violent surge
        b.surge = Math.max(0, b.surge - dt * 2.2);
        if (dt > 0 && b.slot >= 0 && Math.random() < dt * 0.09) {
          b.surge = 1;
          this.onSpark(b.pos);
        }
        n = 0.02 + b.surge * (0.5 + Math.random() * 0.5);
      } else {
        n =
          0.88 +
          0.08 * Math.sin(elapsed * 7.1 + b.seed) * Math.sin(elapsed * 2.3 + b.seed * 2) +
          (Math.sin(elapsed * 0.7 + b.seed * 5) > 0.97 ? -0.5 : 0);
      }
      b.level = n;
      b.glow.color.copy(b.color).multiplyScalar(0.15 + n * 12);
    }

    // nearest lamps win a real light; a lamp on the other floor counts as further away
    const score = (l: Lamp): number =>
      l.pos.distanceTo(eye) + (Math.abs(l.pos.y - eye.y) > 2.2 ? 7 : 0);
    const wanted = this.lamps
      .filter((l) => l.lit)
      .sort((a, b) => score(a) - score(b))
      .slice(0, LIGHT_POOL);
    for (const s of this.slots) {
      if (s.lamp && !wanted.includes(s.lamp)) {
        s.lamp.slot = -1;
        s.lamp = null;
      }
    }
    for (const l of wanted) {
      if (l.slot >= 0) continue;
      const i = this.slots.findIndex((s) => !s.lamp);
      if (i < 0) break;
      const s = this.slots[i];
      s.lamp = l;
      s.fade = 0;
      l.slot = i;
      s.light.position.copy(l.pos);
      s.light.color.copy(l.color);
    }
    for (const s of this.slots) {
      s.fade = Math.min(1, s.fade + dt * 2.5 + (dt === 0 ? 1 : 0));
      s.light.intensity = s.lamp ? s.lamp.base * s.lamp.level * s.fade : 0;
    }
  }

  /** Hanging lamp: cord, tin shade, glowing bulb and its light. */
  protected lamp(x: number, z: number, intensity: number, color: number): void {
    const drop = 0.5;
    const top = this.y0 + WALL_HEIGHT;
    this.add(new THREE.CylinderGeometry(0.008, 0.008, drop, 5), this.mats.metal, x, top - drop / 2, z, 0, false);
    const shade = new THREE.ConeGeometry(0.19, 0.13, 14, 1, true);
    this.add(shade, this.mats.black, x, top - drop - 0.02, z, 0, false);
    this.point(x, top - drop - 0.11 - this.y0, z, intensity * this.cfg.lightScale, color, 'bulb');
  }

  /** Light at a height above the current floor. */
  protected point(x: number, y: number, z: number, intensity: number, color: number, kind: Lamp['kind'], lit = true): Lamp {
    const pos = new THREE.Vector3(x, this.y0 + y, z);
    const glow = new THREE.MeshBasicMaterial({ color });
    if (kind !== 'candle') {
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 8), glow);
      mesh.position.copy(pos);
      this.group.add(mesh);
    }
    const lamp: Lamp = {
      pos, glow, color: new THREE.Color(color), base: intensity, seed: Math.random() * 100, kind,
      surge: 0, level: 1, slot: -1, lit,
    };
    this.lamps.push(lamp);
    return lamp;
  }

  protected candle(x: number, y: number, z: number): void {
    const h = 0.08 + Math.random() * 0.1;
    this.add(new THREE.CylinderGeometry(0.02, 0.024, h, 8), this.mats.enamel, x, this.y0 + y + h / 2, z, 0, false);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffb060 });
    const flame = new THREE.Mesh(new THREE.SphereGeometry(0.014, 8, 6), mat);
    flame.scale.set(1, 2, 1);
    const holder = new THREE.Group();
    holder.position.set(x, this.y0 + y + h + 0.02, z);
    holder.add(flame);
    const halo = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: this.mats.glow, color: 0xff9a40, transparent: true, opacity: 0.55,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }),
    );
    halo.scale.setScalar(0.22);
    holder.add(halo);
    this.group.add(holder);
    this.lamps.push({
      pos: holder.position, glow: mat, color: new THREE.Color(0xffb060), base: 0, seed: Math.random() * 100,
      kind: 'candle', surge: 0, level: 1, flame: holder, slot: -1, lit: false,
    });
  }

  // ---- geometry batching --------------------------------------------------

  /** Queues a geometry (already in world units, centred on its origin) for the room's merged mesh. */
  protected add(
    geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, rotY = 0, cast = true,
  ): void {
    if (rotY) geo.rotateY(rotY);
    geo.translate(x, y, z);
    this.push(geo, mat, cast);
  }

  private push(geo: THREE.BufferGeometry, mat: THREE.Material, cast: boolean): void {
    const key = `${this.room}|${mat.uuid}|${cast ? 1 : 0}`;
    let b = this.batches.get(key);
    if (!b) this.batches.set(key, (b = { mat, cast, geos: [] }));
    b.geos.push(geo);
  }

  /** Merges everything queued so far into one mesh per room and material. */
  protected flush(): void {
    for (const b of this.batches.values()) {
      const merged = mergeGeometries(b.geos, false);
      for (const g of b.geos) g.dispose();
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, b.mat);
      mesh.castShadow = b.cast;
      mesh.receiveShadow = true;
      this.group.add(mesh);
    }
    this.batches.clear();
  }

  /** Axis-aligned box; `cy` is measured from the current floor. */
  protected box(
    cx: number, cy: number, cz: number, w: number, h: number, d: number, mat: THREE.Material,
    { collide = true, cast = true }: BoxOpts = {},
  ): void {
    const geo = new THREE.BoxGeometry(w, h, d);
    scaleBoxUVs(geo, w, h, d);
    this.add(geo, mat, cx, cy + this.y0, cz, 0, cast);
    if (collide) this.solid(cx, cy, cz, w, h, d);
  }

  /** Invisible collision box, `cy` from the current floor. */
  protected solid(cx: number, cy: number, cz: number, w: number, h: number, d: number): RAPIER.Collider {
    return this.physics.addStaticBox(cx, cy + this.y0, cz, w, h, d);
  }

  /** A local frame at (x, floor, z) turned by `theta`; parts are baked into the room batch. */
  protected kit(x: number, z: number, theta = 0, y = 0): Kit {
    const base = new THREE.Matrix4().makeRotationY(theta).setPosition(x, this.y0 + y, z);
    const place = (g: THREE.BufferGeometry, px: number, py: number, pz: number, mat: THREE.Material, rx = 0): void => {
      this.m4.makeRotationX(rx).setPosition(px, py, pz).premultiply(base);
      g.applyMatrix4(this.m4);
      this.push(g, mat, true);
    };
    return {
      box: (w, h, d, px, py, pz, mat, rx = 0) => {
        const g = new THREE.BoxGeometry(w, h, d);
        scaleBoxUVs(g, w, h, d);
        place(g, px, py, pz, mat, rx);
      },
      cyl: (r, h, px, py, pz, mat, axis = 'y', r2 = r) => {
        const g = new THREE.CylinderGeometry(r2, r, h, 14);
        if (axis === 'x') g.rotateZ(Math.PI / 2);
        else if (axis === 'z') g.rotateX(Math.PI / 2);
        place(g, px, py, pz, mat);
      },
      geo: (g, px, py, pz, mat) => place(g, px, py, pz, mat),
      world: (px, py, pz) => new THREE.Vector3(px, py, pz).applyMatrix4(base),
    };
  }

  // ---- structure ----------------------------------------------------------

  /** Floor and/or ceiling for a rectangle of the current level. */
  protected slab(
    x0: number, x1: number, z0: number, z1: number, floorMat: THREE.Material,
    { floor = true, ceil = true }: { floor?: boolean; ceil?: boolean } = {},
  ): void {
    const cx = (x0 + x1) / 2;
    const cz = (z0 + z1) / 2;
    const w = x1 - x0;
    const d = z1 - z0;
    if (floor) this.box(cx, -0.06, cz, w, 0.12, d, floorMat, { cast: false });
    if (ceil) this.box(cx, WALL_HEIGHT + 0.04, cz, w, 0.08, d, this.mats.plaster, { cast: false });
  }

  /**
   * Wall along an axis at a fixed coordinate with optional door gaps [from, to]. Each face takes the
   * wallpaper of the room it looks into: `neg` faces the lower coordinate, `pos` the higher one.
   */
  protected wall(
    axis: 'x' | 'z', fixed: number, a0: number, a1: number, gaps: [number, number][],
    neg: THREE.Material, pos: THREE.Material = neg, top = WALL_HEIGHT,
  ): void {
    const seg = (s0: number, s1: number, lo: number, hi: number): void => {
      const len = s1 - s0;
      if (len <= 0.001) return;
      const mid = (s0 + s1) / 2;
      const h = hi - lo;
      const cy = (lo + hi) / 2;
      for (const [side, mat] of [[-1, neg], [1, pos]] as const) {
        const off = fixed + (side * T) / 4;
        if (axis === 'x') this.box(mid, cy, off, len, h, T / 2, mat, { collide: false });
        else this.box(off, cy, mid, T / 2, h, len, mat, { collide: false });
        // skirting board
        if (lo === 0 && top >= WALL_HEIGHT) {
          const so = fixed + side * (T / 2 + 0.01);
          if (axis === 'x') this.box(mid, 0.07, so, len, 0.14, 0.02, this.mats.trim, { collide: false, cast: false });
          else this.box(so, 0.07, mid, 0.02, 0.14, len, this.mats.trim, { collide: false, cast: false });
        }
      }
      if (axis === 'x') this.solid(mid, cy, fixed, len, h, T);
      else this.solid(fixed, cy, mid, T, h, len);
    };
    let cur = a0;
    for (const [g0, g1] of [...gaps].sort((a, b) => a[0] - b[0])) {
      if (g0 > cur) seg(cur, g0, 0, top);
      if (top > DOOR_HEIGHT) seg(g0, g1, DOOR_HEIGHT, top); // lintel
      this.doorway(axis, fixed, g0, g1);
      cur = g1;
    }
    if (a1 > cur) seg(cur, a1, 0, top);
  }

  /** Box positioned by its coordinate along the wall (`along`) and across it. */
  protected wallBox(
    axis: 'x' | 'z', fixed: number, along: number, cy: number,
    len: number, h: number, thick: number, mat: THREE.Material, opts?: BoxOpts,
  ): void {
    if (axis === 'x') this.box(along, cy, fixed, len, h, thick, mat, opts);
    else this.box(fixed, cy, along, thick, h, len, mat, opts);
  }

  /** Timber frame and a sill for a door gap (the sill also hides the seam between floors). */
  private doorway(axis: 'x' | 'z', fixed: number, g0: number, g1: number): void {
    const { trim } = this.mats;
    const deep = T + 0.08;
    const none = { collide: false };
    this.wallBox(axis, fixed, g0 + 0.05, DOOR_HEIGHT / 2, 0.1, DOOR_HEIGHT, deep, trim, none);
    this.wallBox(axis, fixed, g1 - 0.05, DOOR_HEIGHT / 2, 0.1, DOOR_HEIGHT, deep, trim, none);
    this.wallBox(axis, fixed, (g0 + g1) / 2, DOOR_HEIGHT - 0.05, g1 - g0, 0.1, deep, trim, none);
    this.wallBox(axis, fixed, (g0 + g1) / 2, 0.006, g1 - g0, 0.012, T + 0.06, trim, { collide: false, cast: false });
  }

  /**
   * Straight flight from the current floor up to the next. (bx, bz) is the middle of the bottom
   * edge and `heading` the direction of travel going up. The player walks on a smooth ramp.
   */
  protected stairs(bx: number, bz: number, heading: Facing, run: number, width: number): void {
    const { fx, fz } = FACING[heading];
    const steps = 15;
    const tread = run / steps;
    for (let i = 0; i < steps; i++) {
      const top = ((i + 0.5) * FLOOR_H) / steps;
      const along = (i + 0.5) * tread;
      const w = fx !== 0 ? tread : width;
      const d = fx !== 0 ? width : tread;
      this.box(bx + fx * along, top / 2, bz + fz * along, w, top, d, this.mats.wood, { collide: false });
    }
    const theta = Math.atan2(FLOOR_H, run);
    const len = Math.hypot(run, FLOOR_H);
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(theta, Math.atan2(-fx, -fz), 0, 'YXZ'));
    const normal = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
    const c = new THREE.Vector3(bx + (fx * run) / 2, this.y0 + FLOOR_H / 2, bz + (fz * run) / 2).addScaledVector(normal, -0.1);
    this.physics.world.createCollider(
      RAPIER.ColliderDesc.cuboid(width / 2, 0.1, len / 2).setTranslation(c.x, c.y, c.z).setRotation(q),
    );
  }

  /** Waist-high banister around a stairwell. */
  protected banister(axis: 'x' | 'z', fixed: number, a0: number, a1: number): void {
    const mid = (a0 + a1) / 2;
    const len = a1 - a0;
    this.wallBox(axis, fixed, mid, 0.98, len, 0.07, 0.1, this.mats.trim, { collide: false });
    this.wallBox(axis, fixed, mid, 0.08, len, 0.06, 0.07, this.mats.trim, { collide: false });
    for (let a = a0 + 0.1; a < a1; a += 0.22) {
      this.wallBox(axis, fixed, a, 0.52, 0.035, 0.86, 0.035, this.mats.trim, { collide: false });
    }
    // taller than it looks, so nobody vaults it (and she cannot see through it at knee height)
    if (axis === 'x') this.solid(mid, 0.7, fixed, len, 1.4, 0.1);
    else this.solid(fixed, 0.7, mid, 0.1, 1.4, len);
  }

  // ---- decoration ---------------------------------------------------------

  /** Moonlit window on the room side of an outside wall. `facing` points into the room. */
  protected window(x: number, z: number, facing: Facing, w = 1.2): void {
    const k = this.kit(x, z, FACING[facing].theta);
    const { trim, moonGlass, fabric } = this.mats;
    const cy = 1.5;
    const h = 1.3;
    k.box(w, h, 0.02, 0, cy, 0.012, moonGlass);
    k.box(w + 0.14, 0.07, 0.06, 0, cy + h / 2 + 0.03, 0.03, trim);
    k.box(w + 0.2, 0.06, 0.12, 0, cy - h / 2 - 0.03, 0.06, trim);
    for (const sx of [-1, 1]) k.box(0.07, h, 0.06, (sx * (w + 0.07)) / 2, cy, 0.03, trim);
    k.box(0.04, h, 0.04, 0, cy, 0.03, trim);
    k.box(w, 0.04, 0.04, 0, cy + 0.1, 0.03, trim);
    // heavy curtains pulled half open
    for (const sx of [-1, 1]) k.box(0.34, h + 0.5, 0.07, sx * (w / 2 + 0.1), cy - 0.05, 0.09, fabric.wine);
    k.box(w + 0.7, 0.05, 0.05, 0, cy + h / 2 + 0.24, 0.09, trim);
  }

  /** Framed picture hung on a wall; `facing` points into the room. */
  protected picture(x: number, z: number, facing: Facing, w = 0.7, h = 0.9, y = 1.6): void {
    const k = this.kit(x, z, FACING[facing].theta);
    k.box(w + 0.1, h + 0.1, 0.04, 0, y, 0.02, this.mats.trim);
    k.box(w, h, 0.02, 0, y, 0.035, this.mats.books[Math.floor(Math.random() * this.mats.books.length)]);
    k.box(w * 0.45, h * 0.55, 0.012, 0, y + h * 0.05, 0.044, this.mats.black);
  }

  protected rug(cx: number, cz: number, w: number, d: number, mat: THREE.Material): void {
    this.box(cx, 0.008, cz, w, 0.016, d, mat, { collide: false, cast: false });
    this.box(cx, 0.006, cz, w + 0.16, 0.012, d + 0.16, this.mats.fabric.cream, { collide: false, cast: false });
  }

  /**
   * Flat decal. On the floor, (a, b) = (x, z). On a wall, `on` is the direction the decal
   * faces, (a, b) = (x, z) of the wall surface and `y` its height.
   */
  protected decal(mat: THREE.Material, a: number, b: number, size: number, on: 'floor' | Facing, y = 0): void {
    const floor = on === 'floor';
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(size, floor ? size : size * 0.25), mat);
    if (floor) {
      mesh.rotation.set(-Math.PI / 2, 0, Math.random() * Math.PI * 2, 'YXZ');
      mesh.position.set(a, this.y0 + 0.02, b);
    } else {
      mesh.rotation.y = FACING[on].theta;
      mesh.position.set(a, this.y0 + y, b);
    }
    mesh.receiveShadow = true;
    this.group.add(mesh);
  }

  // ---- furniture ----------------------------------------------------------

  /** Slatted wardrobe against a wall; `facing` is the direction its door looks. */
  protected wardrobe(x: number, z: number, facing: Facing): void {
    const W = 1.0;
    const Hh = 2.05;
    const D = 0.7;
    const { theta, fx, fz } = FACING[facing];
    const k = this.kit(x, z, theta);
    const m = this.mats.crate;
    k.box(W, Hh, 0.04, 0, Hh / 2, -D / 2 + 0.02, m); // back
    k.box(0.04, Hh, D, -W / 2 + 0.02, Hh / 2, 0, m); // sides
    k.box(0.04, Hh, D, W / 2 - 0.02, Hh / 2, 0, m);
    k.box(W, 0.04, D, 0, Hh - 0.02, 0, m); // top
    k.box(W, 0.04, D, 0, 0.02, 0, m); // bottom
    k.box(W + 0.08, 0.06, D + 0.06, 0, Hh + 0.03, 0, this.mats.trim); // cornice
    const front = D / 2 - 0.02;
    k.box(W - 0.08, 1.14, 0.03, 0, 0.61, front, m); // lower door panel
    k.box(W - 0.08, 0.1, 0.03, 0, Hh - 0.09, front, m); // top rail
    k.box(0.03, Hh - 0.08, 0.035, 0, Hh / 2, front + 0.005, m); // centre stile
    for (let i = 0; i < 6; i++) k.box(W - 0.08, 0.04, 0.012, 0, 1.25 + i * 0.125, front, m, 0.35);
    for (const hx of [-0.07, 0.07]) k.geo(new THREE.SphereGeometry(0.022, 8, 6), hx, 1.0, front + 0.035, this.mats.metal);

    const alongX = fx !== 0;
    this.solid(x, Hh / 2, z, alongX ? D : W, Hh, alongX ? W : D);
    const out = D / 2 + 0.6;
    const y = this.y0 + 0.85;
    this.hideSpots.push({
      id: this.hideSpots.length,
      kind: 'wardrobe',
      pos: new THREE.Vector3(x + fx * 0.08, y, z + fz * 0.08),
      yaw: Math.atan2(-fx, -fz),
      exit: new THREE.Vector3(x + fx * out, y, z + fz * out),
      door: new THREE.Vector3(x + (fx * D) / 2, this.y0 + 1.25, z + (fz * D) / 2),
      eye: 0.7,
    });
  }

  /** Iron-framed bed. `facing` runs from the headboard to the foot; players can crawl underneath. */
  protected bed(x: number, z: number, facing: Facing, cover: THREE.Material): void {
    const W = 1.5;
    const L = 2.1;
    const { theta, fx } = FACING[facing];
    const k = this.kit(x, z, theta);
    const { trim, fabric, metal } = this.mats;
    k.box(W, 0.1, L, 0, 0.42, 0, trim); // base
    k.box(W - 0.08, 0.2, L - 0.1, 0, 0.57, 0, fabric.cream); // mattress
    k.box(W + 0.02, 0.07, L * 0.62, 0, 0.69, L * 0.17, cover); // blanket
    k.box(W + 0.04, 0.32, 0.03, 0, 0.5, L / 2 + 0.01, cover); // blanket hanging over the foot
    for (const px of [-0.36, 0.36]) k.box(0.55, 0.1, 0.36, px, 0.72, -L / 2 + 0.3, fabric.cream); // pillows
    k.box(W + 0.06, 1.15, 0.07, 0, 0.6, -L / 2 - 0.02, trim); // headboard
    k.box(W + 0.06, 0.62, 0.06, 0, 0.36, L / 2 + 0.04, trim); // footboard
    for (const [px, pz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      k.cyl(0.035, 0.4, px * (W / 2 - 0.05), 0.2, pz * (L / 2 - 0.05), metal);
    }
    const alongX = fx !== 0;
    // the frame leaves the floor clear underneath, but nothing walks through it
    this.solid(x, 0.4, z, alongX ? L : W, 0.8, alongX ? W : L);
    const side = k.world(W / 2 + 0.55, 0, 0.2);
    this.hideSpots.push({
      id: this.hideSpots.length,
      kind: 'bed',
      pos: new THREE.Vector3(x, this.y0 + 0.85, z),
      yaw: theta + Math.PI / 2 + Math.PI, // looking out from under the long side
      exit: new THREE.Vector3(side.x, this.y0 + 0.85, side.z),
      door: k.world(W / 2, 0.3, 0.2),
      eye: -0.64,
    });
  }

  /** Solid table with a top and four legs. */
  protected table(x: number, z: number, w: number, d: number, h = 0.78, mat: THREE.Material = this.mats.trim): void {
    const k = this.kit(x, z);
    k.box(w, 0.05, d, 0, h - 0.025, 0, mat);
    k.box(w - 0.12, 0.08, d - 0.12, 0, h - 0.09, 0, mat);
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      k.box(0.06, h - 0.05, 0.06, sx * (w / 2 - 0.07), (h - 0.05) / 2, sz * (d / 2 - 0.07), mat);
    }
    this.solid(x, Math.max(h, 0.65) / 2, z, w, Math.max(h, 0.65), d);
  }

  /** Low chest of drawers / sideboard against a wall. */
  protected dresser(x: number, z: number, facing: Facing, w = 1.4, h = 0.9, d = 0.5): void {
    const { theta, fx } = FACING[facing];
    const k = this.kit(x, z, theta);
    const { trim, metal, crate } = this.mats;
    k.box(w, h, d, 0, h / 2, 0, crate);
    k.box(w + 0.06, 0.04, d + 0.04, 0, h + 0.02, 0, trim);
    const rows = Math.max(2, Math.round(h / 0.3));
    for (let r = 0; r < rows; r++) {
      const y = ((r + 0.5) * (h - 0.08)) / rows + 0.04;
      k.box(w - 0.1, (h - 0.08) / rows - 0.04, 0.02, 0, y, d / 2 + 0.005, trim);
      for (const hx of [-w / 4, w / 4]) k.geo(new THREE.SphereGeometry(0.02, 8, 6), hx, y, d / 2 + 0.03, metal);
    }
    this.solid(x, h / 2, z, fx !== 0 ? d : w, h, fx !== 0 ? w : d);
  }

  protected sofa(x: number, z: number, facing: Facing, w = 2.2, cloth: THREE.Material = this.mats.fabric.moss): void {
    const { theta, fx } = FACING[facing];
    const k = this.kit(x, z, theta);
    const D = 0.9;
    k.box(w, 0.3, D, 0, 0.27, 0, cloth);
    k.box(w, 0.6, 0.22, 0, 0.62, -D / 2 + 0.11, cloth);
    for (const sx of [-1, 1]) k.box(0.2, 0.5, D, sx * (w / 2 - 0.1), 0.42, 0, cloth);
    const n = Math.max(1, Math.round((w - 0.4) / 0.85));
    for (let i = 0; i < n; i++) {
      k.box((w - 0.44) / n - 0.03, 0.12, D - 0.3, -(w - 0.44) / 2 + ((i + 0.5) * (w - 0.44)) / n, 0.47, 0.08, cloth);
    }
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      k.box(0.06, 0.12, 0.06, sx * (w / 2 - 0.08), 0.06, sz * (D / 2 - 0.08), this.mats.trim);
    }
    this.solid(x, 0.45, z, fx !== 0 ? D : w, 0.9, fx !== 0 ? w : D);
  }

  /** Bookcase against a wall, stuffed with books. `facing` points into the room. */
  protected bookshelf(x: number, z: number, facing: Facing, w = 2): void {
    const { theta, fx } = FACING[facing];
    const k = this.kit(x, z, theta);
    const { trim, books } = this.mats;
    const H = 2.1;
    const D = 0.36;
    k.box(w, H, 0.03, 0, H / 2, -D / 2 + 0.015, trim);
    for (const sx of [-1, 1]) k.box(0.04, H, D, sx * (w / 2 - 0.02), H / 2, 0, trim);
    for (let s = 0; s < 6; s++) k.box(w - 0.06, 0.03, D, 0, 0.08 + s * 0.4, 0, trim);
    for (let s = 0; s < 5; s++) {
      let bx = -w / 2 + 0.06;
      while (bx < w / 2 - 0.12) {
        const bw = 0.03 + Math.random() * 0.05;
        const bh = 0.2 + Math.random() * 0.14;
        if (Math.random() < 0.86) {
          k.box(bw, bh, 0.2 + Math.random() * 0.06, bx + bw / 2, 0.1 + s * 0.4 + bh / 2, 0.02, books[Math.floor(Math.random() * books.length)]);
        }
        bx += bw + 0.004;
      }
    }
    this.solid(x, H / 2, z, fx !== 0 ? D : w, H, fx !== 0 ? w : D);
  }

  /** Open storage shelves with a row of murky jars. `facing` points into the room. */
  protected shelf(x: number, z: number, facing: Facing): void {
    const { theta, fx } = FACING[facing];
    const k = this.kit(x, z, theta);
    const { crate } = this.mats;
    for (const dx of [-0.8, 0.8]) k.box(0.06, 2.0, 0.4, dx, 1.0, 0, crate);
    for (const y of [0.35, 0.9, 1.45, 1.97]) k.box(1.6, 0.05, 0.4, 0, y, 0, crate);
    for (const y of [0.9, 1.45]) {
      for (let i = 0; i < 6; i++) {
        if (Math.random() < 0.3) continue;
        k.cyl(0.055, 0.16 * (0.8 + Math.random() * 0.5), -0.62 + i * 0.25, y + 0.11, -0.03, this.mats.enamel);
      }
    }
    this.solid(x, 1.0, z, fx !== 0 ? 0.4 : 1.66, 2.0, fx !== 0 ? 1.66 : 0.4);
  }

  protected barrel(x: number, z: number): void {
    const k = this.kit(x, z);
    k.cyl(0.4, 1.1, 0, 0.55, 0, this.mats.crate);
    for (const y of [0.2, 0.9]) k.cyl(0.412, 0.05, 0, y, 0, this.mats.metal);
    this.physics.addStaticCylinder(x, this.y0 + 0.55, z, 0.42, 1.1);
  }

  protected crateBox(x: number, z: number, s = 0.9, y = 0): void {
    this.box(x, y + s / 2, z, s, s, s, this.mats.crate);
  }

  /** Tall case clock. */
  protected clock(x: number, z: number, facing: Facing): void {
    const { theta } = FACING[facing];
    const k = this.kit(x, z, theta);
    const { trim, enamel, metal } = this.mats;
    k.box(0.5, 0.35, 0.34, 0, 0.175, 0, trim);
    k.box(0.36, 1.1, 0.26, 0, 0.9, 0, trim);
    k.box(0.5, 0.5, 0.34, 0, 1.7, 0, trim);
    k.box(0.56, 0.06, 0.4, 0, 1.98, 0, trim);
    k.cyl(0.17, 0.02, 0, 1.7, 0.175, enamel, 'z');
    k.cyl(0.07, 0.02, 0, 0.72, 0.135, metal, 'z');
    k.box(0.015, 0.5, 0.01, 0, 0.98, 0.135, metal);
    this.solid(x, 1.0, z, 0.5, 2.0, 0.5);
  }
}
