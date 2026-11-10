import * as THREE from 'three';
import { Physics, RAPIER } from '../core/Physics';
import { Input } from '../core/Input';
import { PropManager } from '../environment/Props';
import { Pickup, Pickups } from '../environment/Pickups';
import { HideSpot, House } from '../environment/House';
import { Inventory } from './Inventory';
import { PlayerController } from './PlayerController';

const SHOVE_REACH = 2.2;

export interface InteractionEvents {
  onPickup(item: Pickup): void;
  onUnlock(): void;
  /** Return true if a stalker is watching the player right now. */
  isWatched(): boolean;
  onHide(spot: HideSpot, watched: boolean): void;
  onUnhide(): void;
  setPrompt(text: string | null): void;
}

/** E picks things up, hides and unlocks; left click shoves a prop in front of you. */
export class Interaction {
  private readonly dir = new THREE.Vector3();

  constructor(
    private readonly physics: Physics,
    private readonly camera: THREE.Camera,
    private readonly input: Input,
    private readonly player: PlayerController,
    private readonly props: PropManager,
    private readonly pickups: Pickups,
    private readonly inventory: Inventory,
    private readonly house: House,
    private readonly events: InteractionEvents,
  ) {}

  update(): void {
    const use = this.input.wasPressed('KeyE');

    if (this.player.hidden) {
      this.events.setPrompt('E — step out');
      if (use) {
        this.player.unhide();
        this.events.onUnhide();
      }
      return;
    }

    this.camera.getWorldDirection(this.dir);
    const origin = this.camera.position;

    const item = this.pickups.focus(origin, this.dir);
    const spot = item ? null : this.house.focusHideSpot(origin, this.dir);
    let prompt: string | null = null;

    if (item) {
      prompt = `E — take ${item.type}`;
      if (use) {
        this.pickups.collect(item);
        this.events.onPickup(item);
      }
    } else if (spot) {
      prompt = 'E — hide';
      if (use) {
        const watched = this.events.isWatched();
        this.player.hide(spot, watched);
        this.events.onHide(spot, watched);
      }
    } else if (this.house.canInteractDoor(origin, this.dir)) {
      if (this.inventory.hasAllKeys) {
        prompt = 'E — unlock the cellar door';
        if (use) {
          this.house.unlockDoor();
          this.events.onUnlock();
        }
      } else {
        prompt = `LOCKED — ${this.inventory.keys} of ${this.inventory.keysRequired} keys`;
      }
    }
    this.events.setPrompt(prompt);

    if (this.input.wasPressed('Mouse0')) this.shove(origin);
  }

  private shove(origin: THREE.Vector3): void {
    const ray = new RAPIER.Ray(origin, this.dir);
    const hit = this.physics.world.castRay(ray, SHOVE_REACH, true, undefined, undefined, this.player.collider);
    if (!hit) return;
    const prop = this.props.propFromCollider(hit.collider.handle);
    if (!prop) return;
    const point = origin.clone().addScaledVector(this.dir, hit.timeOfImpact);
    this.props.shove(prop, this.dir, point);
  }
}
