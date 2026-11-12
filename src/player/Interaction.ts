import * as THREE from 'three';
import { Physics, RAPIER } from '../core/Physics';
import { Input } from '../core/Input';
import { Prop, PropManager } from '../environment/Props';
import { Item, Items } from '../environment/Items';
import { HideSpot, House } from '../environment/House';
import { Objectives, RouteId, Station } from '../environment/Objectives';
import { Distraction, Distractions } from '../environment/Distractions';
import { Inventory, ITEM_NAMES } from './Inventory';
import { PlayerController } from './PlayerController';

const SHOVE_REACH = 2.2;

export interface InteractionEvents {
  onPickup(item: Item): void;
  onStep(station: Station, index: number): void;
  /** Leave by a finished route (drive away, climb down). */
  onExit(route: RouteId): void;
  onDistract(d: Distraction): void;
  onHide(spot: HideSpot): void;
  onUnhide(): void;
  onShove(prop: Prop, dir: THREE.Vector3, point: THREE.Vector3): void;
  /** Left click: fire a dart if one can be fired. Returns true if the click was used. */
  onFire(origin: THREE.Vector3, dir: THREE.Vector3): boolean;
  /** Another player is already in this hiding place. */
  hideTaken(spot: HideSpot): boolean;
  setPrompt(text: string | null): void;
}

/** E takes, hides, works on the way out and sets off distractions; left click fires a dart or shoves a prop. */
export class Interaction {
  private readonly dir = new THREE.Vector3();

  constructor(
    private readonly physics: Physics,
    private readonly camera: THREE.Camera,
    private readonly input: Input,
    private readonly player: PlayerController,
    private readonly props: PropManager,
    private readonly items: Items,
    private readonly inventory: Inventory,
    private readonly house: House,
    private readonly objectives: Objectives,
    private readonly distractions: Distractions,
    private readonly events: InteractionEvents,
  ) {}

  update(): void {
    const use = this.input.wasPressed('KeyE');

    if (this.player.hidden) {
      this.events.setPrompt('E — come out');
      if (use) {
        this.player.unhide();
        this.events.onUnhide();
      }
      return;
    }

    this.camera.getWorldDirection(this.dir);
    const origin = this.camera.position;
    let prompt: string | null = null;

    const item = this.items.focus(origin, this.dir);
    const station = item ? null : this.objectives.focus(origin, this.dir);
    const noise = item || station ? null : this.distractions.focus(origin, this.dir);
    const spot = item || station || noise ? null : this.house.focusHideSpot(origin, this.dir);

    if (item) {
      prompt = `E — take the ${ITEM_NAMES[item.type]}`;
      if (use) this.events.onPickup(item);
    } else if (station) {
      prompt = this.stationPrompt(station, use);
    } else if (noise) {
      if (this.distractions.ready(noise)) {
        prompt = `E — ${this.distractions.verb(noise)}`;
        if (use) this.events.onDistract(noise);
      } else {
        prompt = noise.left > 0 ? null : 'It needs a moment before it will go again';
      }
    } else if (spot) {
      if (this.events.hideTaken(spot)) {
        prompt = 'Someone is already hiding here';
      } else {
        prompt = spot.kind === 'bed' ? 'E — crawl under the bed' : 'E — hide inside';
        if (use) {
          this.player.hide(spot);
          this.events.onHide(spot);
        }
      }
    }
    this.events.setPrompt(prompt);

    if (this.input.wasPressed('Mouse0') && !this.events.onFire(origin, this.dir)) this.shove(origin);
  }

  private stationPrompt(station: Station, use: boolean): string | null {
    const next = this.objectives.next(station);
    if (!next) {
      const exit = this.objectives.exitVerb(station);
      if (!exit) return null;
      if (use) this.events.onExit(station.route);
      return `E — ${exit}`;
    }
    const blocked = this.objectives.blocked(station);
    if (blocked) return blocked;
    const { step, index } = next;
    const have = this.inventory.count(step.needs);
    if (have >= step.count) {
      if (use) this.events.onStep(station, index);
      return `E — ${step.verb}`;
    }
    const name = ITEM_NAMES[step.needs].toUpperCase();
    return step.count > 1
      ? `LOCKED — needs ${step.count} ${name}S (you have ${have})`
      : `Needs the ${name}`;
  }

  private shove(origin: THREE.Vector3): void {
    const ray = new RAPIER.Ray(origin, this.dir);
    const hit = this.physics.world.castRay(ray, SHOVE_REACH, true, undefined, undefined, this.player.collider);
    if (!hit) return;
    const prop = this.props.propFromCollider(hit.collider.handle);
    if (!prop) return;
    const point = origin.clone().addScaledVector(this.dir, hit.timeOfImpact);
    this.events.onShove(prop, this.dir.clone(), point);
  }
}
