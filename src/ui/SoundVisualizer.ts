import * as THREE from 'three';
import { SoundBus } from '../ai/SoundBus';

const LIFETIME = 0.9;

interface Ring {
  mesh: THREE.Mesh;
  age: number;
  radius: number;
}

/** Debug overlay (toggle with `): expanding wireframe spheres showing each sound's reach. */
export class SoundVisualizer {
  enabled = false;
  private readonly group = new THREE.Group();
  private readonly rings: Ring[] = [];
  private readonly geo = new THREE.SphereGeometry(1, 16, 10);

  constructor(scene: THREE.Object3D, bus: SoundBus) {
    scene.add(this.group);
    bus.subscribe((e) => {
      if (!this.enabled) return;
      const mat = new THREE.MeshBasicMaterial({
        color: e.source === 'footstep' ? 0x44aaff : 0xff5533,
        wireframe: true,
        transparent: true,
        fog: false,
      });
      const mesh = new THREE.Mesh(this.geo, mat);
      mesh.position.copy(e.position);
      this.group.add(mesh);
      this.rings.push({ mesh, age: 0, radius: e.radius });
    });
  }

  update(dt: number): void {
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.age += dt;
      const k = r.age / LIFETIME;
      if (k >= 1) {
        this.group.remove(r.mesh);
        (r.mesh.material as THREE.Material).dispose();
        this.rings.splice(i, 1);
        continue;
      }
      r.mesh.scale.setScalar(Math.max(0.01, r.radius * Math.sqrt(k)));
      (r.mesh.material as THREE.MeshBasicMaterial).opacity = 0.5 * (1 - k);
    }
  }
}
