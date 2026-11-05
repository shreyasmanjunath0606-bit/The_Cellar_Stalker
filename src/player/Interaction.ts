import * as THREE from 'three';
import { Physics, RAPIER } from '../core/Physics';
import { Input } from '../core/Input';
import { AudioManager } from '../audio/AudioManager';
import { PropManager } from '../environment/Props';
import { Pickups } from '../environment/Pickups';
import { House } from '../environment/House';
import { SoundBus } from '../ai/SoundBus';
import { Inventory } from './Inventory';
import { Flashlight } from './Flashlight';
import { PlayerController } from './PlayerController';
import { HUD } from '../ui/HUD';

const SHOVE_REACH = 2.2;
const BATTERY_CHARGE = 50;

/** E picks things up, left click shoves a prop in front of you. */
export class Interaction {
  private readonly dir = new THREE.Vector3();

  constructor(
    private readonly physics: Physics,
    private readonly camera: THREE.Camera,
    private readonly input: Input,
    private readonly audio: AudioManager,
    private readonly player: PlayerController,
    private readonly props: PropManager,
    private readonly pickups: Pickups,
    private readonly inventory: Inventory,
    private readonly flashlight: Flashlight,
    private readonly hud: HUD,
    private readonly house: House,
    private readonly bus: SoundBus,
  ) {}

  update(): void {
    this.camera.getWorldDirection(this.dir);
    const origin = this.camera.position;

    const focus = this.pickups.focus(origin, this.dir);
    let prompt = focus ? `E — take ${focus.type}` : null;
    if (!focus && this.house.canInteractDoor(origin, this.dir)) {
      if (this.inventory.hasAllKeys) {
        prompt = 'E — unlock cellar door';
        if (this.input.wasPressed('KeyE')) {
          this.house.unlockDoor();
          const doorPos = new THREE.Vector3(0, 1, 5);
          this.audio.playImpact(doorPos, 0.8, true);
          this.audio.playDoorOpen(doorPos);
          this.bus.emit(doorPos, 22, 'prop'); // the grinding door carries through the whole cellar
        }
      } else {
        prompt = `CELLAR DOOR LOCKED — KEYS ${this.inventory.keys}/${this.inventory.keysRequired}`;
      }
    }
    this.hud.setPrompt(prompt);
    if (focus && this.input.wasPressed('KeyE')) {
      this.pickups.collect(focus);
      if (focus.type === 'key') {
        this.inventory.keys++;
        this.hud.setKeys(this.inventory.keys, this.inventory.keysRequired);
      } else {
        this.inventory.batteries++;
        this.flashlight.addBattery(BATTERY_CHARGE);
      }
      this.audio.playPickup();
    }

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
