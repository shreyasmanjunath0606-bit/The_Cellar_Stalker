import * as THREE from 'three';
import { Physics, RAPIER } from '../core/Physics';
import { StalkerTuning } from '../core/Levels';
import { AudioManager } from '../audio/AudioManager';
import { SoundBus, SoundEvent, isAudible } from './SoundBus';
import { WaypointGraph } from './Waypoints';
import { StalkerModel } from './StalkerModel';

export enum StalkerState {
  Patrol,
  Investigate,
  Chase,
  Attack,
  /** Knocked out by a sleeping dart. */
  Asleep,
}

/** Anyone she can hunt: the local player, or a remote one in co-op. */
export interface Target {
  id: string;
  /** Feet position. */
  feet: THREE.Vector3;
  eye: THREE.Vector3;
  hidden: boolean;
  /** She watched them climb into their hiding place. */
  exposed: boolean;
  crouching: boolean;
  lightOn: boolean;
  /** False while downed, escaped or gone. */
  active: boolean;
}

/** What the host sends about her each network tick. */
export interface StalkerSnapshot {
  x: number;
  y: number;
  z: number;
  yaw: number;
  speed: number;
  state: StalkerState;
  aw: number;
  atk: number;
  prey: string | null;
  sees: boolean;
  sleep: number;
}

const RADIUS = 0.35;
const HALF_HEIGHT = 0.65; // capsule is 2.0 m tall; centre 1.0 m above her feet
const EYE_HEIGHT = 1.7;
const ATTACK_RANGE = 1.4;
/** Seconds between the lunge starting and the catch being registered. */
const ATTACK_DURATION = 1.8;
const wrapPi = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));
const NO_BODIES = RAPIER.QueryFilterFlags.EXCLUDE_KINEMATIC;

export class Stalker {
  readonly model: StalkerModel;
  state = StalkerState.Patrol;
  /** 0..1 — fills while a player is in view; at 1 she gives chase. */
  awareness = 0;
  /** She has eyes on somebody right now. */
  canSee = false;
  /** Seconds of sleep left. */
  sleepLeft = 0;
  /** Id of whoever she is chasing or attacking. */
  preyId: string | null = null;
  onCatch: (id: string) => void = () => {};
  /** Fired when her instinct (not a sound) pulls her toward a player. */
  onInstinct: () => void = () => {};
  onWake: () => void = () => {};

  private readonly body: RAPIER.RigidBody | null = null;
  private readonly collider: RAPIER.Collider | null = null;
  private readonly controller: RAPIER.KinematicCharacterController | null = null;
  /** Feet position. */
  private readonly pos = new THREE.Vector3();
  private readonly headPos = new THREE.Vector3();
  private readonly netPos = new THREE.Vector3();
  private netYaw = 0;
  private yaw = 0;
  private speed = 0;
  private attackT = 0;
  private readonly seen = new Set<string>();

  private path: THREE.Vector3[] = [];
  private pathTarget: THREE.Vector3 | null = null;
  private repathTimer = 0;
  private patrolNode = -1;
  private readonly investigateTarget = new THREE.Vector3();
  private searching = false;
  private waitTimer = 0;
  private readonly lastSeen = new THREE.Vector3();
  private lostTimer = 0;
  private caught = false;
  private stuckTimer = 0;
  private readonly stuckCheck = new THREE.Vector3();
  private voiceTimer = 4 + Math.random() * 6;
  private instinctTimer: number;

  constructor(
    private readonly physics: Physics,
    parent: THREE.Object3D,
    private readonly graph: WaypointGraph,
    bus: SoundBus,
    private readonly targets: () => Target[],
    private readonly audio: AudioManager,
    startNode: number,
    private readonly tune: StalkerTuning,
    glow: THREE.Texture,
    variant = 0,
    /** A puppet has no mind of its own: it replays what the host says she is doing. */
    private readonly puppet = false,
  ) {
    this.model = new StalkerModel(glow, variant);
    this.instinctTimer = tune.senseInterval * (0.6 + Math.random() * 0.4);
    const start = graph.nodes[startNode].pos;
    this.pos.copy(start);
    this.netPos.copy(start);
    if (!puppet) {
      const world = physics.world;
      this.body = world.createRigidBody(
        RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(start.x, start.y + 1, start.z),
      );
      this.collider = world.createCollider(RAPIER.ColliderDesc.capsule(HALF_HEIGHT, RADIUS), this.body);
      this.controller = world.createCharacterController(0.01);
      this.controller.setSlideEnabled(true);
      this.controller.enableSnapToGround(0.25);
      this.controller.enableAutostep(0.3, 0.1, false);
      this.controller.setMaxSlopeClimbAngle(Math.PI / 4);
      this.controller.setMinSlopeSlideAngle(Math.PI / 3);
      this.controller.setApplyImpulsesToDynamicBodies(true);
      bus.subscribe((e) => this.hear(e));
      this.pickPatrolTarget();
      this.waitTimer = tune.startDelay;
    }
    this.model.onStep = () => audio.playFootstep(this.pos, this.state === StalkerState.Chase ? 1 : 0.7);
    parent.add(this.model.root);
    this.pose(0);
  }

