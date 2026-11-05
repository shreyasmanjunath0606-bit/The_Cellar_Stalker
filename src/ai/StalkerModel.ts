import * as THREE from 'three';

export interface PoseInput {
  x: number;
  z: number;
  yaw: number;
  speed: number;
  /** Arms reach forward (chase / attack). */
  reaching: boolean;
  /** World point the head should track, or null to idly look around. */
  lookAt: THREE.Vector3 | null;
}

const wrapPi = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));
const damp = (k: number, dt: number): number => 1 - Math.exp(-k * dt);

/**
 * Hunched, long-armed figure built from primitives and animated procedurally:
 * walk cycle, torso bob/sway, head tracking and arm reach. The model faces +Z.
 */
export class StalkerModel {
  readonly root = new THREE.Group();
  readonly head = new THREE.Group();
  onStep: () => void = () => {};

  private readonly hips = new THREE.Group();
  private readonly torso = new THREE.Group();
  private readonly legL = new THREE.Group();
  private readonly legR = new THREE.Group();
  private readonly armL = new THREE.Group();
  private readonly armR = new THREE.Group();
  private readonly foreL = new THREE.Group();
  private readonly foreR = new THREE.Group();
  private phase = 0;
  private steps = 0;
  private t = Math.random() * 10;

  constructor() {
    const skin = new THREE.MeshStandardMaterial({ color: 0x5d655b, roughness: 0.9, emissive: 0x050605 });
    const dress = new THREE.MeshStandardMaterial({ color: 0x2a1a1a, roughness: 1, side: THREE.DoubleSide });
    const hair = new THREE.MeshStandardMaterial({ color: 0x8d8b84, roughness: 1 });
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0xffd890 });
    const voidMat = new THREE.MeshBasicMaterial({ color: 0x030202 });
    const teethMat = new THREE.MeshStandardMaterial({ color: 0xcfc8a8, roughness: 0.6 });

    const mesh = (geo: THREE.BufferGeometry, mat: THREE.Material, parent: THREE.Object3D): THREE.Mesh => {
      const m = new THREE.Mesh(geo, mat);
      m.castShadow = true;
      parent.add(m);
      return m;
    };
    /** Cylinder hanging down from its pivot. */
    const limb = (rt: number, rb: number, len: number, mat: THREE.Material, parent: THREE.Object3D): void => {
      const geo = new THREE.CylinderGeometry(rt, rb, len, 8);
      geo.translate(0, -len / 2, 0);
      mesh(geo, mat, parent);
    };

    this.hips.position.y = 0.95;
    this.root.add(this.hips);

    for (const [leg, x] of [[this.legL, -0.1], [this.legR, 0.1]] as const) {
      leg.position.x = x;
      limb(0.07, 0.045, 0.95, skin, leg);
      this.hips.add(leg);
    }
    const skirt = mesh(new THREE.CylinderGeometry(0.2, 0.34, 0.75, 14, 1, true), dress, this.hips);
    skirt.position.y = -0.3;

    this.hips.add(this.torso);
    const chest = mesh(new THREE.CylinderGeometry(0.2, 0.25, 0.7, 12), dress, this.torso);
    chest.position.y = 0.35;

    for (const [arm, fore, x] of [[this.armL, this.foreL, -0.3], [this.armR, this.foreR, 0.3]] as const) {
      arm.position.set(x, 0.62, 0);
      limb(0.05, 0.04, 0.55, skin, arm);
      fore.position.y = -0.55;
      limb(0.04, 0.03, 0.55, skin, fore);
      const hand = mesh(new THREE.SphereGeometry(0.05, 8, 6), skin, fore);
      hand.scale.set(0.9, 1.3, 0.5);
      hand.position.y = -0.58;
      // long claw-like fingers, curled slightly forward
      for (let i = 0; i < 4; i++) {
        const fgeo = new THREE.CylinderGeometry(0.011, 0.004, 0.16, 5);
        fgeo.translate(0, -0.08, 0);
        const finger = mesh(fgeo, skin, fore);
        finger.position.set((i - 1.5) * 0.024, -0.62, 0);
        finger.rotation.set(0.3, 0, (i - 1.5) * 0.1);
        finger.castShadow = false;
      }
      arm.add(fore);
      this.torso.add(arm);
    }

    this.head.position.set(0, 0.85, 0.05);
    this.torso.add(this.head);
    // gaunt, elongated skull
    mesh(new THREE.SphereGeometry(0.15, 16, 12), skin, this.head).scale.set(0.8, 1.3, 0.9);
    const hairM = mesh(new THREE.SphereGeometry(0.155, 12, 10), hair, this.head);
    hairM.position.set(0, 0.07, -0.06);
    // stringy hair hanging down the back and sides
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 1.6 + Math.PI * 0.7; // arc around the back of the head
      const len = 0.35 + Math.random() * 0.3;
      const hgeo = new THREE.CylinderGeometry(0.009, 0.003, len, 4);
      hgeo.translate(0, -len / 2, 0);
      const strand = mesh(hgeo, hair, this.head);
      strand.position.set(Math.sin(a) * 0.13, 0.1, Math.cos(a) * 0.13 - 0.03);
      strand.rotation.set((Math.random() - 0.5) * 0.2, 0, (Math.random() - 0.5) * 0.2);
      strand.castShadow = false;
    }
    // sunken sockets with glowing eyes
    for (const x of [-0.055, 0.055]) {
      const socket = mesh(new THREE.SphereGeometry(0.04, 10, 8), voidMat, this.head);
      socket.position.set(x, 0.06, 0.1);
      socket.castShadow = false;
      const eye = mesh(new THREE.SphereGeometry(0.017, 8, 6), eyeMat, this.head);
      eye.position.set(x, 0.06, 0.13);
      eye.castShadow = false;
    }
    const nose = mesh(new THREE.ConeGeometry(0.02, 0.07, 6), skin, this.head);
    nose.position.set(0, -0.01, 0.13);
    nose.rotation.x = Math.PI / 2;
    // wide, slack mouth full of crooked teeth
    const mouth = mesh(new THREE.BoxGeometry(0.1, 0.06, 0.02), voidMat, this.head);
    mouth.position.set(0, -0.12, 0.115);
    mouth.castShadow = false;
    for (let i = 0; i < 7; i++) {
      const top = mesh(new THREE.BoxGeometry(0.01, 0.02 + Math.random() * 0.015, 0.008), teethMat, this.head);
      top.position.set((i - 3) * 0.014, -0.098, 0.126);
      top.castShadow = false;
      const bottom = mesh(new THREE.BoxGeometry(0.01, 0.015 + Math.random() * 0.015, 0.008), teethMat, this.head);
      bottom.position.set((i - 3) * 0.014, -0.148, 0.126);
      bottom.castShadow = false;
    }
  }

  /** World position of the head (updates matrices on demand). */
  headPosition(out: THREE.Vector3): THREE.Vector3 {
    return this.head.getWorldPosition(out);
  }

  update(dt: number, p: PoseInput): void {
    this.t += dt;
    const moving = p.speed > 0.1;
    const k = Math.min(p.speed / 1.6, 2.4);
    this.phase += p.speed * dt * 3.4;
    const s = Math.sin(this.phase);
    const c = Math.cos(this.phase);

    this.root.position.set(p.x, 0, p.z);
    this.root.rotation.y = p.yaw;

    this.hips.position.y = 0.95 + (moving ? Math.abs(c) * 0.035 * k : Math.sin(this.t * 1.6) * 0.006);
    this.legL.rotation.x = s * 0.55 * k;
    this.legR.rotation.x = -s * 0.55 * k;

    const lean = (p.reaching ? 0.5 : 0.3) + (moving ? 0.05 : 0);
    this.torso.rotation.x += (lean - this.torso.rotation.x) * damp(5, dt);
    this.torso.rotation.z = moving ? s * 0.06 * k : Math.sin(this.t * 1.1) * 0.02;
    this.torso.rotation.y = moving ? c * 0.08 * k : 0;

    // arms: swing opposite the legs, or reach out and tremble
    const tremble = Math.sin(this.t * 22) * 0.04;
    const armTarget = (side: number): number =>
      p.reaching ? -1.35 + tremble * side : (side * s * 0.5 * k) + Math.sin(this.t * 1.3) * 0.03;
    const foreTarget = p.reaching ? -0.25 : -0.12;
    for (const [arm, fore, side] of [[this.armL, this.foreL, -1], [this.armR, this.foreR, 1]] as const) {
      arm.rotation.x += (armTarget(side) - arm.rotation.x) * damp(p.reaching ? 9 : 5, dt);
      fore.rotation.x += (foreTarget - fore.rotation.x) * damp(7, dt);
    }
    this.armL.rotation.z = p.reaching ? -0.12 : -0.06;
    this.armR.rotation.z = p.reaching ? 0.12 : 0.06;

    // head: track the target within neck limits, else scan the room
    let yawT: number;
    let pitchT = 0;
    if (p.lookAt) {
      const head = this.headPosition(new THREE.Vector3());
      const dx = p.lookAt.x - head.x;
      const dz = p.lookAt.z - head.z;
      yawT = THREE.MathUtils.clamp(wrapPi(Math.atan2(dx, dz) - p.yaw - this.torso.rotation.y), -1.1, 1.1);
      pitchT = THREE.MathUtils.clamp(Math.atan2(head.y - p.lookAt.y, Math.hypot(dx, dz)), -0.5, 0.5);
    } else {
      yawT = Math.sin(this.t * 0.9) * 0.9;
    }
    this.head.rotation.y += (yawT - this.head.rotation.y) * damp(p.lookAt ? 8 : 3, dt);
    this.head.rotation.x += (pitchT - this.torso.rotation.x - this.head.rotation.x) * damp(8, dt);
    this.head.rotation.z = Math.sin(this.t * 0.7) * 0.06;

    const steps = Math.floor(this.phase / Math.PI);
    if (steps !== this.steps) {
      this.steps = steps;
      if (moving) this.onStep();
    }
  }
}
