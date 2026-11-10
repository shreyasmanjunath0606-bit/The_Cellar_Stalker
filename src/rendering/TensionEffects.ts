import * as THREE from 'three';
import { PostProcessing } from './PostProcessing';

const BASE_FOV = 75;

export interface Mood {
  /** 0..1 — stalker proximity / line of sight. */
  fear: number;
  /** 0..1 — progress through the catch sequence. */
  jump: number;
  /** 0..1 — decaying spike on each heartbeat. */
  pulse: number;
  /** 0..1 — black-out amount (level fade-in). */
  fade: number;
  /** Peering out of a wardrobe: tighter, darker frame. */
  hidden: boolean;
}

/**
 * Maps fear and the jumpscare onto the post-processing uniforms, camera shake
 * and field of view.
 */
export class TensionEffects {
  constructor(
    private readonly post: PostProcessing,
    private readonly camera: THREE.PerspectiveCamera,
  ) {}

  /** Call after the camera has been positioned for the frame. */
  update(elapsed: number, m: Mood): void {
    const { fear, jump } = m;
    const u = this.post.uniforms;
    u.aberration.value = 0.0012 + fear * 0.0055 + jump * 0.02;
    u.vignette.value = Math.min(1, (m.hidden ? 0.9 : 0.8) + fear * 0.2 + jump * 0.15);
    u.grain.value = 0.05 + fear * 0.08 + jump * 0.2;
    u.distortion.value = jump * jump * 1.4;
    u.fear.value = fear;
    u.pulse.value = m.pulse;
    u.glitch.value = Math.min(1, jump * 1.6);
    u.fade.value = m.fade;

    const amp = fear * fear * 0.03 + jump * 0.05;
    if (amp > 0.0005) {
      const t = elapsed;
      this.camera.position.x += (Math.sin(t * 43) + Math.sin(t * 71.3)) * 0.5 * amp;
      this.camera.position.y += (Math.sin(t * 51) + Math.sin(t * 67.9)) * 0.5 * amp;
      this.camera.rotation.z = Math.sin(t * 37) * amp * 0.6;
    }

    // slow creep inward with fear, then a violent zoom as the jumpscare lands
    const fov = BASE_FOV - fear * 4 - jump * jump * jump * 45;
    if (Math.abs(this.camera.fov - fov) > 0.01) {
      this.camera.fov += (fov - this.camera.fov) * 0.25;
      this.camera.updateProjectionMatrix();
    }
  }

  reset(): void {
    this.camera.fov = BASE_FOV;
    this.camera.updateProjectionMatrix();
    this.update(0, { fear: 0, jump: 0, pulse: 0, fade: 0, hidden: false });
  }
}
