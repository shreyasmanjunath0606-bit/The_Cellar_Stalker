import * as THREE from 'three';
import { Physics, RAPIER } from '../core/Physics';
import { Input } from '../core/Input';
import { AudioManager } from '../audio/AudioManager';
import { SoundBus } from '../ai/SoundBus';
import { Stamina } from './Stamina';

const RADIUS = 0.3;
const HALF_HEIGHT = 0.5; // capsule spans 0..1.6 when its centre is at y = 0.8
const EYE_STAND = 0.7; // eye offset from capsule centre
const EYE_CROUCH = 0.2;
const SPEED_WALK = 2.6;
const SPEED_SPRINT = 4.6;
const SPEED_CROUCH = 1.3;
const SENSITIVITY = 0.0022;
const STEP_LENGTH = 1.5;

/** Noise radius (metres) a given movement mode projects, for the AI sound listener. */
export const NOISE_RADIUS = { idle: 0, crouch: 2, walk: 6, sprint: 12 } as const;

export class PlayerController {
  readonly stamina = new Stamina();
  yaw = 0;
  pitch = 0;
  crouching = false;
  noiseRadius = 0;

  readonly collider: RAPIER.Collider;
  /** Horizontally moving this frame. */
  isMoving = false;

  private readonly body: RAPIER.RigidBody;
  private readonly controller: RAPIER.KinematicCharacterController;
  private readonly vel = new THREE.Vector3();
  private vy = 0;
  private eye = EYE_STAND;
  private bobPhase = 0;
  private bobAmp = 0;
  private steps = 0;
  private sprinting = false;