  get position(): THREE.Vector3 {
    return this.pos;
  }

  get hunting(): boolean {
    return this.state === StalkerState.Chase || this.state === StalkerState.Attack;
  }

  get asleep(): boolean {
    return this.state === StalkerState.Asleep;
  }

  /** 0..1 — how threatening she is to someone at `p`, for flicker and camera effects. */
  tensionAt(p: THREE.Vector3): number {
    const alerted = this.hunting || this.awareness > 0.1;
    return alerted ? THREE.MathUtils.clamp(1 - this.pos.distanceTo(p) / 14, 0, 1) : 0;
  }

  /** 0..1 — straight-line closeness to `p`, regardless of awareness. */
  proximityAt(p: THREE.Vector3): number {
    return this.asleep ? 0 : THREE.MathUtils.clamp(1 - this.pos.distanceTo(p) / 12, 0, 1);
  }

  /** 0..1 — how close she is to (or how deep into) a chase, for the HUD eye. */
  get alert(): number {
    if (this.asleep) return 0;
    if (this.hunting) return 1;
    if (this.state === StalkerState.Investigate) return Math.max(0.35, this.awareness * 0.9);
    return this.awareness * 0.9;
  }

  get attackProgress(): number {
    return this.state === StalkerState.Attack ? this.attackT / ATTACK_DURATION : 0;
  }

  sees(id: string): boolean {
    return this.seen.has(id);
  }

  headPosition(out: THREE.Vector3): THREE.Vector3 {
    return this.model.headPosition(out);
  }

  snapshot(): StalkerSnapshot {
    const r = (n: number): number => Math.round(n * 100) / 100;
    return {
      x: r(this.pos.x), y: r(this.pos.y), z: r(this.pos.z), yaw: r(this.yaw), speed: r(this.speed),
      state: this.state, aw: r(this.awareness), atk: r(this.attackProgress), prey: this.preyId,
      sees: this.canSee, sleep: Math.ceil(this.sleepLeft),
    };
  }

  applySnapshot(s: StalkerSnapshot): void {
    if (this.puppet && s.state === StalkerState.Investigate && this.state === StalkerState.Patrol) {
      this.audio.playGrowl(this.model.headPosition(this.headPos));
    }
    this.netPos.set(s.x, s.y, s.z);
    this.netYaw = s.yaw;
    this.speed = s.speed;
    this.state = s.state;
    this.awareness = s.aw;
    this.attackT = s.atk * ATTACK_DURATION;
    this.preyId = s.prey;
    this.canSee = s.sees;
    this.sleepLeft = s.sleep;
  }

  /** Puts her to sleep where she stands. */
  sleep(seconds: number): void {
    this.state = StalkerState.Asleep;
    this.sleepLeft = seconds;
    this.awareness = 0;
    this.canSee = false;
    this.preyId = null;
    this.seen.clear();
    this.speed = 0;
    this.path = [];
    this.pathTarget = null;
  }

  /** Stands her at a node, calm, for `delay` seconds. */
  reset(node: number, delay = this.tune.startDelay): void {
    const p = this.graph.nodes[node].pos;
    this.body?.setTranslation({ x: p.x, y: p.y + 1, z: p.z }, true);
    this.body?.setNextKinematicTranslation({ x: p.x, y: p.y + 1, z: p.z });
    this.pos.copy(p);
    this.calm(delay);
    this.pose(0);
  }

