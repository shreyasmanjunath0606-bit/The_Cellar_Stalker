import * as THREE from 'three';
import { Physics, RAPIER } from '../core/Physics';
import { FLOOR_H } from './HouseKit';
import { SoundBus } from '../ai/SoundBus';
import { AudioManager } from '../audio/AudioManager';
import { Materials, scaleBoxUVs } from '../rendering/Materials';
import { Effects } from '../rendering/Effects';

export type PropKind = 'vase' | 'chair' | 'bucket';

export interface Prop {
  id: number;
  kind: PropKind;
  body: RAPIER.RigidBody;
  colliders: RAPIER.Collider[];
  mesh: THREE.Object3D;
  /** Speed sampled just before the physics step; collision events report after the bounce. */
  impactSpeed: number;
  cooldown: number;
  broken: boolean;
}

/** Minimum pre-impact speed (m/s) before an object makes noise. */
const THRESHOLD: Record<PropKind, number> = { vase: 0.9, chair: 1.1, bucket: 0.8 };

/** Dynamic, knock-over-able objects that broadcast noise when they hit something. */
export class PropManager {
  readonly group = new THREE.Group();
  private readonly props: Prop[] = [];
  private readonly byCollider = new Map<number, Prop>();
  private readonly ceramic = new THREE.MeshStandardMaterial({ color: 0x6b5a45, roughness: 0.45 });
  private readonly tin = new THREE.MeshStandardMaterial({
    color: 0x6a6e70, roughness: 0.45, metalness: 0.8, side: THREE.DoubleSide,
  });

  constructor(
    private readonly physics: Physics,
    private readonly mats: Materials,
    private readonly bus: SoundBus,
    private readonly audio: AudioManager,
    private readonly fx: Effects,
  ) {
    this.build();
  }

  get(id: number): Prop | undefined {
    return this.props[id];
  }

  propFromCollider(handle: number): Prop | undefined {
    return this.byCollider.get(handle);
  }

  /** Apply a shove at a world point. */
  shove(prop: Prop, dir: THREE.Vector3, point: THREE.Vector3, speed = 3.5): void {
    const m = prop.body.mass();
    prop.body.applyImpulseAtPoint(
      { x: dir.x * m * speed, y: (dir.y * speed + 0.6) * m, z: dir.z * m * speed },
      point,
      true,
    );
  }

  beforeStep(): void {
    for (const p of this.props) {
      if (p.broken) continue;
      const v = p.body.linvel();
      p.impactSpeed = Math.hypot(v.x, v.y, v.z);
    }
  }

  afterStep(dt: number): void {
    this.physics.drainCollisions((h1, h2, started) => {
      if (!started) return;
      for (const h of [h1, h2]) {
        const p = this.byCollider.get(h);
        if (p) this.onImpact(p);
      }
    });
    for (const p of this.props) {
      if (p.broken) continue;
      p.cooldown = Math.max(0, p.cooldown - dt);
      const t = p.body.translation();
      const r = p.body.rotation();
      p.mesh.position.set(t.x, t.y, t.z);
      p.mesh.quaternion.set(r.x, r.y, r.z, r.w);
    }
  }

  private onImpact(p: Prop): void {
    const speed = p.impactSpeed;
    if (p.broken || p.cooldown > 0 || speed < THRESHOLD[p.kind]) return;
    p.cooldown = 0.35;
    const t = p.body.translation();
    const pos = new THREE.Vector3(t.x, t.y, t.z);
    const k = Math.min(speed / 4, 1);

    switch (p.kind) {
      case 'vase':
        this.shatter(p, pos);
        break;
      case 'chair':
        this.audio.playImpact(pos, 0.4 + k * 0.6);
        this.fx.puff(pos, 6);
        this.bus.emit(pos, THREE.MathUtils.clamp(speed * 7, 6, 16), 'prop');
        break;
      case 'bucket':
        this.audio.playImpact(pos, 0.4 + k * 0.6, true);
        this.fx.puff(pos, 4);
        this.bus.emit(pos, THREE.MathUtils.clamp(speed * 9, 8, 22), 'prop');
        break;
    }
  }

  private shatter(p: Prop, pos: THREE.Vector3): void {
    p.broken = true;
    this.byCollider.delete(p.colliders[0].handle);
    this.physics.world.removeRigidBody(p.body);
    p.mesh.visible = false;
    for (let i = 0; i < 9; i++) {
      const shard = new THREE.Mesh(new THREE.TetrahedronGeometry(0.03 + Math.random() * 0.04), this.ceramic);
      shard.position.set(pos.x + (Math.random() - 0.5) * 0.6, (pos.y > FLOOR_H - 0.2 ? FLOOR_H : 0) + 0.03, pos.z + (Math.random() - 0.5) * 0.6);
      shard.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
      shard.castShadow = true;
      this.group.add(shard);
    }
    this.fx.shatter(pos);
    this.audio.playShatter(pos);
    this.bus.emit(pos, 20, 'shatter');
  }

