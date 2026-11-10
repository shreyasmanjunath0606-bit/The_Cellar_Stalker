import RAPIER from '@dimforge/rapier3d-compat';

export { RAPIER };

/** One Rapier world per level. Call `Physics.init()` once before constructing any. */
export class Physics {
  private static ready: Promise<void> | null = null;

  readonly world: RAPIER.World;
  private readonly events: RAPIER.EventQueue;

  constructor() {
    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    this.events = new RAPIER.EventQueue(true);
  }

  static init(): Promise<void> {
    return (Physics.ready ??= RAPIER.init());
  }

  addStaticBox(cx: number, cy: number, cz: number, w: number, h: number, d: number): RAPIER.Collider {
    const desc = RAPIER.ColliderDesc.cuboid(w / 2, h / 2, d / 2).setTranslation(cx, cy, cz);
    return this.world.createCollider(desc);
  }

  addStaticCylinder(cx: number, cy: number, cz: number, radius: number, h: number): RAPIER.Collider {
    const desc = RAPIER.ColliderDesc.cylinder(h / 2, radius).setTranslation(cx, cy, cz);
    return this.world.createCollider(desc);
  }

  step(dt: number): void {
    this.world.timestep = dt;
    this.world.step(this.events);
  }

  /** Collision start/stop events from the last step, for colliders with COLLISION_EVENTS enabled. */
  drainCollisions(cb: (collider1: number, collider2: number, started: boolean) => void): void {
    this.events.drainCollisionEvents(cb);
  }

  dispose(): void {
    this.events.free();
    this.world.free();
  }
}