  /** Forgets everything and stands still for `delay` seconds before wandering off. */
  calm(delay: number): void {
    this.state = StalkerState.Patrol;
    this.awareness = 0;
    this.canSee = false;
    this.caught = false;
    this.preyId = null;
    this.attackT = 0;
    this.searching = false;
    this.speed = 0;
    this.sleepLeft = 0;
    this.path = [];
    this.pathTarget = null;
    this.instinctTimer = this.tune.senseInterval;
    this.pickPatrolTarget();
    this.waitTimer = delay;
  }

  update(dt: number): void {
    if (this.puppet) {
      this.pos.lerp(this.netPos, 1 - Math.exp(-dt * 12));
      if (this.pos.distanceTo(this.netPos) > 4) this.pos.copy(this.netPos);
      this.yaw += wrapPi(this.netYaw - this.yaw) * (1 - Math.exp(-dt * 12));
      if (!this.asleep) this.voice(dt);
      this.pose(dt);
      return;
    }
    const t = this.body!.translation();
    this.pos.set(t.x, t.y - 1, t.z);

    if (this.state === StalkerState.Asleep) {
      this.sleepLeft -= dt;
      this.speed = 0;
      if (this.sleepLeft <= 0) {
        this.calm(2.5);
        this.audio.playGrowl(this.model.headPosition(this.headPos));
        this.onWake();
      }
      this.pose(dt);
      return;
    }

    this.sense(dt);
    this.instinct(dt);
    this.voice(dt);

    let speed = 0;
    switch (this.state) {
      case StalkerState.Patrol:
        speed = this.updatePatrol(dt);
        break;
      case StalkerState.Investigate:
        speed = this.updateInvestigate(dt);
        break;
      case StalkerState.Chase:
        speed = this.updateChase(dt);
        break;
      case StalkerState.Attack:
        this.updateAttack(dt);
        break;
    }
    this.speed += (speed - this.speed) * (1 - Math.exp(-8 * dt));
    this.checkStuck(dt, speed);
    this.pose(dt);
  }

  private prey(): Target | null {
    return this.preyId ? (this.targets().find((t) => t.id === this.preyId) ?? null) : null;
  }

  private pose(dt: number): void {
    const prey = this.prey();
    this.model.update(dt, {
      x: this.pos.x,
      y: this.pos.y,
      z: this.pos.z,
      yaw: this.yaw,
      speed: this.speed,
      reaching: this.hunting,
      lookAt: this.hunting && prey ? prey.eye : null,
      rage: this.hunting ? 1 : this.awareness * 0.8,
      attack: this.attackProgress,
      down: this.asleep ? 1 : 0,
    });
  }

  // ---- senses -------------------------------------------------------------

  private hear(e: SoundEvent): void {
    if (this.hunting || this.asleep) return;
    const d = e.position.distanceTo(this.pos);
    if (!isAudible(e, this.pos, this.tune.hearing)) return;
    if (this.state === StalkerState.Patrol) this.audio.playGrowl(this.model.headPosition(this.headPos));
    // farther sounds are localised less precisely
    const jitter = d * 0.06;
    this.investigateTarget.set(
      e.position.x + (Math.random() - 0.5) * jitter,
      this.floorOf(e.position.y),
      e.position.z + (Math.random() - 0.5) * jitter,
    );
    this.state = StalkerState.Investigate;
    this.searching = false;
    this.pathTarget = null;
  }

  /** Snaps a height to the floor it belongs to (sounds come from table tops, feet, hands…). */
  private floorOf(y: number): number {
    return y > 2.4 ? 3 : 0;
  }

  private visible(t: Target, eye: THREE.Vector3): boolean {
    if (!t.active) return false;
    if (t.hidden) {
      // a hiding place only works if she didn't watch you climb in
      return t.exposed && this.state === StalkerState.Chase && this.preyId === t.id;
    }
    const to = t.eye.clone().sub(eye);
    const dist = to.length();
    const range = (t.lightOn ? this.tune.visionLit : this.tune.visionDark) * (t.crouching ? 0.65 : 1);
    if (dist > range || dist < 0.01) return dist < 0.01;
    const dir = to.divideScalar(dist);
    const inCone = dir.x * Math.sin(this.yaw) + dir.z * Math.cos(this.yaw) > 0.45 || dist < 3;
    if (!inCone) return false;
    return !this.physics.world.castRay(new RAPIER.Ray(eye, dir), dist, true, NO_BODIES);
  }

