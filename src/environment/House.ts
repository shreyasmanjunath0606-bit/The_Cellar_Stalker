import * as THREE from 'three';
import { Physics } from '../core/Physics';
import { LevelConfig } from '../core/Levels';
import { Materials } from '../rendering/Materials';
import { FLOOR_H, HideSpot, HouseKit, WALL_HEIGHT } from './HouseKit';

export { FLOOR_H, WALL_HEIGHT } from './HouseKit';
export type { HideSpot } from './HouseKit';

/**
 * Granny's house: two storeys and a garage, built procedurally.
 *
 *   GROUND (y = 0)                                 UPSTAIRS (y = 3)
 *                    z-                                             z-
 *   [ kitchen ][  dining  ][ library* ]            [ her room ][ bathroom ][ nursery* ]
 *   [==========  corridor  ===========]            [==========  corridor  ============]
 *   [ living  ][  hall^   ][  study   ][ garage ]  [ guest (start) ][ landing^ ][ master ]
 *              front door               car door                                 balcony
 *                    z+
 *
 *   ^ main stairs along the west wall of the hall     * back stairs along the north wall
 */
export class House extends HouseKit {
  /** Where each player wakes up (the guest bedroom upstairs). */
  readonly spawns: THREE.Vector3[] = [
    [-8.2, 4.2], [-9.4, 5.6], [-7.2, 6.0], [-9.8, 2.6], [-7.0, 2.4],
  ].map(([x, z]) => new THREE.Vector3(x, FLOOR_H + 0.86, z));
  private readonly to = new THREE.Vector3();

  constructor(physics: Physics, mats: Materials, cfg: LevelConfig) {
    super(physics, mats, cfg);
    this.buildGround();
    this.buildUpper();
    this.buildOutside();
    this.flush();
  }

  /** The hiding place the player is standing at and looking at, if any. */
  focusHideSpot(origin: THREE.Vector3, dir: THREE.Vector3): HideSpot | null {
    for (const s of this.hideSpots) {
      const to = this.to.copy(s.door).sub(origin);
      const dist = to.length();
      if (dist < (s.kind === 'bed' ? 2.3 : 2.1) && to.divideScalar(dist).dot(dir) > 0.72) return s;
    }
    return null;
  }

  update(elapsed: number, dt: number, eye: THREE.Vector3): void {
    this.updateLamps(elapsed, dt, eye);
  }

  // ---- ground floor -------------------------------------------------------

