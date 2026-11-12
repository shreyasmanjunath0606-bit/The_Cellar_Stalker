import * as THREE from 'three';
import { Physics, RAPIER } from '../core/Physics';
import { LevelConfig } from '../core/Levels';
import { Materials, scaleBoxUVs } from '../rendering/Materials';
import { ItemType } from '../player/Inventory';
import { FLOOR_H } from './HouseKit';

export type RouteId = 'door' | 'car' | 'balcony';
export type StepSfx = 'wood' | 'metal' | 'click' | 'engine' | 'pour' | 'winch';

export interface Step {
  /** Short name for the checklist. */
  label: string;
  /** What E does, e.g. "pry off the planks". */
  verb: string;
  needs: ItemType;
  count: number;
  /** How far the work carries, in metres. */
  noise: number;
  sfx: StepSfx;
  done: boolean;
}

/** Something to work on with the right tool: a door, the car, the winch… */
export interface Station {
  id: number;
  name: string;
  route: RouteId;
  /** Point to look at. */
  pos: THREE.Vector3;
  reach: number;
  steps: Step[];
}

export const ROUTE_NAMES: Record<RouteId, string> = {
  door: 'Front door',
  car: 'Garage',
  balcony: 'Balcony',
};

const FRONT = 0;
const CAR = 1;
const WINCH = 2;
const BALCONY_DOOR = 3;
const LADDER = 4;

const step = (label: string, verb: string, needs: ItemType, noise: number, sfx: StepSfx, count = 1): Step => ({
  label, verb, needs, count, noise, sfx, done: false,
});

/**
 * The three ways out of the house and the work each one takes:
 *   front door — pry the planks, cut the chain, turn every lock
 *   garage     — fit the battery, pour the fuel, winch the door open, start the car
 *   balcony    — unlock the balcony door, hang two ladder sections and lash them down
 */
export class Objectives {
  readonly group = new THREE.Group();
  readonly stations: Station[];
  /** A way out has just become usable. */
  onOpen: (route: RouteId) => void = () => {};

  private readonly colliders = new Map<number, RAPIER.Collider>();
  private readonly to = new THREE.Vector3();
  private readonly parts: Record<string, THREE.Object3D> = {};
  private readonly locks: THREE.Object3D[] = [];
  private readonly headlight = new THREE.MeshBasicMaterial({ color: 0x1a1a14 });
  private readonly car = new THREE.Group();
  private frontSwing = 0;
  private balconySwing = 0;
  private garageRise = 0;
  private engine = 0;

  constructor(
    private readonly physics: Physics,
    private readonly mats: Materials,
    cfg: LevelConfig,
  ) {
    const U = FLOOR_H;
    this.stations = [
      {
        id: FRONT, name: 'front door', route: 'door', pos: new THREE.Vector3(0, 1.2, 8.9), reach: 2.6,
        steps: [
          step('planks', 'pry off the planks', 'hammer', 16, 'wood'),
          step('chain', 'cut the chain', 'cutters', 11, 'metal'),
          step(`${cfg.keys} locks`, `turn all ${cfg.keys} locks`, 'key', 18, 'click', cfg.keys),
        ],
      },
      {
        id: CAR, name: 'car', route: 'car', pos: new THREE.Vector3(18.5, 0.9, 4.2), reach: 3.1,
        steps: [
          step('battery', 'fit the car battery', 'carbattery', 8, 'metal'),
          step('fuel', 'pour in the fuel', 'fuel', 6, 'pour'),
          step('engine', 'start the engine', 'carkey', 30, 'engine'),
        ],
      },
      {
        id: WINCH, name: 'garage door winch', route: 'car', pos: new THREE.Vector3(20.9, 1.25, 8.7), reach: 2.5,
        steps: [step('garage door', 'fit the crank and wind the door up', 'crank', 22, 'winch')],
      },
      {
        id: BALCONY_DOOR, name: 'balcony door', route: 'balcony', pos: new THREE.Vector3(9.5, U + 1.2, 8.9), reach: 2.6,
        steps: [step('balcony door', 'unlock the balcony door', 'balconykey', 7, 'click')],
      },
      {
        id: LADDER, name: 'balcony rail', route: 'balcony', pos: new THREE.Vector3(9.5, U + 0.95, 10.9), reach: 2.6,
        steps: [
          step('ladder', 'hang a ladder section over the rail', 'ladderA', 9, 'wood'),
          step('ladder', 'join the second ladder section', 'ladderB', 9, 'wood'),
          step('rope', 'lash the ladder to the rail', 'rope', 4, 'click'),
        ],
      },
    ];
    this.buildFrontDoor(cfg.keys);
    this.buildGarage();
    this.buildBalcony();
  }

