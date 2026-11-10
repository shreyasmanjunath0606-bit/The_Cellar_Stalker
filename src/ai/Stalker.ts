import * as THREE from 'three';
import { Physics, RAPIER } from '../core/Physics';
import { StalkerTuning } from '../core/Levels';
import { AudioManager } from '../audio/AudioManager';
import { PlayerController } from '../player/PlayerController';
import { Flashlight } from '../player/Flashlight';
import { SoundBus, SoundEvent, isAudible } from './SoundBus';
import { WaypointGraph } from './Waypoints';
import { StalkerModel } from './StalkerModel';

export enum StalkerState {
  Patrol,
  Investigate,
  Chase,
  Attack,
}

const RADIUS = 0.35;
const HALF_HEIGHT = 0.65; // capsule is 2.0 m tall; centre at y = 1.0
const EYE_HEIGHT = 1.7;
const ATTACK_RANGE = 1.4;
/** Seconds between the lunge starting and the catch being registered. */
const ATTACK_DURATION = 1.8;
/** Seconds she stands still after (re)spawning, so the player can get their bearings. */
const START_DELAY = 6;
const wrapPi = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));

export class Stalker {
  readonly model: StalkerModel;
  state = StalkerState.Patrol;
  /** 0..1 — fills while the player is in view; at 1 the stalker gives chase. */
  awareness = 0;
  canSee = false;
  /** Set while another stalker is mid-attack, so only one catch plays out. */
  frozen = false;
  onCatch: () => void = () => {};
  /** Fired when her instinct (not a sound) pulls her toward the player. */
  onInstinct: () => void = () => {};

  private readonly body: RAPIER.RigidBody;
  private readonly collider: RAPIER.Collider;
  private readonly controller: RAPIER.KinematicCharacterController;
  private readonly pos = new THREE.Vector3();
  private readonly headPos = new THREE.Vector3();
  private yaw = 0;
  private speed = 0;

