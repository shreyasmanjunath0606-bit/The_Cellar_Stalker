import * as THREE from 'three';

export type SoundSource = 'footstep' | 'prop' | 'shatter' | 'floorboard' | 'distraction' | 'work';

export interface SoundEvent {
  position: THREE.Vector3;
  /** Metres within which a listener with normal hearing registers the sound. */
  radius: number;
  source: SoundSource;
}

type Listener = (event: SoundEvent) => void;

/** Broadcasts acoustic events; the stalker subscribes to learn where noise happened. */
export class SoundBus {
  private listeners: Listener[] = [];

  subscribe(fn: Listener): () => void {
    this.listeners.push(fn);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== fn);
    };
  }

  emit(position: THREE.Vector3, radius: number, source: SoundSource): void {
    const event: SoundEvent = { position: position.clone(), radius, source };
    for (const l of this.listeners) l(event);
  }
}

export function isAudible(event: SoundEvent, listener: THREE.Vector3, hearing = 1): boolean {
  return event.position.distanceTo(listener) <= event.radius * hearing;
}