  // ---- queries ------------------------------------------------------------

  /** The station the player is standing at and looking at, if any. */
  focus(origin: THREE.Vector3, dir: THREE.Vector3): Station | null {
    let best: Station | null = null;
    let bestD = Infinity;
    for (const s of this.stations) {
      const to = this.to.copy(s.pos).sub(origin);
      const dist = to.length();
      if (dist < s.reach && dist < bestD && to.divideScalar(dist).dot(dir) > 0.6) {
        best = s;
        bestD = dist;
      }
    }
    return best;
  }

  next(s: Station): { step: Step; index: number } | null {
    const index = s.steps.findIndex((st) => !st.done);
    return index < 0 ? null : { step: s.steps[index], index };
  }

  /** Why the next step cannot be done yet, tools aside. */
  blocked(s: Station): string | null {
    const n = this.next(s);
    if (s.id === CAR && n?.index === 2 && !this.done(WINCH)) return 'THE GARAGE DOOR IS STILL SHUT';
    return null;
  }

  private done(id: number): boolean {
    return this.stations[id].steps.every((s) => s.done);
  }

  routeOpen(route: RouteId): boolean {
    return this.stations.filter((s) => s.route === route).every((s) => this.done(s.id));
  }

  /** What E does at a finished station that is itself the way out. */
  exitVerb(s: Station): string | null {
    if (!this.routeOpen(s.route)) return null;
    if (s.id === CAR) return 'get in and drive away';
    if (s.id === LADDER) return 'climb down the ladder';
    return null;
  }

  /** True once a player has walked out through the open front door. */
  walkedOut(feet: THREE.Vector3): boolean {
    return this.frontSwing > 0.8 && feet.y < 1 && feet.z > 10.3 && Math.abs(feet.x) < 1.7;
  }

  /** The balcony has just become reachable on foot. */
  get balconyOpen(): boolean {
    return this.done(BALCONY_DOOR);
  }

  /** Checklist for the HUD: each route with its steps in order. */
  summary(): { route: RouteId; open: boolean; steps: { label: string; done: boolean }[] }[] {
    return (['door', 'car', 'balcony'] as RouteId[]).map((route) => ({
      route,
      open: this.routeOpen(route),
      steps: this.stations.filter((s) => s.route === route).flatMap((s) => s.steps.map((st) => ({ label: st.label, done: st.done }))),
    }));
  }

  // ---- changes ------------------------------------------------------------

  /** Marks a step done and updates the scenery. Returns false if it was not the next step. */
  complete(stationId: number, index: number): boolean {
    const s = this.stations[stationId];
    const n = s ? this.next(s) : null;
    if (!s || !n || n.index !== index) return false;
    n.step.done = true;
    const hide = (name: string): void => {
      if (this.parts[name]) this.parts[name].visible = false;
    };
    const show = (name: string): void => {
      if (this.parts[name]) this.parts[name].visible = true;
    };
    switch (stationId) {
      case FRONT:
        if (index === 0) hide('planks');
        else if (index === 1) hide('chain');
        else for (const l of this.locks) l.visible = false;
        break;
      case CAR:
        if (index === 0) show('carBattery');
        else if (index === 2) this.headlight.color.setHex(0xfff2c8).multiplyScalar(6);
        break;
      case WINCH:
        show('crank');
        break;
      case LADDER:
        show(index === 0 ? 'ladderA' : index === 1 ? 'ladderB' : 'rope');
        break;
    }
    if (this.routeOpen(s.route)) this.onOpen(s.route);
    return true;
  }

  update(dt: number, elapsed: number): void {
    if (this.done(FRONT) && this.frontSwing < 1) {
      this.frontSwing = Math.min(1, this.frontSwing + dt / 2.2);
      this.parts.frontDoor.rotation.y = -1.75 * this.frontSwing * this.frontSwing;
      if (this.frontSwing > 0.3) this.removeCollider(FRONT);
    }
    if (this.done(BALCONY_DOOR) && this.balconySwing < 1) {
      this.balconySwing = Math.min(1, this.balconySwing + dt / 1.6);
      this.parts.balconyDoor.rotation.y = -1.7 * this.balconySwing;
      if (this.balconySwing > 0.3) this.removeCollider(BALCONY_DOOR);
    }
    if (this.done(WINCH) && this.garageRise < 1) {
      this.garageRise = Math.min(1, this.garageRise + dt / 5);
      this.parts.garageDoor.position.y = 1.05 + this.garageRise * 2.05;
      this.parts.crank.rotation.z = elapsed * 9;
      if (this.garageRise > 0.85) this.removeCollider(WINCH);
    }
    if (this.done(CAR)) {
      this.engine += dt;
      this.car.position.y = Math.sin(this.engine * 46) * 0.004;
    }
  }