  private build(): void {
    const U = FLOOR_H;
    // ---- ground floor ----
    // kitchen
    this.chair(-10, -6.05, Math.PI);
    this.chair(-10, -7.98, 0);
    this.vase(-9.5, 0.78, -6.8);
    this.bucket(-6, -10.1);
    // dining room
    this.chair(-1, -6.45, Math.PI);
    this.chair(1, -8.55, 0);
    this.chair(2.2, -6.45, Math.PI);
    this.vase(-0.8, 0.78, -7.5);
    this.vase(-4.6, 0.94, -4.9);
    // library
    this.vase(7.2, 0, -4.6);
    this.chair(12.6, -5.5, -Math.PI / 2);
    // corridor
    this.vase(-13.5, 0.78, -2.85);
    // living room
    this.vase(-11.3, 0.45, 4.4);
    this.vase(-5.42, 0.94, 4.0);
    this.chair(-7, 1, 2.2);
    this.bucket(-13.3, 2.2);
    // entrance hall
    this.vase(1.7, 0, 8.55);
    // study
    this.chair(9.5, 7.5, Math.PI);
    this.vase(11.9, 0.9, -0.42);
    this.bucket(13.3, 2.2);
    // garage
    this.bucket(16.6, -0.3);
    this.bucket(20.9, 8.4);
    this.chair(14.9, 6.4, 1.2);

    // ---- upstairs ----
    // guest bedroom
    this.chair(-6.35, 5, -Math.PI / 2, U);
    this.vase(-10.0, U + 0.94, 8.58);
    // landing
    this.vase(4.55, U + 0.8, 7.05);
    // master bedroom
    this.vase(11.9, U + 0.94, -0.56);
    this.chair(8, 7.9, 2.6, U);
    // her bedroom
    this.vase(-6.9, U, -4.6);
    this.chair(-12.6, -4.75, 0.4, U);
    // bathroom
    this.bucket(3.9, -9.6, U);
    this.vase(-0.9, U, -10.4);
    // nursery
    this.bucket(12.6, -4.6, U);
    this.vase(6, U, -6.4);
    // upstairs corridor
    this.vase(13.5, U + 0.78, -2.95);
  }

  /** `surfaceY` is the height of whatever the vase stands on. */
  private vase(x: number, surfaceY: number, z: number): void {
    const profile = [[0.0, 0], [0.09, 0], [0.12, 0.1], [0.14, 0.2], [0.08, 0.3], [0.06, 0.34]].map(
      ([r, y]) => new THREE.Vector2(r, y - 0.17),
    );
    const mesh = new THREE.Mesh(new THREE.LatheGeometry(profile, 16), this.ceramic);
    mesh.castShadow = true;
    this.group.add(mesh);
    this.addBody('vase', mesh, x, surfaceY + 0.175, z, 0, [
      RAPIER.ColliderDesc.cylinder(0.17, 0.12).setRestitution(0.1).setDensity(300),
    ]);
  }

  private chair(x: number, z: number, rotY: number, y0 = 0): void {
    const g = new THREE.Group();
    const part = (w: number, h: number, d: number, px: number, py: number, pz: number): void => {
      const geo = new THREE.BoxGeometry(w, h, d);
      scaleBoxUVs(geo, w, h, d);
      const m = new THREE.Mesh(geo, this.mats.crate);
      m.position.set(px, py, pz);
      m.castShadow = m.receiveShadow = true;
      g.add(m);
    };
    part(0.45, 0.05, 0.45, 0, 0, 0); // seat
    part(0.45, 0.5, 0.05, 0, 0.27, -0.2); // back
    const legs = [[-0.19, -0.19], [0.19, -0.19], [-0.19, 0.19], [0.19, 0.19]];
    for (const [lx, lz] of legs) part(0.04, 0.45, 0.04, lx, -0.25, lz);
    this.group.add(g);

    const R = RAPIER.ColliderDesc;
    const descs = [
      R.cuboid(0.225, 0.025, 0.225),
      R.cuboid(0.225, 0.25, 0.025).setTranslation(0, 0.27, -0.2),
      ...legs.map(([lx, lz]) => R.cuboid(0.02, 0.225, 0.02).setTranslation(lx, -0.25, lz)),
    ].map((d) => d.setDensity(150).setFriction(0.6));
    this.addBody('chair', g, x, y0 + 0.475, z, rotY, descs);
  }

  private bucket(x: number, z: number, y0 = 0): void {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.13, 0.3, 16, 1, true), this.tin);
    const base = new THREE.Mesh(new THREE.CircleGeometry(0.13, 16), this.tin);
    base.rotation.x = Math.PI / 2;
    base.position.y = -0.15;
    mesh.add(base);
    mesh.castShadow = true;
    this.group.add(mesh);
    this.addBody('bucket', mesh, x, y0 + 0.16, z, 0, [
      RAPIER.ColliderDesc.cylinder(0.15, 0.15).setRestitution(0.4).setDensity(200),
    ]);
  }

  private addBody(
    kind: PropKind,
    mesh: THREE.Object3D,
    x: number,
    y: number,
    z: number,
    rotY: number,
    descs: RAPIER.ColliderDesc[],
  ): void {
    const body = this.physics.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(x, y, z)
        .setRotation({ x: 0, y: Math.sin(rotY / 2), z: 0, w: Math.cos(rotY / 2) })
        .setLinearDamping(0.4)
        .setAngularDamping(0.6),
    );
    const colliders = descs.map((d) =>
      this.physics.world.createCollider(d.setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS), body),
    );
    const prop: Prop = { id: this.props.length, kind, body, colliders, mesh, impactSpeed: 0, cooldown: 0.5, broken: false };
    this.props.push(prop);
    for (const c of colliders) this.byCollider.set(c.handle, prop);
    mesh.position.set(x, y, z);
  }
}