  constructor(
    physics: Physics,
    private readonly camera: THREE.PerspectiveCamera,
    private readonly input: Input,
    private readonly audio: AudioManager,
    private readonly bus: SoundBus,
    spawn: THREE.Vector3,
  ) {
    const world = physics.world;
    this.body = world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(spawn.x, spawn.y, spawn.z),
    );
    this.collider = world.createCollider(RAPIER.ColliderDesc.capsule(HALF_HEIGHT, RADIUS), this.body);
    this.controller = world.createCharacterController(0.01);
    this.controller.setSlideEnabled(true);
    this.controller.enableAutostep(0.3, 0.1, false);
    this.controller.enableSnapToGround(0.15);
    this.controller.setMaxSlopeClimbAngle(Math.PI / 4);
    this.controller.setApplyImpulsesToDynamicBodies(true);
  }

  get position(): THREE.Vector3 {
    const t = this.body.translation();
    return new THREE.Vector3(t.x, t.y, t.z);
  }

  get isSprinting(): boolean {
    return this.sprinting;
  }

  get eyePosition(): THREE.Vector3 {
    const t = this.body.translation();
    return new THREE.Vector3(t.x, t.y + this.eye, t.z);
  }

  teleport(p: THREE.Vector3): void {
    this.body.setTranslation({ x: p.x, y: p.y, z: p.z }, true);
    this.body.setNextKinematicTranslation({ x: p.x, y: p.y, z: p.z });
    this.vel.set(0, 0, 0);
    this.vy = 0;
    this.crouching = false;
  }

  /** Smoothly turns the view toward a world point (used by the catch sequence). */
  lookAt(target: THREE.Vector3, dt: number): void {
    const eye = this.eyePosition;
    const dx = target.x - eye.x;
    const dz = target.z - eye.z;
    const k = 1 - Math.exp(-dt * 8);
    const dyaw = Math.atan2(Math.sin(Math.atan2(-dx, -dz) - this.yaw), Math.cos(Math.atan2(-dx, -dz) - this.yaw));
    this.yaw += dyaw * k;
    this.pitch += (Math.atan2(target.y - eye.y, Math.hypot(dx, dz)) - this.pitch) * k;
  }

  /** Runs before the physics step: reads input, queues the kinematic move. `frozen` ignores input. */
  update(dt: number, frozen = false): void {
    const look = this.input.consumeMouse();
    if (!frozen) {
      this.yaw -= look.x * SENSITIVITY;
      this.pitch = THREE.MathUtils.clamp(this.pitch - look.y * SENSITIVITY, -1.45, 1.45);
      if (this.input.wasPressed('KeyC')) this.crouching = !this.crouching;
    }

    let ix = 0;
    let iz = 0;
    if (!frozen) {
      if (this.input.isDown('KeyW')) iz -= 1;
      if (this.input.isDown('KeyS')) iz += 1;
      if (this.input.isDown('KeyA')) ix -= 1;
      if (this.input.isDown('KeyD')) ix += 1;
    }
    const moving = ix !== 0 || iz !== 0;

    const wantsSprint =
      moving && !this.crouching && (this.input.isDown('ShiftLeft') || this.input.isDown('ShiftRight'));
    this.sprinting = wantsSprint && this.stamina.canSprint;
    this.stamina.update(dt, this.sprinting);

    const speed = this.crouching ? SPEED_CROUCH : this.sprinting ? SPEED_SPRINT : SPEED_WALK;
    const sin = Math.sin(this.yaw);
    const cos = Math.cos(this.yaw);
    const len = Math.hypot(ix, iz) || 1;
    const targetX = ((ix * cos + iz * sin) / len) * speed;
    const targetZ = ((iz * cos - ix * sin) / len) * speed;
    const accel = 1 - Math.exp(-dt * (moving ? 12 : 9));
    this.vel.x += (targetX - this.vel.x) * accel;
    this.vel.z += (targetZ - this.vel.z) * accel;

    this.vy = this.controller.computedGrounded() ? -1 : this.vy - 9.81 * dt;

    this.controller.computeColliderMovement(this.collider, {
      x: this.vel.x * dt,
      y: this.vy * dt,
      z: this.vel.z * dt,
    });
    const m = this.controller.computedMovement();
    const p = this.body.translation();
    this.body.setNextKinematicTranslation({ x: p.x + m.x, y: p.y + m.y, z: p.z + m.z });

    const horizontal = Math.hypot(this.vel.x, this.vel.z);
    this.isMoving = horizontal > 0.3;
    this.noiseRadius =
      horizontal < 0.3
        ? NOISE_RADIUS.idle
        : this.crouching
          ? NOISE_RADIUS.crouch
          : this.sprinting
            ? NOISE_RADIUS.sprint
            : NOISE_RADIUS.walk;
    this.advanceBob(dt, horizontal);
  }

  /** Runs after the physics step: places the camera at the (post-step) body. */
  syncCamera(dt: number): void {
    this.eye += ((this.crouching ? EYE_CROUCH : EYE_STAND) - this.eye) * (1 - Math.exp(-dt * 10));
    const t = this.body.translation();
    const bobY = (Math.abs(Math.sin(this.bobPhase)) - 0.5) * 0.07 * this.bobAmp;
    const bobX = Math.cos(this.bobPhase) * 0.035 * this.bobAmp;
    this.camera.rotation.set(this.pitch, this.yaw, 0);
    this.camera.position.set(t.x, t.y + this.eye + bobY, t.z);
    this.camera.translateX(bobX);
  }

  private advanceBob(dt: number, horizontal: number): void {
    const targetAmp = Math.min(horizontal / SPEED_WALK, 1.6);
    this.bobAmp += (targetAmp - this.bobAmp) * (1 - Math.exp(-dt * 8));
    this.bobPhase += (horizontal * dt * Math.PI) / STEP_LENGTH;

    const steps = Math.floor(this.bobPhase / Math.PI);
    if (steps !== this.steps) {
      this.steps = steps;
      if (horizontal > 0.3) {
        const t = this.body.translation();
        const intensity = this.crouching ? 0.25 : this.sprinting ? 1 : 0.6;
        const foot = new THREE.Vector3(t.x, t.y - 0.7, t.z);
        this.audio.playFootstep(foot, intensity);
        this.bus.emit(foot, this.noiseRadius, 'footstep');
      }
    }
  }
}