  private removeCollider(id: number): void {
    const c = this.colliders.get(id);
    if (!c) return;
    this.physics.world.removeCollider(c, true);
    this.colliders.delete(id);
  }

  // ---- scenery ------------------------------------------------------------

  private mesh(
    geo: THREE.BufferGeometry, mat: THREE.Material, parent: THREE.Object3D, x = 0, y = 0, z = 0,
  ): THREE.Mesh {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = m.receiveShadow = true;
    parent.add(m);
    return m;
  }

  private box(
    w: number, h: number, d: number, mat: THREE.Material, parent: THREE.Object3D, x = 0, y = 0, z = 0,
  ): THREE.Mesh {
    const geo = new THREE.BoxGeometry(w, h, d);
    scaleBoxUVs(geo, w, h, d);
    return this.mesh(geo, mat, parent, x, y, z);
  }

  /** A panelled door hung on a pivot at its left edge. */
  private door(name: string, x0: number, y: number, z: number, w: number, glazed: boolean): THREE.Group {
    const { trim, metal, moonGlass, crate } = this.mats;
    const pivot = new THREE.Group();
    pivot.position.set(x0, y, z);
    this.box(w, 2.1, 0.09, trim, pivot, w / 2, 1.05, 0);
    for (const [py, ph] of [[0.55, 0.8], [1.5, 0.8]]) {
      for (const sx of [0.27, 0.73]) {
        const mat = glazed && py > 1 ? moonGlass : crate;
        this.box(w * 0.36, ph, 0.11, mat, pivot, w * sx, py, 0).castShadow = !(glazed && py > 1);
      }
    }
    this.mesh(new THREE.SphereGeometry(0.04, 10, 8), metal, pivot, w - 0.12, 1.02, -0.08);
    this.group.add(pivot);
    this.parts[name] = pivot;
    return pivot;
  }

  private buildFrontDoor(keys: number): void {
    const { crate, metal } = this.mats;
    const brass = new THREE.MeshStandardMaterial({ color: 0xd8b04a, metalness: 0.9, roughness: 0.35, emissive: 0x3a2806 });
    const pivot = this.door('frontDoor', -0.8, 0, 9, 1.6, false);
    for (let i = 0; i < keys; i++) {
      const lock = new THREE.Group();
      this.box(0.11, 0.11, 0.05, brass, lock);
      this.box(0.02, 0.05, 0.06, this.mats.black, lock, 0, -0.005, 0);
      lock.position.set(1.36, 0.72 + i * 0.2, -0.08);
      pivot.add(lock);
      this.locks.push(lock);
    }
    const planks = new THREE.Group();
    for (const [y, tilt] of [[0.5, 0.09], [1.12, -0.12], [1.72, 0.06]]) {
      const p = this.box(2.2, 0.18, 0.05, crate, planks, 0, y, 8.82);
      p.rotation.z = tilt;
    }
    this.group.add(planks);
    this.parts.planks = planks;
    const chain = new THREE.Group();
    for (let i = 0; i < 12; i++) {
      const link = this.mesh(new THREE.TorusGeometry(0.035, 0.011, 6, 10), metal, chain, -0.82 + i * 0.15, 0.98 + Math.sin(i * 0.55) * 0.09, 8.78);
      link.rotation.y = i % 2 ? Math.PI / 2 : 0;
    }
    this.box(0.12, 0.14, 0.05, metal, chain, 0.05, 0.84, 8.77);
    this.group.add(chain);
    this.parts.chain = chain;
    this.colliders.set(FRONT, this.physics.addStaticBox(0, 1.05, 9, 1.6, 2.1, 0.2));
  }