  private buildGround(): void {
    const m = this.mats;
    const { brick, plaster, floorboards, tile, concrete, stone, trim, crate, metal, enamel, black } = m;
    const P = m.paper;
    this.y0 = 0;

    // ---- shell and partitions ----
    this.room = 'g-walls';
    this.wall('x', -11, -14.15, -5, [], brick, plaster);
    this.wall('x', -11, -5, 5, [], brick, P.red);
    this.wall('x', -11, 5, 14.15, [], brick, P.green);
    this.wall('x', 9, -14.15, -5, [], P.blue, brick);
    this.wall('x', 9, -5, 5, [[-0.8, 0.8]], P.beige, brick);
    this.wall('x', 9, 5, 14, [], P.brown, brick);
    this.wall('x', 9, 14, 22.15, [[16.2, 19.8]], brick, brick);
    this.wall('z', -14, -11, -4, [], brick, plaster);
    this.wall('z', -14, -4, -1, [], brick, P.beige);
    this.wall('z', -14, -1, 9, [], brick, P.blue);
    this.wall('z', 14, -11, -4, [], P.green, brick);
    this.wall('z', 14, -4, -1, [], P.beige, brick);
    this.wall('z', 14, -1, 9, [[3, 4.4]], P.brown, brick);
    this.wall('x', -1, 14.15, 22.15, [], brick, brick);
    this.wall('z', 22, -1, 9, [], brick, brick);
    this.wall('x', -4, -14, -5, [[-10.2, -8.8]], plaster, P.beige);
    this.wall('x', -4, -5, 5, [[-0.7, 0.7]], P.red, P.beige);
    this.wall('x', -4, 5, 14, [[8.8, 10.2]], P.green, P.beige);
    this.wall('x', -1, -14, -5, [[-10.2, -8.8]], P.beige, P.blue);
    this.wall('x', -1, -5, 5, [[-1.5, 1.5]], P.beige, P.beige);
    this.wall('x', -1, 5, 14, [[8.8, 10.2]], P.beige, P.brown);
    this.wall('z', -5, -11, -4, [[-8.2, -6.8]], plaster, P.red);
    this.wall('z', 5, -11, -4, [[-8.2, -6.8]], P.red, P.green);
    this.wall('z', -5, -1, 9, [[7.5, 8.9]], P.blue, P.beige);
    this.wall('z', 5, -1, 9, [[3.3, 4.7]], P.beige, P.brown);

    // ---- kitchen ----
    this.room = 'kitchen';
    this.slab(-14, -5, -11, -4, tile);
    {
      // worktop along the north wall with a sink and a range
      const k = this.kit(-10.9, -10.55);
      k.box(5.8, 0.86, 0.6, 0, 0.43, 0, crate);
      k.box(5.9, 0.06, 0.66, 0, 0.89, 0, stone);
      for (let i = 0; i < 7; i++) k.box(0.7, 0.66, 0.02, -2.5 + i * 0.82, 0.45, 0.31, trim);
      k.box(0.8, 0.04, 0.42, -1.2, 0.905, 0, metal);
      k.cyl(0.015, 0.28, -1.2, 1.05, -0.2, metal);
      k.box(0.86, 0.9, 0.62, 2.3, 0.46, 0.01, black); // range
      for (const [bx, bz] of [[-0.2, -0.14], [0.2, -0.14], [-0.2, 0.14], [0.2, 0.14]]) {
        k.cyl(0.09, 0.02, 2.3 + bx, 0.93, bz, metal);
      }
      // wall cupboards
      k.box(3.2, 0.6, 0.32, -1.0, 1.85, -0.13, crate);
      this.solid(-10.9, 0.46, -10.55, 5.9, 0.92, 0.66);
    }
    this.box(-13.45, 0.95, -9.2, 0.8, 1.9, 0.8, enamel); // refrigerator
    this.box(-13.03, 1.2, -9.2, 0.03, 0.5, 0.05, metal, { collide: false });
    this.table(-10, -7, 1.6, 1.0);
    this.wardrobe(-13.5, -5.5, 'x+');
    this.crateBox(-5.75, -4.75, 0.8);
    this.lamp(-9.5, -7.5, 30, 0xffb070);
    this.window(-11, -10.85, 'z+');
    this.decal(m.blood[0], -7.5, -6, 1.5, 'floor');

    // ---- dining room ----
    this.room = 'dining';
    this.slab(-5, 5, -11, -4, floorboards);
    this.table(0, -7.5, 3.2, 1.2);
    this.rug(0, -7.5, 4.4, 2.6, m.carpet.red);
    {
      // fireplace on the north wall, embers still glowing
      const k = this.kit(0, -10.6);
      for (const sx of [-1, 1]) k.box(0.36, 1.2, 0.5, sx * 0.72, 0.6, 0, stone);
      k.box(1.8, 0.3, 0.5, 0, 1.35, 0, stone);
      k.box(2.1, 0.07, 0.62, 0, 1.53, 0.04, trim);
      k.box(1.08, 1.2, 0.06, 0, 0.6, -0.2, black);
      k.box(1.3, 1.25, 0.5, 0, 2.17, 0, brick);
      for (let i = 0; i < 3; i++) k.cyl(0.05, 0.6, -0.1 + i * 0.1, 0.08 + (i % 2) * 0.07, 0.02, black, 'x');
      this.solid(0, 0.78, -10.6, 1.8, 1.56, 0.5);
      this.point(0, 0.22, -10.45, 7, 0xff5a20, 'candle');
    }
    this.clock(-4.5, -10.5, 'z+');
    this.wardrobe(4.5, -5.2, 'x-');
    this.dresser(-4.6, -5.2, 'x+', 1.3, 0.9, 0.45);
    this.picture(-2.6, -10.84, 'z+');
    this.picture(2.6, -10.84, 'z+');
    this.lamp(0, -7.2, 32, 0xffa860);
    this.decal(m.blood[1], 2.6, -5.4, 1.3, 'floor');

    // ---- library (back stairs run up along its north wall) ----
    this.room = 'library';
    this.slab(5, 14, -11, -4, floorboards, { ceil: false });
    for (const [x0, x1, z0, z1] of [[5, 6.9, -11, -4], [12.3, 14, -11, -4], [6.9, 12.3, -9.5, -4]]) {
      this.slab(x0, x1, z0, z1, floorboards, { floor: false });
    }
    this.wall('x', -9.35, 6.75, 12.3, [], P.green, P.green);
    this.wall('z', 6.9, -10.85, -9.2, [], P.green, P.green);
    this.stairs(12.3, -10.18, 'x-', 5.4, 1.34);
    this.bookshelf(8.2, -9.0, 'z+', 2.2);
    this.bookshelf(10.6, -9.0, 'z+', 2.2);
    this.bookshelf(13.65, -6.7, 'x-', 2.4);
    this.table(11.6, -5.5, 1.2, 0.8);
    this.wardrobe(5.52, -5.2, 'x+');
    this.rug(9.3, -6.4, 3, 2.2, m.carpet.green);
    this.crateBox(5.75, -10.3, 0.7);
    this.lamp(9.5, -6.6, 30, 0xe8a870);
    this.window(13.85, -8.6, 'x-');

    // ---- corridor ----
    this.room = 'corridor';
    this.slab(-14, 14, -4, -1, floorboards);
    this.rug(0, -2.5, 25, 1.3, m.carpet.red);
    this.wardrobe(13.5, -2.5, 'x-');
    this.table(-13.5, -2.5, 0.6, 1.2, 0.78);
    this.picture(-3, -3.84, 'z+', 0.6, 0.8);
    this.picture(3, -1.16, 'z-', 0.6, 0.8);
    this.picture(7, -3.84, 'z+', 0.9, 0.6);
    this.picture(-7, -1.16, 'z-', 0.9, 0.6);
    this.lamp(-7, -2.5, 24, 0xffa860);
    this.lamp(7, -2.5, 24, 0xffa860);
    this.decal(m.text('SHE LISTENS'), 2.6, -3.84, 2.2, 'z+', 1.5);
    this.decal(m.blood[2], -3.2, -2.6, 1.2, 'floor');

    // ---- living room ----
    this.room = 'living';
    this.slab(-14, -5, -1, 9, floorboards);
    this.sofa(-13.35, 4, 'x+', 2.2);
    this.table(-11.3, 4, 0.7, 1.2, 0.45);
    this.rug(-10.6, 4, 3.4, 4, m.carpet.blue);
    this.dresser(-5.42, 3.5, 'x-', 1.6, 0.9, 0.5);
    this.sofa(-11.5, 7.7, 'z-', 0.95, m.fabric.wine);
    {
      // upright piano on the south wall
      const k = this.kit(-9.4, 8.5, Math.PI);
      k.box(1.5, 1.25, 0.5, 0, 0.625, 0, trim);
      k.box(1.5, 0.08, 0.3, 0, 0.74, 0.36, trim);
      k.box(1.36, 0.02, 0.2, 0, 0.79, 0.38, enamel);
      for (let i = 0; i < 9; i++) k.box(0.05, 0.022, 0.12, -0.6 + i * 0.15, 0.8, 0.345, black);
      for (const sx of [-1, 1]) k.box(0.08, 0.7, 0.08, sx * 0.68, 0.35, 0.44, trim);
      this.solid(-9.4, 0.63, 8.4, 1.5, 1.26, 0.7);
    }
    this.wardrobe(-13.5, 0, 'x+');
    this.window(-13.85, 6.8, 'x+');
    this.window(-12, 8.85, 'z-');
    this.picture(-5.16, 1, 'x-', 0.9, 0.7);
    this.lamp(-9.5, 4, 32, 0xff9a50);
    this.decal(m.blood[0], -8, 6.2, 1.4, 'floor');

    // ---- entrance hall (main stairs run up along its west wall) ----
    this.room = 'hall';
    this.slab(-5, 5, -1, 9, tile, { ceil: false });
    for (const [x0, x1, z0, z1] of [[-5, 5, -1, 1], [-3.5, 5, 1, 7], [-5, 5, 7, 9]]) {
      this.slab(x0, x1, z0, z1, tile, { floor: false });
    }
    this.wall('z', -3.35, 1, 7, [], P.beige, P.beige);
    this.wall('x', 1, -4.85, -3.2, [], P.beige, P.beige);
    this.stairs(-4.18, 7, 'z-', 6, 1.34);
    this.clock(-2.9, 4, 'x+');
    this.table(4.55, 7, 0.5, 1.4, 0.85);
    this.wardrobe(4.5, 0.2, 'x-');
    this.rug(0, 5, 2.4, 5, m.carpet.red);
    this.picture(-3.19, 2.4, 'x+', 0.8, 1.0);
    this.picture(4.84, 1.9, 'x-', 0.7, 0.9);
    this.lamp(0.6, 4, 40, 0xffa860);
    this.decal(m.text('NO WAY OUT'), 2.9, 8.84, 2.2, 'z-', 1.6);
    this.decal(m.blood[1], 0.6, 7.2, 1.3, 'floor');

    // ---- study ----
    this.room = 'study';
    this.slab(5, 14, -1, 9, floorboards);
    this.table(9.5, 8.35, 1.8, 0.8);
    this.bookshelf(5.36, 7, 'x+', 2);
    this.table(12.5, -0.42, 2.0, 0.75, 0.9, crate);
    this.wardrobe(13.5, 7.5, 'x-');
    this.rug(9.5, 4.2, 3, 3, m.carpet.green);
    this.crateBox(13.4, 0.9, 0.8);
    this.picture(7.4, -0.84, 'z+', 1.0, 0.7);
    this.window(11.5, 8.85, 'z-');
    this.lamp(9.5, 3.8, 30, 0xff9050);
    this.decal(m.blood[2], 11.4, 2.2, 1.3, 'floor');

    // ---- garage ----
    this.room = 'garage';
    this.slab(14, 22, -1, 9, concrete);
    this.shelf(18, -0.62, 'z+');
    this.shelf(20.2, -0.62, 'z+');
    this.barrel(21.3, 0.4);
    this.barrel(21.2, 1.4);
    this.table(21.5, 5.6, 0.75, 2.0, 0.9, crate);
    this.wardrobe(14.5, 8.2, 'x+');
    this.crateBox(14.65, -0.35, 0.9);
    this.crateBox(15.6, -0.4, 0.8);
    this.crateBox(14.7, -0.3, 0.7, 0.9);
    this.lamp(18.5, 4, 34, 0xcfd8e8);
    this.decal(m.blood[0], 16, 2, 1.6, 'floor');
    this.decal(m.text('HIDE'), 21.84, 3, 1.3, 'x-', 1.5);
  }

