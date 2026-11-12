import * as THREE from 'three';
import { Physics, RAPIER } from '../core/Physics';
import { FLOOR_H } from '../environment/HouseKit';
import { Point } from '../environment/Layout';

export interface WaypointNode {
  id: number;
  /** y is the floor height of the node's level. */
  pos: THREE.Vector3;
  links: number[];
}

const LINK_RANGE = 11;
const CLEARANCE = 0.35;
const STATIC_ONLY = RAPIER.QueryFilterFlags.EXCLUDE_DYNAMIC | RAPIER.QueryFilterFlags.EXCLUDE_KINEMATIC;

const sameFloor = (a: THREE.Vector3, b: THREE.Vector3): boolean => Math.abs(a.y - b.y) < 0.7;

/**
 * Visibility graph over fixed waypoints on two floors. Links on a floor are validated against
 * static geometry; the floors are joined by explicit stair links.
 */
export class WaypointGraph {
  readonly nodes: WaypointNode[];
  /** Node ids of each flight: [bottom, top]. */
  private readonly flights: [number, number][] = [];

  constructor(private readonly physics: Physics, points: Point[], stairs: [Point, Point][]) {
    const node = ([x, z, level]: Point, id: number): WaypointNode => ({
      id, pos: new THREE.Vector3(x, level * FLOOR_H, z), links: [],
    });
    this.nodes = points.map(node);
    for (const a of this.nodes) {
      for (const b of this.nodes) {
        if (a.id >= b.id || !sameFloor(a.pos, b.pos) || a.pos.distanceTo(b.pos) > LINK_RANGE) continue;
        if (this.clearLine(a.pos, b.pos)) this.join(a.id, b.id);
      }
    }
    for (const [bottom, top] of stairs) {
      const b = node(bottom, this.nodes.length);
      this.nodes.push(b);
      const t = node(top, this.nodes.length);
      this.nodes.push(t);
      this.join(b.id, t.id);
      // each end joins whatever it can see on its own floor
      for (const end of [b, t]) {
        for (const n of this.nodes) {
          if (n === b || n === t || !sameFloor(n.pos, end.pos) || n.pos.distanceTo(end.pos) > LINK_RANGE) continue;
          if (this.clearLine(n.pos, end.pos)) this.join(n.id, end.id);
        }
      }
      this.flights.push([b.id, t.id]);
    }
  }

  private join(a: number, b: number): void {
    if (!this.nodes[a].links.includes(b)) this.nodes[a].links.push(b);
    if (!this.nodes[b].links.includes(a)) this.nodes[b].links.push(a);
  }

  /** Joins the nodes nearest two points, for a way that opens during play (the balcony door). */
  addLink(a: THREE.Vector3, b: THREE.Vector3): void {
    this.join(this.nearestNode(a), this.nearestNode(b));
  }

  /** True while `y` (feet height) is part-way up a flight of stairs. */
  onStairs(y: number): boolean {
    const r = y / FLOOR_H;
    return Math.abs(r - Math.round(r)) * FLOOR_H > 0.45;
  }

  /** True if a stalker-wide corridor between two points on the same floor is free of static geometry. */
  clearLine(a: THREE.Vector3, b: THREE.Vector3): boolean {
    if (!sameFloor(a, b)) return false;
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len = Math.hypot(dx, dz);
    if (len < 0.01) return true;
    const dir = { x: dx / len, y: 0, z: dz / len };
    const y = Math.max(a.y, b.y) + 0.5;
    for (const off of [0, CLEARANCE, -CLEARANCE]) {
      const origin = { x: a.x - dir.z * off, y, z: a.z + dir.x * off };
      const hit = this.physics.world.castRay(new RAPIER.Ray(origin, dir), len, true, STATIC_ONLY);
      if (hit) return false;
    }
    return true;
  }

  /** Ids of nodes that cannot be reached from node 0 (should be empty). */
  unreachable(): number[] {
    const seen = new Set<number>([0]);
    const queue = [0];
    while (queue.length) {
      for (const nb of this.nodes[queue.pop()!].links) {
        if (!seen.has(nb)) {
          seen.add(nb);
          queue.push(nb);
        }
      }
    }
    return this.nodes.filter((n) => !seen.has(n.id)).map((n) => n.id);
  }

  nearestNode(p: THREE.Vector3, requireVisible = false): number {
    let best = -1;
    let bestD = Infinity;
    for (const n of this.nodes) {
      // a node on the other floor is "near" only as a last resort
      const d = n.pos.distanceTo(p) + (sameFloor(n.pos, p) ? 0 : 100);
      if (d < bestD && (!requireVisible || this.clearLine(p, n.pos))) {
        best = n.id;
        bestD = d;
      }
    }
    return best >= 0 ? best : this.nearestNode(p, false);
  }