  private sense(dt: number): void {
    if (this.state === StalkerState.Attack) return;
    const eye = new THREE.Vector3(this.pos.x, this.pos.y + EYE_HEIGHT, this.pos.z);
    this.seen.clear();
    let nearest: Target | null = null;
    let nearestD = Infinity;
    for (const t of this.targets()) {
      if (!this.visible(t, eye)) continue;
      this.seen.add(t.id);
      const d = t.eye.distanceTo(eye);
      if (d < nearestD) {
        nearest = t;
        nearestD = d;
      }
    }

    if (this.state === StalkerState.Chase) {
      // stay on the one she is after; only switch if she loses them and sees someone else
      const prey = this.prey();
      if ((!prey || !this.seen.has(prey.id)) && nearest) this.preyId = nearest.id;
      const now = this.prey();
      this.canSee = !!now && this.seen.has(now.id);
      if (this.canSee) this.lastSeen.copy(now!.feet);
      this.awareness = 1;
      return;
    }

    this.canSee = !!nearest;
    if (nearest) {
      this.lastSeen.copy(nearest.feet);
      const rate = (nearestD < 5 ? 3 : nearestD < 9 ? 1.6 : 0.7) * this.tune.awareness;
      this.awareness = Math.min(1, this.awareness + rate * dt);
      if (this.awareness >= 1) {
        this.state = StalkerState.Chase;
        this.preyId = nearest.id;
        this.lostTimer = 0;
        this.pathTarget = null;
      }
    } else {
      this.awareness = Math.max(0, this.awareness - 0.35 * dt);
    }
  }

  /** On later nights she periodically drifts toward wherever a player is, heard or not. */
  private instinct(dt: number): void {
    if (this.tune.senseInterval <= 0 || this.state !== StalkerState.Patrol) return;
    this.instinctTimer -= dt;
    if (this.instinctTimer > 0) return;
    this.instinctTimer = this.tune.senseInterval * (0.8 + Math.random() * 0.4);
    const live = this.targets().filter((t) => t.active);
    if (!live.length) return;
    const p = live[Math.floor(Math.random() * live.length)].feet;
    const a = Math.random() * Math.PI * 2;
    const r = 2 + Math.random() * 3;
    this.investigateTarget.set(p.x + Math.cos(a) * r, this.floorOf(p.y + 0.5), p.z + Math.sin(a) * r);
    this.state = StalkerState.Investigate;
    this.searching = false;
    this.pathTarget = null;
    this.audio.playGrowl(this.model.headPosition(this.headPos));
    this.onInstinct();
  }

  /** She hums to herself while wandering, which lets a careful player track her by ear. */
  private voice(dt: number): void {
    if (this.hunting) return;
    this.voiceTimer -= dt;
    if (this.voiceTimer > 0) return;
    this.voiceTimer = 7 + Math.random() * 9;
    this.audio.playMoan(this.model.headPosition(this.headPos));
  }

  // ---- states -------------------------------------------------------------

  private updatePatrol(dt: number): number {
    if (this.waitTimer > 0) {
      this.waitTimer -= dt;
      if (this.waitTimer <= 0) this.pickPatrolTarget();
      return 0;
    }
    const target = this.graph.nodes[this.patrolNode].pos;
    if (this.moveToward(target, this.tune.patrol, dt)) {
      this.waitTimer = 1.5 + Math.random() * 2;
      return 0;
    }
    return this.tune.patrol;
  }

  private updateInvestigate(dt: number): number {
    if (this.searching) {
      this.waitTimer -= dt;
      if (this.waitTimer <= 0) {
        this.state = StalkerState.Patrol;
        this.patrolNode = this.graph.nearestNode(this.pos);
        this.pickPatrolTarget();
      }
      return 0;
    }
    if (this.moveToward(this.investigateTarget, this.tune.investigate, dt)) {
      this.searching = true;
      this.waitTimer = this.tune.searchTime;
      return 0;
    }
    return this.tune.investigate;
  }

  private giveUp(): number {
    this.state = StalkerState.Investigate;
    this.investigateTarget.copy(this.lastSeen);
    this.investigateTarget.y = this.floorOf(this.lastSeen.y + 0.5);
    this.searching = true;
    this.waitTimer = this.tune.searchTime + 0.5;
    this.awareness = 0.3;
    this.preyId = null;
    return 0;
  }

