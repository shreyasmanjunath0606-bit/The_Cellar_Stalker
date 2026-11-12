import * as THREE from 'three';

export interface PoseInput {
  x: number;
  /** Feet height. */
  y: number;
  z: number;
  yaw: number;
  /** 0..1 - collapsed on the floor, asleep. */
  down: number;
  speed: number;
  /** Arms reach forward (chase / attack). */
  reaching: boolean;
  /** World point the head should track, or null to idly look around. */
  lookAt: THREE.Vector3 | null;
  /** 0..1 — how enraged she is; shifts the eyes from amber to red. */
  rage: number;
  /** 0..1 — progress through the lunge; opens the jaw. */
  attack: number;
}

interface Variant {
  scale: number;
  skin: number;
  dress: number;
  hair: number;
  eyeCalm: number;
  eyeRage: number;
}

const VARIANTS: Variant[] = [
  { scale: 1, skin: 0x474c44, dress: 0x2a1a1a, hair: 0x8d8b84, eyeCalm: 0xffd890, eyeRage: 0xff2a10 },
  // "the other one": taller, pale shroud, cold eyes
  { scale: 1.09, skin: 0x55524c, dress: 0x77726a, hair: 0x15110f, eyeCalm: 0xbfd8ff, eyeRage: 0xff3020 },
];

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
  private readonly jaw = new THREE.Group();
  private readonly mouth: THREE.Mesh;
  private readonly eyeMat: THREE.MeshBasicMaterial;
  private readonly halos: THREE.Sprite[] = [];
  private readonly calm: THREE.Color;
  private readonly enraged: THREE.Color;
  private readonly tint = new THREE.Color();
  private rage = 0;
  private down = 0;
  private phase = 0;
  private steps = 0;
  private t = Math.random() * 10;

  constructor(glow: THREE.Texture, variant = 0) {
    const v = VARIANTS[variant % VARIANTS.length];
    this.calm = new THREE.Color(v.eyeCalm);
    this.enraged = new THREE.Color(v.eyeRage);
    this.root.scale.setScalar(v.scale);

    const skin = new THREE.MeshStandardMaterial({ color: v.skin, roughness: 0.9, emissive: 0x050605 });
    const dress = new THREE.MeshStandardMaterial({ color: v.dress, roughness: 1, side: THREE.DoubleSide });
    const hair = new THREE.MeshStandardMaterial({ color: v.hair, roughness: 1 });
    this.eyeMat = new THREE.MeshBasicMaterial({ color: v.eyeCalm });
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
    // ragged hem
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2;
      const len = 0.12 + Math.random() * 0.16;
      const tatter = mesh(new THREE.ConeGeometry(0.07, len, 4, 1, true), dress, this.hips);
      tatter.position.set(Math.sin(a) * 0.32, -0.68 - len / 2, Math.cos(a) * 0.32);
      tatter.rotation.x = Math.PI;
      tatter.castShadow = false;
    }

    this.hips.add(this.torso);
    const chest = mesh(new THREE.CylinderGeometry(0.2, 0.25, 0.7, 12), dress, this.torso);
    chest.position.y = 0.35;
    // bony shoulders and a hunched spine
    for (const x of [-0.26, 0.26]) {
      const shoulder = mesh(new THREE.SphereGeometry(0.085, 10, 8), dress, this.torso);
      shoulder.position.set(x, 0.64, 0);
    }
    const hump = mesh(new THREE.SphereGeometry(0.17, 10, 8), dress, this.torso);
    hump.position.set(0, 0.58, -0.1);
    hump.scale.set(1.2, 0.9, 1);
    const neck = mesh(new THREE.CylinderGeometry(0.045, 0.06, 0.2, 8), skin, this.torso);
    neck.position.set(0, 0.75, 0.03);
    neck.rotation.x = 0.2;

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
    mesh(new THREE.SphereGeometry(0.15, 16, 12), skin, this.head).scale.set(0.78, 1.25, 0.92);
    const hairM = mesh(new THREE.SphereGeometry(0.16, 12, 10), hair, this.head);
    hairM.position.set(0, 0.075, -0.045);
    // stringy hair all the way round; the strands in front hang over the face like a torn veil
    for (let i = 0; i < 26; i++) {
      const a = (i / 26) * Math.PI * 2 + Math.random() * 0.15;
      const front = Math.cos(a) > 0.35;
      if (front && Math.random() < 0.35) continue;
      const len = front ? 0.16 + Math.random() * 0.3 : 0.35 + Math.random() * 0.4;
      const hgeo = new THREE.CylinderGeometry(0.008, 0.003, len, 4);
      hgeo.translate(0, -len / 2, 0);
      const strand = mesh(hgeo, hair, this.head);
      strand.position.set(Math.sin(a) * 0.125, front ? 0.15 : 0.1, Math.cos(a) * 0.135 - 0.015);
      strand.rotation.set((Math.random() - 0.5) * 0.2 + (front ? -0.06 : 0), 0, (Math.random() - 0.5) * 0.25);
      strand.castShadow = false;
    }
    // heavy brow over deep, sunken sockets; the eyes are embers at the back of them
    const brow = mesh(new THREE.BoxGeometry(0.19, 0.028, 0.05), skin, this.head);
    brow.position.set(0, 0.112, 0.105);
    brow.rotation.x = 0.25;
    for (const x of [-0.055, 0.055]) {
      const socket = mesh(new THREE.SphereGeometry(0.05, 10, 8), voidMat, this.head);
      socket.position.set(x, 0.052, 0.098);
      socket.scale.set(0.95, 1.15, 0.55);
      socket.castShadow = false;
      const eye = mesh(new THREE.SphereGeometry(0.013, 8, 6), this.eyeMat, this.head);
      eye.position.set(x, 0.05, 0.123);
      eye.castShadow = false;
      const halo = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: glow, color: v.eyeCalm, transparent: true, opacity: 0.5,
          blending: THREE.AdditiveBlending, depthWrite: false,
        }),
      );
      halo.position.set(x, 0.05, 0.14);
      halo.scale.setScalar(0.12);
      this.head.add(halo);
      this.halos.push(halo);
      // hollow cheeks
      const cheek = mesh(new THREE.SphereGeometry(0.036, 8, 6), voidMat, this.head);
      cheek.position.set(x * 1.35, -0.05, 0.088);
      cheek.scale.set(0.55, 1.3, 0.4);
      cheek.castShadow = false;
    }
    // two slits where a nose used to be
    for (const x of [-0.012, 0.012]) {
      const slit = mesh(new THREE.BoxGeometry(0.008, 0.03, 0.01), voidMat, this.head);
      slit.position.set(x, -0.025, 0.133);
      slit.castShadow = false;
    }
    // a mouth torn too wide, full of long crooked teeth; the lower row drops with the jaw
    this.mouth = mesh(new THREE.BoxGeometry(0.13, 0.07, 0.02), voidMat, this.head);
    this.mouth.position.set(0, -0.12, 0.108);
    this.mouth.castShadow = false;
    this.head.add(this.jaw);
    const chin = mesh(new THREE.SphereGeometry(0.06, 10, 8), skin, this.jaw);
    chin.position.set(0, -0.185, 0.055);
    chin.scale.set(1.15, 0.6, 0.95);
    for (let i = 0; i < 9; i++) {
      const th = 0.022 + Math.random() * 0.026;
      const top = mesh(new THREE.ConeGeometry(0.0065, th, 4), teethMat, this.head);
      top.position.set((i - 4) * 0.0145, -0.087 - th / 2, 0.12);
      top.rotation.x = Math.PI;
      top.castShadow = false;
      const bh = 0.018 + Math.random() * 0.024;
      const bottom = mesh(new THREE.ConeGeometry(0.0065, bh, 4), teethMat, this.jaw);
      bottom.position.set((i - 4) * 0.0145 + 0.006, -0.155 + bh / 2, 0.12);
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

    // asleep: she topples onto her back and the eyes go out
    this.down += (p.down - this.down) * damp(5, dt);
    this.root.rotation.order = 'YXZ';
    this.root.position.set(p.x, p.y + this.down * 0.22, p.z);
    this.root.rotation.set(-this.down * (Math.PI / 2 - 0.08), p.yaw, 0);

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
      p.reaching ? -1.35 + tremble * side : side * s * 0.5 * k + Math.sin(this.t * 1.3) * 0.03;
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
    // twitch harder the angrier she is
    this.head.rotation.z = Math.sin(this.t * 0.7) * 0.06 + Math.sin(this.t * 31) * 0.03 * p.rage;

    // eyes: amber embers when calm, burning red on the hunt (values > 1 feed the bloom pass)
    this.rage += (p.rage - this.rage) * damp(4, dt);
    this.tint.copy(this.calm).lerp(this.enraged, this.rage);
    const flicker = 0.85 + 0.15 * Math.sin(this.t * 17);
    const awake = 1 - this.down * 0.97;
    this.eyeMat.color.copy(this.tint).multiplyScalar((7 + this.rage * 9) * flicker * awake);
    for (const h of this.halos) {
      h.material.color.copy(this.tint);
      h.material.opacity = (0.35 + this.rage * 0.5) * awake;
      h.scale.setScalar(0.11 + this.rage * 0.13);
    }

    // jaw unhinges during the lunge
    const open = Math.min(1, p.attack * 3);
    this.jaw.position.y = -open * 0.09;
    this.mouth.scale.y = 1 + open * 1.5;
    this.mouth.position.y = -0.12 - open * 0.052;

    const steps = Math.floor(this.phase / Math.PI);
    if (steps !== this.steps) {
      this.steps = steps;
      if (moving) this.onStep();
    }
  }
}
