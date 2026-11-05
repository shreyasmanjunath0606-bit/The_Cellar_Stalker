import * as THREE from 'three';
import { Physics, RAPIER } from '../core/Physics';
import { Materials, scaleBoxUVs } from '../rendering/Materials';

export const WALL_HEIGHT = 2.8;
const DOOR_HEIGHT = 2.1;
const T = 0.3; // wall thickness

interface Bulb {
  light: THREE.PointLight;
  base: number;
  seed: number;
}

interface BoxOpts {
  collide?: boolean;
  cast?: boolean;
}

/**
 * Procedural claustrophobic cellar: a central hall with the locked escape
 * door to the south, an east storeroom and a north corridor-room.
 *
 *        z-
 *   [ north room ]
 *   [   hall     ][ east room ]
 *   ====escape door====
 *        z+
 */
export class House {
  readonly group = new THREE.Group();
  readonly spawn = new THREE.Vector3(0, 0.85, 3.2);
  escapeDoor!: THREE.Mesh;

  private doorCollider: RAPIER.Collider | null = null;
  private doorOpening = false;
  private doorProgress = 0;

  private readonly bulbs: Bulb[] = [];

  constructor(
    private readonly physics: Physics,
    private readonly mats: Materials,
  ) {
    this.build();
  }

  /** True while the player is close to and facing the locked door. */
  canInteractDoor(origin: THREE.Vector3, dir: THREE.Vector3): boolean {
    if (this.doorOpening) return false;
    const to = new THREE.Vector3(0, DOOR_HEIGHT / 2, 5).sub(origin);
    const dist = to.length();
    return dist < 2.8 && to.divideScalar(dist).dot(dir) > 0.8;
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
      const n =
        0.88 +
        0.08 * Math.sin(elapsed * 7.1 + b.seed) * Math.sin(elapsed * 2.3 + b.seed * 2) +
        (Math.sin(elapsed * 0.7 + b.seed * 5) > 0.97 ? -0.5 : 0);
      b.light.intensity = b.base * n;
    }
  }

  private build(): void {
    const { concrete, wood } = this.mats;
    const H = WALL_HEIGHT;

    // floors & ceilings
    this.slab(0, 0, 12.3, 10.3, wood);
    this.slab(9.5, 0, 7.3, 8.3, concrete);
    this.slab(0, -8.5, 8.3, 7.3, concrete);

    // hall walls
    this.wall('x', 5, -6.15, 6.15, [[-1.25, 1.25]]); // south: escape door
    this.wall('z', -6, -5.15, 5.15);
    this.wall('z', 6, -5.15, 5.15, [[-1, 1]]); // east doorway
    this.wall('x', -5, -6.15, 6.15, [[-1, 1]]); // north doorway
    // east room
    this.wall('x', -4, 6, 13.15);
    this.wall('x', 4, 6, 13.15);
    this.wall('z', 13, -4.15, 4.15);
    // north room
    this.wall('z', -4, -12.15, -5);
    this.wall('z', 4, -12.15, -5);
    this.wall('x', -12, -4.15, 4.15);

    // escape door (unlocked later by the objective system)
    this.escapeDoor = this.box(0, DOOR_HEIGHT / 2, 5, 2.5, DOOR_HEIGHT, 0.15, this.mats.metal, { collide: false });
    this.doorCollider = this.physics.addStaticBox(0, DOOR_HEIGHT / 2, 5, 2.5, DOOR_HEIGHT, 0.15);

    // exit corridor behind the door
    this.slab(0, 7, 2.8, 4.3, concrete);
    this.wall('z', -1.4, 5.15, 9.15);
    this.wall('z', 1.4, 5.15, 9.15);
    this.wall('x', 9, -1.4, 1.4);
    const exitGlow = new THREE.Mesh(
      new THREE.PlaneGeometry(2.2, 2.4),
      new THREE.MeshBasicMaterial({ color: 0xdfe9ff, fog: false }),
    );
    exitGlow.position.set(0, 1.3, 8.84);
    exitGlow.rotation.y = Math.PI; // face the player coming from the hall
    this.group.add(exitGlow);
    this.bulb(0, H - 0.35, 7, 6, 0xaac8ff);

    // pillars
    for (const [x, z] of [[-3, -2], [3, -2], [-3, 2.5], [3, 2.5]]) {
      this.box(x, H / 2, z, 0.6, H, 0.6, concrete);
    }

    // overhead pipes
    const pipeGeo = new THREE.CylinderGeometry(0.08, 0.08, 12, 12);
    pipeGeo.rotateZ(Math.PI / 2);
    for (const z of [-4.6, -4.35]) {
      const pipe = new THREE.Mesh(pipeGeo, this.mats.metal);
      pipe.position.set(0, H - 0.2, z);
      pipe.castShadow = true;
      this.group.add(pipe);
    }

    // crates & clutter
    this.box(11.6, 0.45, -2.7, 0.9, 0.9, 0.9, this.mats.crate);
    this.box(11.7, 0.45, -1.7, 0.9, 0.9, 0.9, this.mats.crate);
    this.box(11.65, 1.35, -2.4, 0.8, 0.9, 0.8, this.mats.crate);
    this.box(8.5, 0.3, 3.2, 1.4, 0.6, 0.8, this.mats.crate);
    this.box(-4.8, 0.45, -3.6, 1.0, 0.9, 1.0, this.mats.crate);
    this.box(2.6, 0.4, -10.8, 1.6, 0.8, 0.9, this.mats.crate);

    // bulbs: hall, east room, north room
    this.bulb(0, H - 0.35, 0, 7, 0xffa860);
    this.bulb(9.5, H - 0.35, 0, 4, 0xff9a50);
    this.bulb(0, H - 0.35, -8.5, 3.5, 0xe8a870);
  }

  private slab(cx: number, cz: number, w: number, d: number, floorMat: THREE.Material): void {
    this.box(cx, -0.1, cz, w, 0.2, d, floorMat, { cast: false });
    this.box(cx, WALL_HEIGHT + 0.1, cz, w, 0.2, d, this.mats.wall, { cast: false });
  }

  /** Wall along an axis at a fixed coordinate, with optional door gaps [from, to]. */
  private wall(axis: 'x' | 'z', fixed: number, a0: number, a1: number, gaps: [number, number][] = []): void {
    const H = WALL_HEIGHT;
    const seg = (s0: number, s1: number, y0: number, y1: number): void => {
      const len = s1 - s0;
      const mid = (s0 + s1) / 2;
      const h = y1 - y0;
      const cy = (y0 + y1) / 2;
      if (axis === 'x') this.box(mid, cy, fixed, len, h, T, this.mats.wall);
      else this.box(fixed, cy, mid, T, h, len, this.mats.wall);
    };
    let cur = a0;
    for (const [g0, g1] of [...gaps].sort((a, b) => a[0] - b[0])) {
      if (g0 > cur) seg(cur, g0, 0, H);
      seg(g0, g1, DOOR_HEIGHT, H); // lintel
      cur = g1;
    }
    if (a1 > cur) seg(cur, a1, 0, H);
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

  private bulb(x: number, y: number, z: number, intensity: number, color: number): void {
    const light = new THREE.PointLight(color, intensity, 10, 2);
    light.position.set(x, y, z);
    this.group.add(light);
    const glow = new THREE.Mesh(new THREE.SphereGeometry(0.07, 12, 8), new THREE.MeshBasicMaterial({ color }));
    glow.position.copy(light.position);
    this.group.add(glow);
    this.bulbs.push({ light, base: intensity, seed: Math.random() * 100 });
  }
}
