import * as THREE from 'three';
import { Physics, RAPIER } from '../core/Physics';
import { AreaId } from '../core/Levels';

export interface WaypointNode {
  id: number;
  pos: THREE.Vector3;
  links: number[];
}

/** Floor-plan points (x, z) the stalker patrols between, per area. Kept clear of props and pillars. */
const AREA_WAYPOINTS: Record<AreaId, [number, number][]> = {
  hall: [
    [0, 0], [-4.5, 3.8], [4.5, 3.5], [-4.5, -1.8], [4.5, -3], [0, 3.6],
    [0, -3.4], [4.6, 0], [-4.6, 0], // hall-side approaches to the doorways
  ],
  east: [[6, 0], [9.5, 0], [9.5, -2.8], [11.5, 2.8]],
  north: [[0, -5], [0, -8.5], [-3, -10.8], [3, -8.8], [-2.6, -8.5]],
  west: [[-6, 0], [-9.5, 0], [-9.5, 3], [-11.5, -2.2], [-9.5, -3.6]],
  crypt: [[-9.5, -5], [-9.5, -6.4], [-11.3, -9.6], [-7, -10.2], [-5.6, -8.5], [-4, -8.5]],
};

export function waypointsFor(areas: AreaId[]): [number, number][] {
  return areas.flatMap((a) => AREA_WAYPOINTS[a]);
}

const LINK_RANGE = 11;
const CLEARANCE = 0.35;
const STATIC_ONLY = RAPIER.QueryFilterFlags.EXCLUDE_DYNAMIC | RAPIER.QueryFilterFlags.EXCLUDE_KINEMATIC;

/** Visibility graph over fixed waypoints; links are validated against static geometry. */
export class WaypointGraph {
  readonly nodes: WaypointNode[];

  constructor(private readonly physics: Physics, points: [number, number][]) {
    this.nodes = points.map(([x, z], id) => ({ id, pos: new THREE.Vector3(x, 0, z), links: [] }));
    for (const a of this.nodes) {
      for (const b of this.nodes) {
        if (a.id >= b.id || a.pos.distanceTo(b.pos) > LINK_RANGE) continue;
        if (this.clearLine(a.pos, b.pos)) {
          a.links.push(b.id);
          b.links.push(a.id);
        }
      }
    }
  }

  /** True if a stalker-wide corridor between the points is free of static geometry. */
  clearLine(a: THREE.Vector3, b: THREE.Vector3): boolean {
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len = Math.hypot(dx, dz);
    if (len < 0.01) return true;
    const dir = { x: dx / len, y: 0, z: dz / len };
    for (const off of [0, CLEARANCE, -CLEARANCE]) {
      const origin = { x: a.x - dir.z * off, y: 0.5, z: a.z + dir.x * off };
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
      const d = n.pos.distanceTo(p);
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
    while (id === exclude && this.nodes.length > 1);
    return id;
  }

  /** The node whose nearest point in `from` is as far away as possible. */
  farthestNode(...from: THREE.Vector3[]): number {
    let best = 0;
    let bestD = -1;
    for (const n of this.nodes) {
      const d = Math.min(...from.map((f) => n.pos.distanceTo(f)));
      if (d > bestD) {
        best = n.id;
        bestD = d;
      }
    }
    return best;
  }

  /** Waypoints to walk through to reach `to` (excludes `from`, includes `to`). */
  findPath(from: THREE.Vector3, to: THREE.Vector3): THREE.Vector3[] {
    if (this.clearLine(from, to)) return [to.clone()];
    const start = this.nearestNode(from, true);
    const goal = this.nearestNode(to, true);
    const ids = this.astar(start, goal);
    // Trim both ends: don't double back to a node when the one after it is already in
    // plain sight (repathing mid-corridor would otherwise make her turn around forever).
    while (ids.length > 1 && this.clearLine(from, this.nodes[ids[1]].pos)) ids.shift();
    while (ids.length > 1 && this.clearLine(this.nodes[ids[ids.length - 2]].pos, to)) ids.pop();
    return [...ids.map((i) => this.nodes[i].pos.clone()), to.clone()];
  }

  private astar(start: number, goal: number): number[] {
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
        return path;
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
    return [start]; // disconnected graph: head for the nearest node and hope
  }
}