  // ---- upper floor --------------------------------------------------------

  private buildUpper(): void {
    const m = this.mats;
    const { brick, plaster, floorboards, tile, trim, enamel, metal, crate } = m;
    const P = m.paper;
    this.y0 = FLOOR_H;

    this.room = 'u-walls';
    this.wall('x', -11, -14.15, -5, [], brick, P.purple);
    this.wall('x', -11, -5, 5, [], brick, plaster);
    this.wall('x', -11, 5, 14.15, [], brick, P.yellow);
    this.wall('x', 9, -14.15, -5, [], P.green, brick);
    this.wall('x', 9, -5, 5, [], P.beige, brick);
    this.wall('x', 9, 5, 14.15, [[8.8, 10.2]], P.red, brick);
    this.wall('z', -14, -11, -4, [], brick, P.purple);
    this.wall('z', -14, -4, -1, [], brick, P.beige);
    this.wall('z', -14, -1, 9, [], brick, P.green);
    this.wall('z', 14, -11, -4, [], P.yellow, brick);
    this.wall('z', 14, -4, -1, [], P.beige, brick);
    this.wall('z', 14, -1, 9, [], P.red, brick);
    this.wall('x', -4, -14, -5, [[-10.2, -8.8]], P.purple, P.beige);
    this.wall('x', -4, -5, 5, [[-0.7, 0.7]], plaster, P.beige);
    this.wall('x', -4, 5, 14, [[8.8, 10.2]], P.yellow, P.beige);
    this.wall('x', -1, -14, -5, [[-10.2, -8.8]], P.beige, P.green);
    this.wall('x', -1, -5, 5, [[-1.5, 1.5]], P.beige, P.beige);
    this.wall('x', -1, 5, 14, [[8.8, 10.2]], P.beige, P.red);
    this.wall('z', -5, -11, -4, [[-8.2, -6.8]], P.purple, plaster);
    this.wall('z', 5, -11, -4, [], plaster, P.yellow);
    this.wall('z', -5, -1, 9, [], P.green, P.beige);
    this.wall('z', 5, -1, 9, [[3.3, 4.7]], P.beige, P.red);

    // ---- her bedroom ----
    this.room = 'granny';
    this.slab(-14, -5, -11, -4, floorboards);
    this.rug(-9.5, -7.4, 5, 3.4, m.carpet.red);
    this.bed(-11, -9.75, 'z+', m.fabric.wine);
    this.wardrobe(-13.5, -6, 'x+');
    this.dresser(-13.58, -8.9, 'x+', 1.3, 0.9, 0.5);
    this.sofa(-6.2, -10.1, 'z+', 0.95, m.fabric.wine);
    for (const dz of [-0.58, -0.5, 0.56]) this.candle(-13.55, 0.94, -8.9 + dz);
    this.picture(-8, -10.84, 'z+', 0.9, 1.1);
    this.window(-13.85, -7.4, 'x+');
    this.lamp(-9.5, -7.2, 22, 0xff7a50);
    this.decal(m.blood[0], -8.2, -6, 1.6, 'floor');
    this.decal(m.text('MINE'), -5.16, -9.8, 1.3, 'x-', 1.5);

    // ---- bathroom ----
    this.room = 'bath';
    this.slab(-5, 5, -11, -4, tile);
    {
      const k = this.kit(2.4, -10.4);
      k.box(1.9, 0.6, 0.85, 0, 0.3, 0, enamel);
      k.box(1.66, 0.04, 0.62, 0, 0.59, 0, m.black);
      k.cyl(0.02, 0.3, -0.8, 0.75, -0.3, metal);
      this.solid(2.4, 0.33, -10.4, 1.9, 0.66, 0.85);
    }
    {
      const k = this.kit(4.5, -5.6, -Math.PI / 2);
      k.box(0.42, 0.42, 0.55, 0, 0.21, 0.05, enamel);
      k.box(0.46, 0.75, 0.2, 0, 0.6, -0.25, enamel);
      this.solid(4.5, 0.5, -5.6, 0.75, 1.0, 0.5);
    }
    {
      const k = this.kit(4.6, -8.6, -Math.PI / 2);
      k.box(0.6, 0.14, 0.45, 0, 0.84, 0, enamel);
      k.box(0.12, 0.78, 0.12, 0, 0.39, -0.05, enamel);
      k.box(0.5, 0.7, 0.03, 0, 1.6, -0.2, metal); // mirror
      this.solid(4.6, 0.46, -8.6, 0.5, 0.92, 0.6);
    }
    this.wardrobe(-4.5, -5.1, 'x+');
    this.window(-1.5, -10.85, 'z+', 0.9);
    this.lamp(0, -7.5, 30, 0xcfe0e8);
    this.decal(m.blood[1], 1.4, -8.6, 1.5, 'floor');
    this.decal(m.blood[2], -2.2, -6, 1.1, 'floor');

    // ---- nursery (top of the back stairs) ----
    this.room = 'nursery';
    this.slab(5, 14, -11, -4, floorboards, { floor: false });
    for (const [x0, x1, z0, z1] of [[5, 6.9, -11, -4], [12.3, 14, -11, -4], [6.9, 12.3, -9.5, -4]]) {
      this.slab(x0, x1, z0, z1, floorboards, { ceil: false });
    }
    this.banister('x', -9.42, 6.9, 12.42);
    this.banister('z', 12.36, -10.85, -9.4);
    this.bed(12.8, -6.5, 'x-', m.fabric.navy);
    this.wardrobe(5.52, -5.2, 'x+');
    this.table(13.4, -8.5, 0.6, 0.9, 0.7);
    this.crateBox(7.4, -4.6, 0.6);
    this.rug(9.3, -6.6, 3, 2.4, m.carpet.blue);
    {
      // rocking horse, long abandoned
      const k = this.kit(11.2, -4.95, 1.4);
      k.box(0.2, 0.26, 0.7, 0, 0.5, 0, crate);
      k.box(0.14, 0.34, 0.16, 0, 0.74, 0.36, crate, -0.5);
      for (const sx of [-1, 1]) k.box(0.05, 0.05, 1.0, sx * 0.14, 0.06, 0, trim);
      for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) k.box(0.04, 0.4, 0.04, sx * 0.1, 0.24, sz * 0.26, crate);
      this.solid(11.2, 0.4, -4.95, 0.9, 0.8, 0.5);
    }
    this.window(13.85, -8.3, 'x-', 0.9);
    this.lamp(9.5, -6.8, 26, 0xffd090);
    this.decal(m.text('COME PLAY'), 9.5, -4.16, 2.0, 'z-', 1.5);