  private buildGarage(): void {
    const { metal, black, carPaint, crate, wood } = this.mats;
    // roller door
    const door = new THREE.Group();
    this.box(3.6, 2.1, 0.08, metal, door);
    for (let i = 0; i < 7; i++) this.box(3.6, 0.03, 0.1, black, door, 0, -0.9 + i * 0.3, 0);
    door.position.set(18, 1.05, 9);
    this.group.add(door);
    this.parts.garageDoor = door;
    this.colliders.set(WINCH, this.physics.addStaticBox(18, 1.05, 9, 3.6, 2.1, 0.2));

    // winch on the wall beside it
    const winch = new THREE.Group();
    winch.position.set(20.9, 1.25, 8.72);
    this.box(0.36, 0.44, 0.16, metal, winch);
    const drum = this.mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.1, 14), black, winch, 0, 0, -0.12);
    drum.rotation.x = Math.PI / 2;
    const crank = new THREE.Group();
    crank.position.set(0, 0, -0.19);
    this.box(0.04, 0.26, 0.03, metal, crank, 0, 0.11, 0);
    this.box(0.05, 0.05, 0.14, wood, crank, 0, 0.24, -0.07);
    crank.visible = false;
    winch.add(crank);
    this.group.add(winch);
    this.parts.crank = crank;

    // the car, nose toward the door
    const car = this.car;
    const root = new THREE.Group();
    root.position.set(18.5, 0, 4.2);
    root.add(car);
    this.box(1.8, 0.52, 4.2, carPaint, car, 0, 0.6, 0);
    this.box(1.62, 0.5, 2.0, carPaint, car, 0, 1.1, -0.35);
    this.box(1.64, 0.36, 1.6, black, car, 0, 1.1, -0.35);
    this.box(1.5, 0.34, 2.02, black, car, 0, 1.1, -0.35);
    this.box(1.84, 0.14, 0.14, metal, car, 0, 0.42, 2.12);
    this.box(1.84, 0.14, 0.14, metal, car, 0, 0.42, -2.12);
    this.box(0.9, 0.2, 0.05, black, car, 0, 0.62, 2.11);
    for (const sx of [-1, 1]) {
      this.mesh(new THREE.SphereGeometry(0.1, 12, 8), this.headlight, car, sx * 0.62, 0.68, 2.08).castShadow = false;
      for (const sz of [-1, 1]) {
        const wheel = this.mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.22, 16), black, car, sx * 0.86, 0.34, sz * 1.35);
        wheel.rotation.z = Math.PI / 2;
        const hub = this.mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.24, 10), metal, car, sx * 0.86, 0.34, sz * 1.35);
        hub.rotation.z = Math.PI / 2;
      }
    }
    // the battery sits on the wing until someone bothers to bolt it in
    const battery = new THREE.Group();
    this.box(0.32, 0.2, 0.2, black, battery);
    this.box(0.06, 0.05, 0.06, crate, battery, -0.1, 0.12, 0);
    battery.position.set(0, 0.97, 1.5);
    battery.visible = false;
    car.add(battery);
    this.parts.carBattery = battery;
    this.group.add(root);
    this.physics.addStaticBox(18.5, 0.75, 4.2, 1.8, 1.5, 4.2);
  }

  private buildBalcony(): void {
    const { wood } = this.mats;
    const U = FLOOR_H;
    this.door('balconyDoor', 8.8, U, 9, 1.4, true);
    this.colliders.set(BALCONY_DOOR, this.physics.addStaticBox(9.5, U + 1.05, 9, 1.4, 2.1, 0.2));

    const ladder = (name: string, top: number, bottom: number): void => {
      const g = new THREE.Group();
      const len = top - bottom;
      for (const sx of [-1, 1]) this.box(0.05, len, 0.05, wood, g, sx * 0.21, 0, 0);
      for (let y = -len / 2 + 0.15; y < len / 2; y += 0.3) {
        const rung = this.mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.42, 8), wood, g, 0, y, 0);
        rung.rotation.z = Math.PI / 2;
      }
      g.position.set(9.5, (top + bottom) / 2, 11.08);
      g.visible = false;
      this.group.add(g);
      this.parts[name] = g;
    };
    ladder('ladderA', U + 1.15, U - 1.2);
    ladder('ladderB', U - 1.2, 0.1);
    const rope = new THREE.Group();
    const cord = new THREE.MeshStandardMaterial({ color: 0xb89a62, roughness: 0.9 });
    for (const sx of [-1, 1]) {
      const loop = this.mesh(new THREE.TorusGeometry(0.07, 0.018, 6, 14), cord, rope, 9.5 + sx * 0.21, U + 0.98, 10.98);
      loop.rotation.y = Math.PI / 2;
    }
    rope.visible = false;
    this.group.add(rope);
    this.parts.rope = rope;
  }
}
