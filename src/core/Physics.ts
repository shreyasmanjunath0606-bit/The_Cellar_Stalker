import RAPIER from '@dimforge/rapier3d-compat';

export { RAPIER };

export class Physics {
  readonly world: RAPIER.World;
  private readonly events = new RAPIER.EventQueue(true);

  private constructor() {
    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  }

  static async create(): Promise<Physics> {
    await RAPIER.init();
    return new Physics();
  }

  addStaticBox(cx: number, cy: number, cz: number, w: number, h: number, d: number): RAPIER.Collider {
    const desc = RAPIER.ColliderDesc.cuboid(w / 2, h / 2, d / 2).setTranslation(cx, cy, cz);
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
}
