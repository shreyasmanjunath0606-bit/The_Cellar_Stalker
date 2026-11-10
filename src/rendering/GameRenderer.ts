import * as THREE from 'three';
import type { Quality } from '../core/Save';
import { PostProcessing } from './PostProcessing';

const PIXEL_RATIO_CAP: Record<Quality, number> = { low: 1, medium: 1.5, high: 2 };
export const SHADOW_SIZE: Record<Quality, number> = { low: 512, medium: 1024, high: 2048 };

export class GameRenderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly post: PostProcessing;

  private readonly fog = new THREE.FogExp2(0x040506, 0.09);
  private readonly fill = new THREE.HemisphereLight(0x2a3548, 0x0a0806, 0.35);

  constructor(private readonly container: HTMLElement, private quality: Quality) {
    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.25;
    container.appendChild(this.renderer.domElement);

    this.scene.background = new THREE.Color(0x020203);
    this.scene.fog = this.fog;

    this.camera = new THREE.PerspectiveCamera(75, 1, 0.05, 80);
    this.camera.rotation.order = 'YXZ';
    this.scene.add(this.camera);

    // barely-there fill so geometry outside the flashlight cone is not pure black
    this.scene.add(this.fill);

    this.post = new PostProcessing(this.renderer, this.scene, this.camera, quality);
    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  get canvas(): HTMLCanvasElement {
    return this.renderer.domElement;
  }

  setQuality(quality: Quality): void {
    if (quality === this.quality) return;
    this.quality = quality;
    this.post.setQuality(quality);
    this.resize();
  }

  /** Per-night mood: thicker fog and less ambient fill as the nights get worse. */
  setAtmosphere(fogDensity: number, ambient: number): void {
    this.fog.density = fogDensity;
    this.fill.intensity = ambient;
  }

  private resize(): void {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    const pr = Math.min(window.devicePixelRatio, PIXEL_RATIO_CAP[this.quality]);
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h);
    this.post.setSize(w, h, pr);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  render(dt: number, elapsed: number): void {
    this.post.render(dt, elapsed);
  }
}