    // ---- upstairs corridor ----
    this.room = 'u-corridor';
    this.slab(-14, 14, -4, -1, floorboards);
    this.rug(0, -2.5, 25, 1.3, m.carpet.green);
    this.table(13.5, -2.5, 0.6, 1.2, 0.78);
    this.picture(-6, -3.84, 'z+', 0.6, 0.8);
    this.picture(6, -1.16, 'z-', 0.6, 0.8);
    this.picture(-12, -1.16, 'z-', 0.8, 0.6);
    this.window(-13.85, -2.5, 'x+', 0.9);
    this.lamp(-7, -2.5, 22, 0xffa860);
    this.lamp(7, -2.5, 22, 0xffa860);
    this.decal(m.blood[0], 4.2, -2.4, 1.2, 'floor');

    // ---- guest bedroom: where everyone wakes up ----
    this.room = 'guest';
    this.slab(-14, -5, -1, 9, floorboards);
    this.bed(-12.78, 4, 'x+', m.fabric.moss);
    this.wardrobe(-13.5, 8, 'x+');
    this.table(-5.55, 5, 0.6, 1.4, 0.78);
    this.rug(-9, 4.4, 3.4, 3.6, m.carpet.green);
    this.dresser(-9.5, 8.58, 'z-', 1.3, 0.9, 0.5);
    this.window(-13.85, 1, 'x+');
    this.window(-7.5, 8.85, 'z-');
    this.picture(-5.16, 1.6, 'x-');
    this.lamp(-9, 4, 30, 0xffb070);
    this.decal(m.text("DON'T MAKE A SOUND"), -9.4, -0.84, 2.8, 'z+', 1.55);

