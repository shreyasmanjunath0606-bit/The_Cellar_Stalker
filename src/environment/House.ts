import * as THREE from 'three';
import { Physics, RAPIER } from '../core/Physics';
import { AreaId, LevelConfig } from '../core/Levels';
import { Materials, scaleBoxUVs } from '../rendering/Materials';

export const WALL_HEIGHT = 2.8;
const DOOR_HEIGHT = 2.1;
const T = 0.3; // wall thickness

type Facing = 'x+' | 'x-' | 'z+' | 'z-';
const FACING: Record<Facing, { theta: number; fx: number; fz: number }> = {
  'z+': { theta: 0, fx: 0, fz: 1 },
  'x+': { theta: Math.PI / 2, fx: 1, fz: 0 },
  'z-': { theta: Math.PI, fx: 0, fz: -1 },
  'x-': { theta: -Math.PI / 2, fx: -1, fz: 0 },
};

/** A wardrobe the player can climb into. */
export interface HideSpot {
  /** Where the player's body sits while hidden. */
  pos: THREE.Vector3;
  /** Camera yaw that looks straight out through the slats. */
  yaw: number;
  /** Where the player steps out to. */
  exit: THREE.Vector3;
  /** Centre of the door, for look-at interaction. */
  door: THREE.Vector3;
}

interface Bulb {
  light: THREE.PointLight;
  glow: THREE.MeshBasicMaterial;
  color: THREE.Color;
  base: number;
  seed: number;
  /** 'exit' and 'candle' ignore blackouts. */
  kind: 'bulb' | 'exit' | 'candle';
  surge: number;
  flame?: THREE.Object3D;
}

interface BoxOpts {
  collide?: boolean;
  cast?: boolean;
}

/**
 * Procedural claustrophobic cellar. The hall, storeroom and north room are
 * always open; the west wing and the crypt behind it are boarded up until
 * later nights, at which point the plan becomes a loop:
 *
 *                      z-
 *   [    crypt    ][ north room ]
 *   [ west wing ][    hall     ][ storeroom ]
 *                ====escape door====
 *                      z+
 */
export class House {
  readonly group = new THREE.Group();
  readonly spawn = new THREE.Vector3(0, 0.85, 3.2);
  readonly doorPos = new THREE.Vector3(0, 1, 5);
  readonly hideSpots: HideSpot[] = [];
  /** A dead bulb just surged (blackout nights). */
  onSpark: (pos: THREE.Vector3) => void = () => {};
  escapeDoor!: THREE.Mesh;

  private doorCollider: RAPIER.Collider | null = null;
  private doorOpening = false;
  private doorProgress = 0;
  private readonly bulbs: Bulb[] = [];
  private readonly to = new THREE.Vector3();

  constructor(
    private readonly physics: Physics,
    private readonly mats: Materials,
    private readonly cfg: LevelConfig,
  ) {
    this.build();
  }

  /** True while the player is close to and facing the locked door. */
  canInteractDoor(origin: THREE.Vector3, dir: THREE.Vector3): boolean {
    if (this.doorOpening) return false;
    const to = this.to.set(0, DOOR_HEIGHT / 2, 5).sub(origin);
    const dist = to.length();
    return dist < 2.8 && to.divideScalar(dist).dot(dir) > 0.8;
  }

  /** The wardrobe the player is standing at and looking at, if any. */
  focusHideSpot(origin: THREE.Vector3, dir: THREE.Vector3): HideSpot | null {
    for (const s of this.hideSpots) {
      const to = this.to.copy(s.door).sub(origin);
      const dist = to.length();
      if (dist < 2.1 && to.divideScalar(dist).dot(dir) > 0.72) return s;
    }
    return null;
  }

  unlockDoor(): void {
    this.doorOpening = true;
  }

  /** Door collider is removed once it has risen far enough to walk under. */
  get doorOpen(): boolean {
    return this.doorOpening && this.doorProgress >= 0.85;
  }

