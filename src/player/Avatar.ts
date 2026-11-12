import * as THREE from 'three';

/** What each player tells the others about themselves, a dozen times a second. */
export interface PlayerState {
  /** Feet position. */
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  /** Crouching. */
  cr: boolean;
  /** Flashlight on. */
  li: boolean;
  /** Hiding place id, or -1. */
  hide: number;
  /** Horizontal speed. */
  sp: number;
  /** 0 playing, 1 downed, 2 escaped. */
  st: number;
}

export const PLAYER_COLORS = [0xd8b45a, 0x5ab0d8, 0xc86a6a, 0x7ac87a, 0xb07ad8];

const wrapPi = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));

function nameTag(name: string, color: number): THREE.Sprite {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 64;
  const ctx = c.getContext('2d')!;
  ctx.font = 'bold 30px "Courier New", monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  const w = Math.min(250, ctx.measureText(name).width + 28);
  ctx.fillRect(128 - w / 2, 12, w, 40);
  ctx.fillStyle = `#${color.toString(16).padStart(6, '0')}`;
  ctx.fillText(name, 128, 33, 240);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, fog: false }));
  s.scale.set(0.9, 0.225, 1);
  return s;
}

/** Another player, as the rest of the team sees them: a simple figure with a torch and a name. */
export class Avatar {
  readonly root = new THREE.Group();
  /** Latest state from the network. */
  state: PlayerState | null = null;
  readonly feet = new THREE.Vector3();
  readonly eye = new THREE.Vector3();

  private readonly body = new THREE.Group();
  private readonly head: THREE.Mesh;
  private readonly legL: THREE.Mesh;
  private readonly legR: THREE.Mesh;
  private readonly armR: THREE.Group;
  private readonly light: THREE.SpotLight;
  private readonly tag: THREE.Sprite;
  private yaw = 0;
  private phase = 0;
  private placed = false;

  constructor(parent: THREE.Object3D, name: string, color: number) {
    const cloth = new THREE.MeshStandardMaterial({ color, roughness: 0.85 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x23262b, roughness: 0.9 });
    const skin = new THREE.MeshStandardMaterial({ color: 0xb08a6c, roughness: 0.8 });
    const part = (geo: THREE.BufferGeometry, mat: THREE.Material, p: THREE.Object3D, x: number, y: number, z: number): THREE.Mesh => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.castShadow = true;
      p.add(m);
      return m;
    };
    part(new THREE.BoxGeometry(0.42, 0.56, 0.24), cloth, this.body, 0, 1.1, 0);
    this.head = part(new THREE.SphereGeometry(0.13, 14, 10), skin, this.body, 0, 1.54, 0);
    const legGeo = new THREE.BoxGeometry(0.16, 0.82, 0.18);
    legGeo.translate(0, -0.41, 0);
    this.legL = part(legGeo, dark, this.body, -0.11, 0.82, 0);
    this.legR = part(legGeo, dark, this.body, 0.11, 0.82, 0);
    const armGeo = new THREE.BoxGeometry(0.11, 0.56, 0.12);
    armGeo.translate(0, -0.25, 0);
    part(armGeo, cloth, this.body, -0.27, 1.34, 0);
    this.armR = new THREE.Group();
    this.armR.position.set(0.27, 1.34, 0);
    this.armR.rotation.x = 1.2;
    part(armGeo, cloth, this.armR, 0, 0, 0);
    part(new THREE.CylinderGeometry(0.03, 0.04, 0.16, 8), dark, this.armR, 0, -0.56, 0);
    this.body.add(this.armR);
    this.root.add(this.body);

    // their torch lights the room for everyone, but casts no shadows (one shadow map is plenty)
    this.light = new THREE.SpotLight(0xfff0d0, 0, 14, 0.42, 0.6, 1.6);
    this.light.position.set(0.2, 1.4, -0.2);
    this.light.target.position.set(0.2, 1.2, -5);
    this.root.add(this.light, this.light.target);

    this.tag = nameTag(name, color);
    this.tag.position.y = 1.95;
    this.root.add(this.tag);
    this.root.visible = false;
    parent.add(this.root);
  }

  /** True while this player is in the house and can be seen. */
  get present(): boolean {
    return !!this.state && this.state.st === 0;
  }

  apply(s: PlayerState): void {
    this.state = s;
    if (!this.placed) {
      this.feet.set(s.x, s.y, s.z);
      this.yaw = s.yaw;
      this.placed = true;
    }
  }

  /** Marks a player who has left the game. */
  drop(): void {
    this.state = null;
    this.root.visible = false;
    this.light.intensity = 0;
  }

  update(dt: number): void {
    const s = this.state;
    if (!s) return;
    const k = 1 - Math.exp(-dt * 14);
    if (Math.hypot(s.x - this.feet.x, s.y - this.feet.y, s.z - this.feet.z) > 3) this.feet.set(s.x, s.y, s.z);
    else this.feet.set(
      this.feet.x + (s.x - this.feet.x) * k,
      this.feet.y + (s.y - this.feet.y) * k,
      this.feet.z + (s.z - this.feet.z) * k,
    );
    this.yaw += wrapPi(s.yaw - this.yaw) * k;
    this.eye.set(this.feet.x, this.feet.y + (s.hide >= 0 ? 0.3 : s.cr ? 1.0 : 1.5), this.feet.z);

    const visible = s.st === 0 && s.hide < 0;
    this.root.visible = visible;
    this.light.intensity = visible && s.li ? 42 : 0;
    if (!visible) return;
    this.root.position.copy(this.feet);
    this.root.rotation.y = this.yaw;
    this.body.scale.y = s.cr ? 0.68 : 1;
    this.tag.position.y = s.cr ? 1.45 : 1.95;
    this.phase += s.sp * dt * 3.2;
    const swing = Math.sin(this.phase) * Math.min(1, s.sp / 2.6) * 0.6;
    this.legL.rotation.x = swing;
    this.legR.rotation.x = -swing;
    this.head.rotation.x = s.pitch * 0.6;
    this.light.target.position.y = 1.2 + Math.tan(s.pitch) * 5;
  }
}
