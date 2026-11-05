import * as THREE from 'three';

export type PickupType = 'key' | 'battery';

export interface Pickup {
  type: PickupType;
  mesh: THREE.Mesh;
  collected: boolean;
}

const REACH = 2.2;

/** Hidden keys and spare batteries. */
export class Pickups {
  readonly group = new THREE.Group();
  private readonly items: Pickup[] = [];

  constructor() {
    const brass = new THREE.MeshStandardMaterial({
      color: 0xd8b04a, metalness: 0.9, roughness: 0.3, emissive: 0x3a2a08,
    });
    const cell = new THREE.MeshStandardMaterial({
      color: 0x4a8f4a, metalness: 0.3, roughness: 0.4, emissive: 0x0a2a0a,
    });
    const keyGeo = new THREE.TorusGeometry(0.06, 0.018, 8, 16);
    const batGeo = new THREE.CylinderGeometry(0.045, 0.045, 0.14, 12);

    // keys: east room behind the crates, north room corner, hall corner
    this.add('key', keyGeo, brass, 12.3, 0.9, 3.3);
    this.add('key', keyGeo, brass, -3.5, 0.15, -11.4);
    this.add('key', keyGeo, brass, -5.4, 0.15, 4.4);
    // batteries
    this.add('battery', batGeo, cell, 7.5, 0.1, 3.4);
    this.add('battery', batGeo, cell, 3.4, 0.1, -6.2);
  }

  private add(type: PickupType, geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number): void {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    if (type === 'battery') mesh.rotation.z = Math.PI / 2;
    this.group.add(mesh);
    this.items.push({ type, mesh, collected: false });
  }

  update(elapsed: number): void {
    for (const it of this.items) {
      if (!it.collected && it.type === 'key') it.mesh.rotation.y = elapsed * 1.5;
    }
  }

  /** Item the player is close to and looking at, if any. */
  focus(origin: THREE.Vector3, dir: THREE.Vector3): Pickup | null {
    let best: Pickup | null = null;
    let bestScore = 0.92;
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