  update(elapsed: number, dt: number): void {
    if (this.doorOpening && this.doorProgress < 1) {
      this.doorProgress = Math.min(1, this.doorProgress + dt / 2.5);
      this.escapeDoor.position.y = DOOR_HEIGHT / 2 + this.doorProgress * DOOR_HEIGHT;
      if (this.doorProgress >= 0.85 && this.doorCollider) {
        this.physics.world.removeCollider(this.doorCollider, true);
        this.doorCollider = null;
      }
    }
    for (const b of this.bulbs) {
      let n: number;
      if (b.kind === 'candle') {
        n = 0.8 + 0.2 * Math.sin(elapsed * 11 + b.seed) * Math.sin(elapsed * 4.3 + b.seed * 3);
        if (b.flame) b.flame.scale.set(1, 0.85 + 0.3 * Math.sin(elapsed * 13 + b.seed), 1);
      } else if (this.cfg.blackout && b.kind === 'bulb') {
        // dead, except for the odd violent surge
        b.surge = Math.max(0, b.surge - dt * 2.2);
        if (dt > 0 && Math.random() < dt * 0.11) {
          b.surge = 1;
          this.onSpark(b.light.position);
        }
        n = 0.02 + b.surge * (0.5 + Math.random() * 0.5);
      } else {
        n =
          0.88 +
          0.08 * Math.sin(elapsed * 7.1 + b.seed) * Math.sin(elapsed * 2.3 + b.seed * 2) +
          (Math.sin(elapsed * 0.7 + b.seed * 5) > 0.97 ? -0.5 : 0);
      }
      b.light.intensity = b.base * n;
      b.glow.color.copy(b.color).multiplyScalar(0.15 + n * 12);
    }
  }

  // ---- construction -------------------------------------------------------

  private has(area: AreaId): boolean {
    return this.cfg.areas.includes(area);
  }