    // ---- landing (top of the main stairs) ----
    this.room = 'landing';
    this.slab(-5, 5, -1, 9, floorboards, { floor: false });
    for (const [x0, x1, z0, z1] of [[-5, 5, -1, 1], [-3.5, 5, 1, 7], [-5, 5, 7, 9]]) {
      this.slab(x0, x1, z0, z1, floorboards, { ceil: false });
    }
    this.banister('z', -3.42, 1, 7.1);
    this.banister('x', 7.06, -4.85, -3.37);
    this.sofa(0.6, 8.35, 'z-', 2.2, m.fabric.navy);
    this.table(4.55, 7.4, 0.5, 1.0, 0.8);
    this.wardrobe(4.5, 0.2, 'x-');
    this.rug(0.8, 4, 2.6, 4.4, m.carpet.red);
    this.picture(4.84, 1.9, 'x-', 0.7, 0.9);
    this.picture(-1.5, 8.84, 'z-', 0.7, 0.9, 1.9);
    this.lamp(0.8, 4, 30, 0xffa860);
    this.decal(m.blood[2], 1.5, 1.2, 1.2, 'floor');

    // ---- master bedroom (door to the balcony) ----
    this.room = 'master';
    this.slab(5, 14, -1, 9, floorboards);
    this.bed(12.78, 4.5, 'x-', m.fabric.wine);
    this.wardrobe(5.52, 7.5, 'x+');
    this.dresser(12.4, -0.56, 'z+', 1.6, 0.9, 0.5);
    this.rug(9.4, 4.2, 3.2, 3.6, m.carpet.red);
    this.sofa(6.9, 0.2, 'z+', 0.95, m.fabric.cream);
    this.window(13.85, 1.4, 'x-');
    this.window(12.2, 8.85, 'z-', 0.9);
    this.picture(7, 8.84, 'z-', 0.8, 0.6);
    this.lamp(9.5, 4, 28, 0xff9a60);
    this.decal(m.blood[1], 8.2, 6.4, 1.3, 'floor');
    void trim;
  }

  // ---- outside ------------------------------------------------------------

  private buildOutside(): void {
    const { concrete, brick, metal } = this.mats;
    this.room = 'outside';
    this.y0 = 0;
    // garage roof
    // (the garage is single-storey; its ceiling slab is all there is above it)
    for (const [x0, x1] of [[-1.6, 1.6], [16.2, 19.8]]) this.porch(x0, x1);

    // balcony off the master bedroom
    this.y0 = FLOOR_H;
    this.slab(7, 12, 9.15, 11, concrete, { ceil: false });
    this.banister('x', 10.95, 7, 12);
    this.banister('z', 7.05, 9.15, 11);
    this.banister('z', 11.95, 9.15, 11);
    void brick;
    void metal;

    // a cold moon, far away over the front garden
    const moon = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: this.mats.glow, color: new THREE.Color(0xbfd2ff).multiplyScalar(2.2), fog: false,
        transparent: true, depthWrite: false,
      }),
    );
    moon.position.set(24, 26, 56);
    moon.scale.setScalar(13);
    this.group.add(moon);
  }

  /** A short walled path beyond an outside door, ending in open moonlight. */
  private porch(x0: number, x1: number): void {
    const { concrete, brick } = this.mats;
    const cx = (x0 + x1) / 2;
    this.slab(x0, x1, 9.15, 12.2, concrete);
    this.wall('z', x0 - 0.15, 9.15, 12.2, [], brick, brick);
    this.wall('z', x1 + 0.15, 9.15, 12.2, [], brick, brick);
    this.solid(cx, WALL_HEIGHT / 2, 12.2, x1 - x0, WALL_HEIGHT, 0.3);
    const glow = new THREE.Mesh(
      new THREE.PlaneGeometry(x1 - x0, 2.6),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(0xdfe9ff).multiplyScalar(3.2), fog: false }),
    );
    glow.position.set(cx, 1.3, 12.0);
    glow.rotation.y = Math.PI;
    this.group.add(glow);
    this.point(cx, WALL_HEIGHT - 0.4, 10.6, 16, 0xaac8ff, 'exit');
  }
}