  randomNode(exclude = -1): number {
    let id: number;
    do id = Math.floor(Math.random() * this.nodes.length);
    while ((id === exclude || this.nodes[id].links.length === 0) && this.nodes.length > 1);
    return id;
  }

  /** The node whose nearest point in `from` is as far away as possible. */
  farthestNode(...from: THREE.Vector3[]): number {
    let best = 0;
    let bestD = -1;
    for (const n of this.nodes) {
      if (n.links.length === 0) continue;
      const d = Math.min(...from.map((f) => n.pos.distanceTo(f)));
      if (d > bestD) {
        best = n.id;
        bestD = d;
      }
    }
    return best;
  }

  /** Waypoints to walk through to reach `to` (excludes `from`, includes `to`). Positions are feet height. */
  findPath(from: THREE.Vector3, to: THREE.Vector3): THREE.Vector3[] {
    if (this.clearLine(from, to) && !this.onStairs(from.y) && !this.onStairs(to.y)) return [to.clone()];

    const goal = this.onStairs(to.y) ? this.flightEnd(to, to) : this.nearestNode(to, true);
    let ids: number[];
    if (this.onStairs(from.y)) {
      // part-way up a flight: carry on to whichever end is the shorter way round
      const [b, t] = this.nearestFlight(from);
      const viaB = this.astar(b, goal);
      const viaT = this.astar(t, goal);
      const costB = viaB.cost + this.nodes[b].pos.distanceTo(from);
      const costT = viaT.cost + this.nodes[t].pos.distanceTo(from);
      ids = costB <= costT ? viaB.ids : viaT.ids;
    } else {
      ids = this.astar(this.nearestNode(from, true), goal).ids;
      // Don't double back to a node when the one after it is already in plain sight
      // (repathing mid-corridor would otherwise make her turn around forever).
      // The same goes for the first steps of a flight of stairs, where she still counts as "on the floor".
      while (ids.length > 1 && (this.clearLine(from, this.nodes[ids[1]].pos) || this.onFlight(from, ids[0], ids[1]))) {
        ids.shift();
      }
    }
    while (ids.length > 1 && this.clearLine(this.nodes[ids[ids.length - 2]].pos, to)) ids.pop();
    return [...ids.map((i) => this.nodes[i].pos.clone()), to.clone()];
  }

  /** True if nodes `a` and `b` are the two ends of a flight and `p` is already somewhere along it. */
  private onFlight(p: THREE.Vector3, a: number, b: number): boolean {
    if (!this.flights.some((f) => (f[0] === a && f[1] === b) || (f[0] === b && f[1] === a))) return false;
    const pa = this.nodes[a].pos;
    const pb = this.nodes[b].pos;
    const dx = pb.x - pa.x;
    const dz = pb.z - pa.z;
    const len2 = dx * dx + dz * dz;
    const u = ((p.x - pa.x) * dx + (p.z - pa.z) * dz) / len2;
    const side = Math.abs((p.x - pa.x) * dz - (p.z - pa.z) * dx) / Math.sqrt(len2);
    return u > 0 && u < 1 && side < 0.9;
  }

  private nearestFlight(p: THREE.Vector3): [number, number] {
    let best = this.flights[0];
    let bestD = Infinity;
    for (const f of this.flights) {
      const d = this.nodes[f[0]].pos.distanceTo(p) + this.nodes[f[1]].pos.distanceTo(p);
      if (d < bestD) {
        best = f;
        bestD = d;
      }
    }
    return best;
  }

  /** The end of the flight `p` is on that is nearer to `toward`. */
  private flightEnd(p: THREE.Vector3, toward: THREE.Vector3): number {
    const [b, t] = this.nearestFlight(p);
    return this.nodes[b].pos.distanceTo(toward) < this.nodes[t].pos.distanceTo(toward) ? b : t;
  }

  private astar(start: number, goal: number): { ids: number[]; cost: number } {
    const g = new Map<number, number>([[start, 0]]);
    const prev = new Map<number, number>();
    const open = new Set<number>([start]);
    const h = (i: number): number => this.nodes[i].pos.distanceTo(this.nodes[goal].pos);
    while (open.size) {
      let cur = -1;
      let curF = Infinity;
      for (const i of open) {
        const f = g.get(i)! + h(i);
        if (f < curF) {
          cur = i;
          curF = f;
        }
      }
      if (cur === goal) {
        const path = [cur];
        while (prev.has(path[0])) path.unshift(prev.get(path[0])!);
        return { ids: path, cost: g.get(cur)! };
      }
      open.delete(cur);
      for (const nb of this.nodes[cur].links) {
        const ng = g.get(cur)! + this.nodes[cur].pos.distanceTo(this.nodes[nb].pos);
        if (ng < (g.get(nb) ?? Infinity)) {
          g.set(nb, ng);
          prev.set(nb, cur);
          open.add(nb);
        }
      }
    }
    return { ids: [start], cost: 1e6 }; // disconnected graph: head for the nearest node and hope
  }
}