  private path: THREE.Vector3[] = [];
  private pathTarget: THREE.Vector3 | null = null;
  private repathTimer = 0;
  private patrolNode = -1;
  private readonly investigateTarget = new THREE.Vector3();
  private searching = false;
  private waitTimer = 0;
  private readonly lastSeen = new THREE.Vector3();
  private lostTimer = 0;
  private attackTimer = 0;
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
    private readonly player: PlayerController,
    private readonly flashlight: Flashlight,
    private readonly audio: AudioManager,
    startNode: number,
    private readonly tune: StalkerTuning,
    glow: THREE.Texture,
    variant = 0,
  ) {
    this.model = new StalkerModel(glow, variant);
    this.instinctTimer = tune.senseInterval * (0.6 + Math.random() * 0.4);
    const world = physics.world;
    const start = graph.nodes[startNode].pos;
    this.body = world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(start.x, 1, start.z),
    );
    this.collider = world.createCollider(RAPIER.ColliderDesc.capsule(HALF_HEIGHT, RADIUS), this.body);
    this.controller = world.createCharacterController(0.01);
    this.controller.setSlideEnabled(true);
    this.controller.enableSnapToGround(0.2);
    this.controller.setApplyImpulsesToDynamicBodies(true);
    this.pos.copy(start);
    this.model.onStep = () => audio.playFootstep(this.pos, this.state === StalkerState.Chase ? 1 : 0.7);
    parent.add(this.model.root);
    bus.subscribe((e) => this.hear(e));
    this.pickPatrolTarget();
    this.waitTimer = START_DELAY;
    this.pose(0);
  }

  get position(): THREE.Vector3 {
    return this.pos;
  }

  get hunting(): boolean {
    return this.state === StalkerState.Chase || this.state === StalkerState.Attack;
  }

  /** 0..1 — how threatening the stalker currently is, for flicker and camera effects. */
  get tension(): number {
    const d = this.pos.distanceTo(this.player.position);
    const alerted = this.hunting || this.awareness > 0.1;
    return alerted ? THREE.MathUtils.clamp(1 - d / 14, 0, 1) : 0;
  }

  /** 0..1 — straight-line closeness to the player, regardless of awareness. */
  get proximity(): number {
    return THREE.MathUtils.clamp(1 - this.pos.distanceTo(this.player.position) / 12, 0, 1);
  }

  /** 0..1 — how close she is to (or how deep into) a chase, for the HUD eye. */
  get alert(): number {
    if (this.hunting) return 1;
    if (this.state === StalkerState.Investigate) return Math.max(0.35, this.awareness * 0.9);
    return this.awareness * 0.9;
  }

  get attackProgress(): number {
    return this.state === StalkerState.Attack ? this.attackTimer / ATTACK_DURATION : 0;
  }

  headPosition(out: THREE.Vector3): THREE.Vector3 {
    return this.model.headPosition(out);
  }

  reset(node: number): void {
    const p = this.graph.nodes[node].pos;
    this.body.setTranslation({ x: p.x, y: 1, z: p.z }, true);
    this.body.setNextKinematicTranslation({ x: p.x, y: 1, z: p.z });
    this.pos.copy(p);
    this.state = StalkerState.Patrol;
    this.awareness = 0;
    this.canSee = false;
    this.caught = false;
    this.frozen = false;
    this.attackTimer = 0;
    this.searching = false;
    this.speed = 0;
    this.path = [];
    this.pathTarget = null;
    this.instinctTimer = this.tune.senseInterval;
    this.pickPatrolTarget();
    this.waitTimer = START_DELAY;
    this.pose(0);
  }

  update(dt: number): void {
    const t = this.body.translation();
    this.pos.set(t.x, 0, t.z);
    if (this.frozen) {
      this.speed = 0;
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

  private pose(dt: number): void {
    this.model.update(dt, {
      x: this.pos.x,
      z: this.pos.z,
      yaw: this.yaw,
      speed: this.speed,
      reaching: this.hunting,
      lookAt: this.hunting || this.canSee ? this.player.eyePosition : null,
      rage: this.hunting ? 1 : this.awareness * 0.8,
      attack: this.attackProgress,
    });
  }

  // ---- senses -------------------------------------------------------------

  private hear(e: SoundEvent): void {
    if (this.hunting || this.frozen) return;
    const d = e.position.distanceTo(this.pos);
    if (!isAudible(e, this.pos, this.tune.hearing)) return;
    if (this.state === StalkerState.Patrol) this.audio.playGrowl(this.model.headPosition(this.headPos));
    // farther sounds are localised less precisely
    const jitter = d * 0.06;
    this.investigateTarget.set(
      e.position.x + (Math.random() - 0.5) * jitter,
      0,
      e.position.z + (Math.random() - 0.5) * jitter,
    );
    this.state = StalkerState.Investigate;
    this.searching = false;
    this.pathTarget = null;
  }

  private sense(dt: number): void {
    const eye = new THREE.Vector3(this.pos.x, EYE_HEIGHT, this.pos.z);
    const target = this.player.eyePosition;
    const to = target.clone().sub(eye);
    const dist = to.length();

    let visible = false;
    if (this.player.hidden) {
      // a wardrobe only works if she didn't watch you climb in
      visible = this.player.exposed && this.state === StalkerState.Chase;
    } else if (this.state !== StalkerState.Attack) {
      const range =
        (this.flashlight.on ? this.tune.visionLit : this.tune.visionDark) * (this.player.crouching ? 0.65 : 1);
      if (dist < range) {
        const dir = to.clone().divideScalar(dist);
        const inCone = dir.x * Math.sin(this.yaw) + dir.z * Math.cos(this.yaw) > 0.45 || dist < 3;
        if (inCone) {
          const hit = this.physics.world.castRay(
            new RAPIER.Ray(eye, dir), dist, true, undefined, undefined, this.collider,
          );
          visible = !!hit && hit.collider.handle === this.player.collider.handle;
        }
      }
    }
    this.canSee = visible || (this.state === StalkerState.Attack && this.canSee);

    if (visible) {
      this.lastSeen.set(this.player.position.x, 0, this.player.position.z);
      const rate = (dist < 5 ? 3 : dist < 9 ? 1.6 : 0.7) * this.tune.awareness;
      this.awareness = Math.min(1, this.awareness + rate * dt);
    } else {
      this.awareness = Math.max(0, this.awareness - 0.35 * dt);
    }

    if (this.awareness >= 1 && (this.state === StalkerState.Patrol || this.state === StalkerState.Investigate)) {
      this.state = StalkerState.Chase;
      this.lostTimer = 0;
      this.pathTarget = null;
    }
  }

  /** On later nights she periodically drifts toward wherever the player is, heard or not. */
  private instinct(dt: number): void {
    if (this.tune.senseInterval <= 0 || this.state !== StalkerState.Patrol) return;
    this.instinctTimer -= dt;
    if (this.instinctTimer > 0) return;
    this.instinctTimer = this.tune.senseInterval * (0.8 + Math.random() * 0.4);
    const p = this.player.position;
    const a = Math.random() * Math.PI * 2;
    const r = 2 + Math.random() * 3;
    this.investigateTarget.set(p.x + Math.cos(a) * r, 0, p.z + Math.sin(a) * r);
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

  private updateChase(dt: number): number {
    const playerPos = this.player.position;
    const dist = Math.hypot(playerPos.x - this.pos.x, playerPos.z - this.pos.z);
    const reachable = !this.player.hidden || this.player.exposed;
    if (reachable && dist < ATTACK_RANGE && (this.canSee || dist < 1.0)) {
      this.state = StalkerState.Attack;
      this.attackTimer = 0;
      this.caught = false;
      return 0;
    }

    const goal = this.canSee ? new THREE.Vector3(playerPos.x, 0, playerPos.z) : this.lastSeen;
    this.lostTimer = this.canSee ? 0 : this.lostTimer + dt;
    const arrived = this.moveToward(goal, this.tune.chase, dt);
    if (!this.canSee && (arrived || this.lostTimer > this.tune.loseTime)) {
      this.state = StalkerState.Investigate;
      this.investigateTarget.copy(this.lastSeen);
      this.searching = true;
      this.waitTimer = this.tune.searchTime + 0.5;
      this.awareness = 0.3;
      return 0;
    }
    return this.tune.chase;
  }

  private updateAttack(dt: number): void {
    this.attackTimer += dt;
    const p = this.player.position;
    const face = Math.atan2(p.x - this.pos.x, p.z - this.pos.z);
    this.yaw += wrapPi(face - this.yaw) * Math.min(1, dt * 10);
    if (this.attackTimer >= ATTACK_DURATION && !this.caught) {
      this.caught = true;
      this.onCatch();
    }
  }

  // ---- movement -----------------------------------------------------------

  private pickPatrolTarget(): void {
    this.patrolNode = this.graph.randomNode(this.patrolNode);
    this.pathTarget = null;
  }

  /** Walks along an A* path toward `target`. Returns true once it has arrived. */
  private moveToward(target: THREE.Vector3, speed: number, dt: number): boolean {
    this.repathTimer -= dt;
    if (!this.pathTarget || this.repathTimer <= 0 || this.pathTarget.distanceTo(target) > 1.2) {
      this.path = this.graph.findPath(this.pos, target);
      this.pathTarget = target.clone();
      this.repathTimer = 0.7;
    }
    while (this.path.length > 0) {
      const reach = this.path.length === 1 ? 0.6 : 0.45;
      if (Math.hypot(this.path[0].x - this.pos.x, this.path[0].z - this.pos.z) < reach) this.path.shift();
      else break;
    }
    if (this.path.length === 0) return true;

    const next = this.path[0];
    const dx = next.x - this.pos.x;
    const dz = next.z - this.pos.z;
    const len = Math.hypot(dx, dz);
    const want = Math.atan2(dx, dz);
    const turn = wrapPi(want - this.yaw);
    const turnRate = this.state === StalkerState.Chase ? 7 : 4;
    this.yaw += THREE.MathUtils.clamp(turn, -turnRate * dt, turnRate * dt);

    const forward = Math.max(0.15, Math.cos(Math.min(Math.abs(turn), Math.PI / 2)));
    const step = Math.min(speed * forward * dt, len);
    const playerHandle = this.player.collider.handle;
    this.controller.computeColliderMovement(
      this.collider,
      { x: (dx / len) * step, y: -3 * dt, z: (dz / len) * step },
      undefined,
      undefined,
      (c) => c.handle !== playerHandle,
    );
    const m = this.controller.computedMovement();
    const t = this.body.translation();
    this.body.setNextKinematicTranslation({ x: t.x + m.x, y: t.y + m.y, z: t.z + m.z });
    this.pos.set(t.x + m.x, 0, t.z + m.z);
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
      }
    }
    this.stuckTimer = 0;
    this.stuckCheck.copy(this.pos);
  }
}