  private updateChase(dt: number): number {
    const prey = this.prey();
    if (!prey || !prey.active) return this.giveUp();
    const dist = Math.hypot(prey.feet.x - this.pos.x, prey.feet.z - this.pos.z);
    const level = Math.abs(prey.feet.y - this.pos.y) < 1.2;
    const reachable = !prey.hidden || prey.exposed;
    if (reachable && level && dist < ATTACK_RANGE && (this.canSee || dist < 1.0)) {
      this.state = StalkerState.Attack;
      this.attackT = 0;
      this.caught = false;
      return 0;
    }

    const goal = this.canSee ? prey.feet : this.lastSeen;
    this.lostTimer = this.canSee ? 0 : this.lostTimer + dt;
    const arrived = this.moveToward(goal, this.tune.chase, dt);
    if (!this.canSee && (arrived || this.lostTimer > this.tune.loseTime)) return this.giveUp();
    return this.tune.chase;
  }

  private updateAttack(dt: number): void {
    this.attackT += dt;
    const prey = this.prey();
    if (!prey || !prey.active) {
      this.calm(3);
      return;
    }
    const face = Math.atan2(prey.feet.x - this.pos.x, prey.feet.z - this.pos.z);
    this.yaw += wrapPi(face - this.yaw) * Math.min(1, dt * 10);
    if (this.attackT >= ATTACK_DURATION && !this.caught) {
      this.caught = true;
      const id = prey.id;
      // she lingers over her catch, then goes back to wandering
      this.calm(this.tune.startDelay * 0.6);
      this.onCatch(id);
    }
  }

  // ---- movement -----------------------------------------------------------

  private pickPatrolTarget(): void {
    this.patrolNode = this.graph.randomNode(this.patrolNode);
    this.pathTarget = null;
  }

  /** Walks along an A* path toward `target` (feet height). Returns true once it has arrived. */
  private moveToward(target: THREE.Vector3, speed: number, dt: number): boolean {
    this.repathTimer -= dt;
    if (!this.pathTarget || this.repathTimer <= 0 || this.pathTarget.distanceTo(target) > 1.2) {
      this.path = this.graph.findPath(this.pos, target);
      this.pathTarget = target.clone();
      this.repathTimer = 0.7;
    }
    while (this.path.length > 0) {
      const reach = this.path.length === 1 ? 0.6 : 0.45;
      const next = this.path[0];
      const flat = Math.hypot(next.x - this.pos.x, next.z - this.pos.z);
      if (flat < reach && Math.abs(next.y - this.pos.y) < 1.3) this.path.shift();
      else break;
    }
    if (this.path.length === 0) return true;

    const next = this.path[0];
    const dx = next.x - this.pos.x;
    const dz = next.z - this.pos.z;
    const len = Math.hypot(dx, dz) || 1e-6;
    const want = Math.atan2(dx, dz);
    const turn = wrapPi(want - this.yaw);
    const turnRate = this.state === StalkerState.Chase ? 7 : 4;
    this.yaw += THREE.MathUtils.clamp(turn, -turnRate * dt, turnRate * dt);

    const forward = Math.max(0.15, Math.cos(Math.min(Math.abs(turn), Math.PI / 2)));
    const step = Math.min(speed * forward * dt, len);
    this.controller!.computeColliderMovement(
      this.collider!,
      // a gentle downward pull only: anything stronger cancels out the climb on a staircase
      { x: (dx / len) * step, y: -1 * dt, z: (dz / len) * step },
      NO_BODIES,
    );
    const m = this.controller!.computedMovement();
    const t = this.body!.translation();
    this.body!.setNextKinematicTranslation({ x: t.x + m.x, y: t.y + m.y, z: t.z + m.z });
    this.pos.set(t.x + m.x, t.y + m.y - 1, t.z + m.z);
    return false;
  }

  /** If it's been trying to walk but hasn't gone anywhere, drop the plan and pick another. */
  private checkStuck(dt: number, wantedSpeed: number): void {
    if (wantedSpeed === 0) {
      this.stuckTimer = 0;
      this.stuckCheck.copy(this.pos);
      return;
    }
    this.stuckTimer += dt;
    if (this.stuckTimer < 1.2) return;
    if (this.pos.distanceTo(this.stuckCheck) < 0.25) {
      this.path = [];
      this.pathTarget = null;
      if (this.state === StalkerState.Patrol) this.pickPatrolTarget();
      else if (this.state === StalkerState.Investigate) {
        this.searching = true;
        this.waitTimer = 1;
      } else if (this.state === StalkerState.Chase && !this.canSee) this.giveUp();
    }
    this.stuckTimer = 0;
    this.stuckCheck.copy(this.pos);
  }
}