  private build(): void {
    const { concrete, wood, brick, stone, crate, metal } = this.mats;
    const H = WALL_HEIGHT;
    const west = this.has('west');
    const crypt = this.has('crypt');
    const L = this.cfg.lightScale;

    // ---- hall ----
    this.slab(0, 0, 12.3, 10.3, wood);
    this.wall('x', 5, -6.15, 6.15, [[-1.25, 1.25]]); // south: escape door
    this.wall('z', -6, -5.15, 5.15, [[-1, 1]]); // west doorway
    this.wall('z', 6, -5.15, 5.15, [[-1, 1]]); // east doorway
    this.wall('x', -5, -6.15, 6.15, [[-1, 1]]); // north doorway
    this.doorway('x', 5, -1.25, 1.25);
    this.doorway('z', 6, -1, 1);
    this.doorway('x', -5, -1, 1);
    this.doorway('z', -6, -1, 1);
    if (!west) this.barricade('z', -6, -1, 1, 1);

    for (const [x, z] of [[-3, -2], [3, -2], [-3, 2.5], [3, 2.5]]) {
      this.box(x, H / 2, z, 0.6, H, 0.6, concrete);
    }
    for (const z of [-2, 2.5]) this.box(0, H - 0.11, z, 11.7, 0.22, 0.24, crate, { collide: false });

    const pipeGeo = new THREE.CylinderGeometry(0.08, 0.08, 11.7, 12);
    pipeGeo.rotateZ(Math.PI / 2);
    for (const z of [-4.6, -4.35]) {
      const pipe = new THREE.Mesh(pipeGeo, metal);
      pipe.position.set(0, H - 0.2, z);
      pipe.castShadow = true;
      this.group.add(pipe);
    }
    this.box(-4.8, 0.45, -3.6, 1.0, 0.9, 1.0, crate);
    this.wardrobe(5.5, -3.9, 'x-');
    this.lamp(0, 0, 55 * L, 0xffa860);
    this.decal(this.mats.blood[0], 1.6, -1.3, 1.7, 'floor');
    this.decal(this.mats.blood[1], -1.2, 4.1, 1.1, 'floor');
    this.decal(this.mats.text("DON'T MAKE A SOUND"), -3.3, -4.84, 2.8, 'z+', 1.55);
    this.decal(this.mats.text('SHE LISTENS'), 3.5, 4.84, 2.2, 'z-', 1.5);

    // escape door and the corridor behind it
    this.escapeDoor = this.box(0, DOOR_HEIGHT / 2, 5, 2.5, DOOR_HEIGHT, 0.15, metal, { collide: false });
    for (const y of [-0.55, 0.5]) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.1, 0.05), crate);
      bar.position.set(0, y, -0.1);
      bar.castShadow = true;
      this.escapeDoor.add(bar);
    }
    this.doorCollider = this.physics.addStaticBox(0, DOOR_HEIGHT / 2, 5, 2.5, DOOR_HEIGHT, 0.15);
    this.slab(0, 7, 2.8, 4.3, concrete);
    this.wall('z', -1.4, 5.15, 9.15);
    this.wall('z', 1.4, 5.15, 9.15);
    this.wall('x', 9, -1.4, 1.4);
    const exitGlow = new THREE.Mesh(
      new THREE.PlaneGeometry(2.2, 2.4),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(0xdfe9ff).multiplyScalar(4), fog: false }),
    );
    exitGlow.position.set(0, 1.3, 8.84);
    exitGlow.rotation.y = Math.PI; // face the player coming from the hall
    this.group.add(exitGlow);
    this.point(0, H - 0.35, 7, 22, 0xaac8ff, 'exit');

    // ---- storeroom (east) ----
    this.slab(9.5, 0, 7.3, 8.3, concrete);
    this.wall('x', -4, 6, 13.15);
    this.wall('x', 4, 6, 13.15);
    this.wall('z', 13, -4.15, 4.15);
    this.box(11.6, 0.45, -2.7, 0.9, 0.9, 0.9, crate);
    this.box(11.7, 0.45, -1.7, 0.9, 0.9, 0.9, crate);
    this.box(11.65, 1.35, -2.4, 0.8, 0.9, 0.8, crate);
    this.box(8.5, 0.3, 3.2, 1.4, 0.6, 0.8, crate);
    this.shelf(10.5, 3.62);
    this.wardrobe(8, -3.5, 'z+');
    this.lamp(9.5, 0, 32 * L, 0xff9a50);
    this.decal(this.mats.blood[2], 10.6, 1.2, 1.3, 'floor');

    // ---- north room ----
    this.slab(0, -8.5, 8.3, 7.3, concrete);
    this.wall('z', -4, -12.15, -5, [[-9.5, -7.5]]);
    this.wall('z', 4, -12.15, -5);
    this.wall('x', -12, -4.15, 4.15);
    this.doorway('z', -4, -9.5, -7.5);
    if (!crypt) this.barricade('z', -4, -9.5, -7.5, 1);
    this.box(2.6, 0.4, -10.8, 1.6, 0.8, 0.9, crate);
    this.wardrobe(-0.5, -11.5, 'z+');
    this.lamp(0, -8.5, 28 * L, 0xe8a870);
    this.decal(this.mats.blood[0], -1.8, -9.6, 1.2, 'floor');

    // ---- west wing ----
    if (west) {
      this.slab(-9.5, 0, 7.3, 10.3, concrete);
      this.wall('x', -5, -13.15, -6.15, [[-10.5, -8.5]], brick);
      this.wall('x', 5, -13.15, -6.15, [], brick);
      this.wall('z', -13, -5.15, 5.15, [], brick);
      this.doorway('x', -5, -10.5, -8.5);
      if (!crypt) this.barricade('x', -5, -10.5, -8.5, 1);
      for (const [x, z] of [[-12.2, -4.2], [-11.2, -4.3], [-12.3, -3.2]]) this.barrel(x, z);
      // workbench
      this.box(-9.5, 0.86, 4.45, 2.0, 0.08, 0.75, wood, { collide: false });
      for (const dx of [-0.9, 0.9]) {
        for (const dz of [-0.3, 0.3]) this.box(-9.5 + dx, 0.41, 4.45 + dz, 0.08, 0.82, 0.08, wood, { collide: false });
      }
      this.physics.addStaticBox(-9.5, 0.45, 4.45, 2.0, 0.9, 0.75);
      this.wardrobe(-12.5, 2, 'x+');
      this.lamp(-9.5, 0, 32 * L, 0xff9050);
      this.decal(this.mats.blood[1], -8.2, -1.6, 1.5, 'floor');
      this.decal(this.mats.text('HIDE'), -12.84, -0.6, 1.3, 'x+', 1.5);
    }

    // ---- crypt ----
    if (crypt) {
      this.slab(-8.5, -8.5, 9.3, 7.3, stone);
      this.wall('z', -13, -12.15, -5.15, [], stone);
      this.wall('x', -12, -13.15, -4.15, [], stone);
      this.box(-9, 0.45, -8.5, 1.2, 0.9, 1.2, stone); // altar
      // a coffin with its lid pushed askew
      this.box(-5, 0.3, -10.4, 0.8, 0.6, 1.8, stone);
      const lid = this.box(-5.08, 0.64, -10.3, 0.86, 0.08, 1.86, stone, { collide: false });
      lid.rotation.y = 0.14;
      this.wardrobe(-9, -11.5, 'z+');
      for (const [dx, dz] of [[-0.45, -0.45], [0.45, -0.45], [-0.45, 0.45], [0.45, 0.4]]) {
        this.candle(-9 + dx, 0.9, -8.5 + dz);
      }
      this.point(-9, 1.5, -8.5, 9, 0xff8a3a, 'candle');
      this.decal(this.mats.blood[2], -9, -7.1, 1.8, 'floor');
      this.decal(this.mats.text('NO WAY OUT'), -12.84, -8.5, 2.4, 'x+', 1.5);
    }
  }

  private slab(cx: number, cz: number, w: number, d: number, floorMat: THREE.Material): void {
    this.box(cx, -0.1, cz, w, 0.2, d, floorMat, { cast: false });
    this.box(cx, WALL_HEIGHT + 0.1, cz, w, 0.2, d, this.mats.wall, { cast: false });
  }

  /** Wall along an axis at a fixed coordinate, with optional door gaps [from, to]. */
  private wall(
    axis: 'x' | 'z',
    fixed: number,
    a0: number,
    a1: number,
    gaps: [number, number][] = [],
    mat: THREE.Material = this.mats.wall,
  ): void {
    const H = WALL_HEIGHT;
    const seg = (s0: number, s1: number, y0: number, y1: number): void => {
      const len = s1 - s0;
      const mid = (s0 + s1) / 2;
      const h = y1 - y0;
      const cy = (y0 + y1) / 2;
      if (axis === 'x') this.box(mid, cy, fixed, len, h, T, mat);
      else this.box(fixed, cy, mid, T, h, len, mat);
    };
    let cur = a0;
    for (const [g0, g1] of [...gaps].sort((a, b) => a[0] - b[0])) {
      if (g0 > cur) seg(cur, g0, 0, H);
      seg(g0, g1, DOOR_HEIGHT, H); // lintel
      cur = g1;
    }
    if (a1 > cur) seg(cur, a1, 0, H);
  }

  /** Box positioned by its coordinate along the wall (`along`) and across it. */
  private wallBox(
    axis: 'x' | 'z', fixed: number, along: number, cy: number,
    len: number, h: number, thick: number, mat: THREE.Material, opts?: BoxOpts,
  ): THREE.Mesh {
    return axis === 'x'
      ? this.box(along, cy, fixed, len, h, thick, mat, opts)
      : this.box(fixed, cy, along, thick, h, len, mat, opts);
  }

  /** Timber frame and a metal sill for a door gap (the sill also hides the seam between floors). */
  private doorway(axis: 'x' | 'z', fixed: number, g0: number, g1: number): void {
    const { crate, metal } = this.mats;
    const deep = T + 0.08;
    const none = { collide: false };
    this.wallBox(axis, fixed, g0 + 0.05, DOOR_HEIGHT / 2, 0.1, DOOR_HEIGHT, deep, crate, none);
    this.wallBox(axis, fixed, g1 - 0.05, DOOR_HEIGHT / 2, 0.1, DOOR_HEIGHT, deep, crate, none);
    this.wallBox(axis, fixed, (g0 + g1) / 2, DOOR_HEIGHT - 0.05, g1 - g0, 0.1, deep, crate, none);
    this.wallBox(axis, fixed, (g0 + g1) / 2, 0.008, g1 - g0, 0.016, T + 0.06, metal, { collide: false, cast: false });
  }

  /** Boards up a door gap. `side` (+1 / -1) is the side the planks are nailed to. */
  private barricade(axis: 'x' | 'z', fixed: number, g0: number, g1: number, side: number): void {
    const { crate } = this.mats;
    const mid = (g0 + g1) / 2;
    const len = g1 - g0;
    this.wallBox(axis, fixed, mid, DOOR_HEIGHT / 2, len, DOOR_HEIGHT, 0.14, crate);
    const off = fixed + side * (T / 2 + 0.04);
    for (const [y, tilt] of [[0.55, 0.1], [1.1, -0.14], [1.65, 0.07]]) {
      const geo = new THREE.BoxGeometry(len + 0.5, 0.17, 0.05);
      scaleBoxUVs(geo, len + 0.5, 0.17, 0.05);
      const plank = new THREE.Mesh(geo, crate);
      plank.castShadow = plank.receiveShadow = true;
      if (axis === 'x') {
        plank.position.set(mid, y, off);
        plank.rotation.z = tilt;
      } else {
        plank.position.set(off, y, mid);
        plank.rotation.set(0, Math.PI / 2, tilt, 'YXZ');
      }
      this.group.add(plank);
    }
  }

  private box(
    cx: number,
    cy: number,
    cz: number,
    w: number,
    h: number,
    d: number,
    mat: THREE.Material,
    { collide = true, cast = true }: BoxOpts = {},
  ): THREE.Mesh {
    const geo = new THREE.BoxGeometry(w, h, d);
    scaleBoxUVs(geo, w, h, d);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(cx, cy, cz);
    mesh.castShadow = cast;
    mesh.receiveShadow = true;
    this.group.add(mesh);
    if (collide) this.physics.addStaticBox(cx, cy, cz, w, h, d);
    return mesh;
  }

  /** Slatted wardrobe against a wall; `facing` is the direction its door looks. */
  private wardrobe(x: number, z: number, facing: Facing): void {
    const W = 1.0;
    const Hh = 2.05;
    const D = 0.7;
    const { theta, fx, fz } = FACING[facing];
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    g.rotation.y = theta;
    const part = (w: number, h: number, d: number, px: number, py: number, pz: number, rx = 0): void => {
      const geo = new THREE.BoxGeometry(w, h, d);
      scaleBoxUVs(geo, w, h, d);
      const m = new THREE.Mesh(geo, this.mats.crate);
      m.position.set(px, py, pz);
      m.rotation.x = rx;
      m.castShadow = m.receiveShadow = true;
      g.add(m);
    };
    part(W, Hh, 0.04, 0, Hh / 2, -D / 2 + 0.02); // back
    part(0.04, Hh, D, -W / 2 + 0.02, Hh / 2, 0); // sides
    part(0.04, Hh, D, W / 2 - 0.02, Hh / 2, 0);
    part(W, 0.04, D, 0, Hh - 0.02, 0); // top
    part(W, 0.04, D, 0, 0.02, 0); // bottom
    const front = D / 2 - 0.02;
    part(W - 0.08, 1.14, 0.03, 0, 0.61, front); // lower door panel
    part(W - 0.08, 0.1, 0.03, 0, Hh - 0.09, front); // top rail
    part(0.03, Hh - 0.08, 0.035, 0, Hh / 2, front + 0.005); // centre stile
    for (let i = 0; i < 6; i++) part(W - 0.08, 0.04, 0.012, 0, 1.25 + i * 0.125, front, 0.35);
    for (const hx of [-0.07, 0.07]) {
      const knob = new THREE.Mesh(new THREE.SphereGeometry(0.022, 8, 6), this.mats.metal);
      knob.position.set(hx, 1.0, front + 0.035);
      g.add(knob);
    }
    this.group.add(g);

    const alongX = fx !== 0;
    this.physics.addStaticBox(x, Hh / 2, z, alongX ? D : W, Hh, alongX ? W : D);
    const out = D / 2 + 0.6;
    this.hideSpots.push({
      pos: new THREE.Vector3(x + fx * 0.08, 0.85, z + fz * 0.08),
      yaw: Math.atan2(-fx, -fz),
      exit: new THREE.Vector3(x + fx * out, 0.85, z + fz * out),
      door: new THREE.Vector3(x + (fx * D) / 2, 1.25, z + (fz * D) / 2),
    });
  }

  /** Storage shelves with a row of murky jars, backed against a z+ wall. */
  private shelf(x: number, z: number): void {
    const { crate } = this.mats;
    const none = { collide: false };
    for (const dx of [-0.8, 0.8]) this.box(x + dx, 1.0, z, 0.06, 2.0, 0.4, crate, none);
    for (const y of [0.35, 0.9, 1.45, 1.97]) this.box(x, y, z, 1.6, 0.05, 0.4, crate, none);
    this.physics.addStaticBox(x, 1.0, z, 1.66, 2.0, 0.4);
    const glass = new THREE.MeshStandardMaterial({
      color: 0x55705a, roughness: 0.15, metalness: 0.1, transparent: true, opacity: 0.75,
    });
    const jarGeo = new THREE.CylinderGeometry(0.055, 0.055, 0.16, 10);
    for (const y of [0.9, 1.45]) {
      for (let i = 0; i < 6; i++) {
        if (Math.random() < 0.25) continue;
        const jar = new THREE.Mesh(jarGeo, glass);
        jar.position.set(x - 0.62 + i * 0.25 + (Math.random() - 0.5) * 0.06, y + 0.105, z - 0.03);
        jar.scale.y = 0.8 + Math.random() * 0.5;
        jar.castShadow = true;
        this.group.add(jar);
      }
    }
  }

  private barrel(x: number, z: number): void {
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 1.1, 16), this.mats.crate);
    body.position.set(x, 0.55, z);
    body.castShadow = body.receiveShadow = true;
    this.group.add(body);
    const bandGeo = new THREE.CylinderGeometry(0.412, 0.412, 0.05, 16, 1, true);
    for (const y of [0.2, 0.9]) {
      const band = new THREE.Mesh(bandGeo, this.mats.metal);
      band.position.set(x, y, z);
      this.group.add(band);
    }
    this.physics.addStaticCylinder(x, 0.55, z, 0.42, 1.1);
  }

  private candle(x: number, y: number, z: number): void {
    const h = 0.08 + Math.random() * 0.1;
    const wax = new THREE.Mesh(
      new THREE.CylinderGeometry(0.02, 0.024, h, 8),
      new THREE.MeshStandardMaterial({ color: 0xd8d0b8, roughness: 0.6, emissive: 0x3a2a14 }),
    );
    wax.position.set(x, y + h / 2, z);
    this.group.add(wax);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffb060 });
    const flame = new THREE.Mesh(new THREE.SphereGeometry(0.014, 8, 6), mat);
    flame.scale.set(1, 2, 1);
    const holder = new THREE.Group();
    holder.position.set(x, y + h + 0.02, z);
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
    // flames flicker through a dummy light entry so they share the bulb update
    const dummy = new THREE.PointLight(0, 0);
    this.bulbs.push({
      light: dummy, glow: mat, color: new THREE.Color(0xffb060), base: 0, seed: Math.random() * 100,
      kind: 'candle', surge: 0, flame: holder,
    });
  }

  /** Hanging lamp: cord, tin shade, glowing bulb and its light. */
  private lamp(x: number, z: number, intensity: number, color: number): void {
    const drop = 0.5;
    const top = WALL_HEIGHT;
    const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, drop, 5), this.mats.metal);
    cord.position.set(x, top - drop / 2, z);
    this.group.add(cord);
    const shade = new THREE.Mesh(
      new THREE.ConeGeometry(0.19, 0.13, 18, 1, true),
      new THREE.MeshStandardMaterial({ color: 0x2c2f2c, roughness: 0.6, metalness: 0.7, side: THREE.DoubleSide }),
    );
    shade.position.set(x, top - drop - 0.02, z);
    this.group.add(shade);
    this.point(x, top - drop - 0.11, z, intensity, color, 'bulb');
  }

  private point(x: number, y: number, z: number, intensity: number, color: number, kind: Bulb['kind']): void {
    const light = new THREE.PointLight(color, intensity, 11, 2);
    light.position.set(x, y, z);
    this.group.add(light);
    const glow = new THREE.MeshBasicMaterial({ color });
    if (kind !== 'candle') {
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 8), glow);
      mesh.position.copy(light.position);
      this.group.add(mesh);
    }
    this.bulbs.push({
      light, glow, color: new THREE.Color(color), base: intensity, seed: Math.random() * 100, kind, surge: 0,
    });
  }

  /**
   * Flat decal. On the floor, (a, b) = (x, z). On a wall, `on` is the direction the decal
   * faces, (a, b) = (x, z) of the wall surface and `y` its height.
   */
  private decal(mat: THREE.Material, a: number, b: number, size: number, on: 'floor' | Facing, y = 0): void {
    const floor = on === 'floor';
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(size, floor ? size : size * 0.25), mat);
    if (floor) {
      mesh.rotation.set(-Math.PI / 2, 0, Math.random() * Math.PI * 2, 'YXZ');
      mesh.position.set(a, 0.004, b);
    } else {
      mesh.rotation.y = FACING[on].theta;
      mesh.position.set(a, y, b);
    }
    mesh.receiveShadow = true;
    this.group.add(mesh);
  }
}
