import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import type { Quality } from '../core/Save';

/**
 * The final look: lens distortion, chromatic aberration, a cold colour grade that
 * drains with fear, heartbeat-red edges, jumpscare glitch tearing, vignette and grain.
 */
const HorrorShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    time: { value: 0 },
    vignette: { value: 0.85 },
    grain: { value: 0.1 },
    aberration: { value: 0.0012 },
    distortion: { value: 0 },
    fear: { value: 0 },
    pulse: { value: 0 },
    glitch: { value: 0 },
    fade: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float time;
    uniform float vignette;
    uniform float grain;
    uniform float aberration;
    uniform float distortion;
    uniform float fear;
    uniform float pulse;
    uniform float glitch;
    uniform float fade;
    varying vec2 vUv;

    float hash(vec2 p) {
      p = fract(p * vec2(123.34, 456.21));
      p += dot(p, p + 45.32);
      return fract(p.x * p.y);
    }

    void main() {
      vec2 centered = vUv - 0.5;
      float r2 = dot(centered, centered);
      vec2 uv = 0.5 + centered * (1.0 + distortion * r2 * 4.0);
      uv.x += sin(uv.y * 40.0 + time * 30.0) * distortion * 0.004;

      // horizontal tearing in random bands
      float band = floor(uv.y * 28.0);
      float tick = floor(time * 24.0);
      float tear = step(0.62, hash(vec2(band, tick))) * (hash(vec2(tick, band)) - 0.5);
      uv.x += tear * glitch * 0.12;

      float ab = aberration + glitch * 0.012;
      vec2 dir = centered * (ab + r2 * ab * 3.0);
      float cr = texture2D(tDiffuse, uv + dir).r;
      float cg = texture2D(tDiffuse, uv).g;
      float cb = texture2D(tDiffuse, uv - dir).b;
      vec3 col = vec3(cr, cg, cb);

      // grade: cold shadows, warm highlights, colour drains as fear rises
      float luma = dot(col, vec3(0.299, 0.587, 0.114));
      col = mix(col, vec3(luma), 0.12 + fear * 0.38);
      col *= mix(vec3(0.86, 0.98, 1.1), vec3(1.06, 1.0, 0.92), smoothstep(0.0, 0.55, luma));

      float len = length(centered);
      float v = smoothstep(0.85, 0.15, len * (1.0 + vignette * 0.6));
      col *= mix(1.0, v, vignette);

      // blood rushing at the edges of vision on every heartbeat
      col += vec3(0.4, 0.0, 0.0) * pulse * smoothstep(0.22, 0.75, len);

      // scanlines only while the picture is breaking up
      col *= 1.0 - glitch * 0.25 * step(0.5, fract(vUv.y * 240.0));

      float n = hash(vUv * vec2(1920.0, 1080.0) + fract(time) * 100.0) - 0.5;
      col += n * grain * (1.0 - luma * 0.5);

      gl_FragColor = vec4(col * (1.0 - fade), 1.0);
    }
  `,
};

type Uniforms = typeof HorrorShader.uniforms;

export class PostProcessing {
  private composer!: EffectComposer;
  private fxPass!: ShaderPass;
  private w = 1;
  private h = 1;
  private pr = 1;

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    private readonly scene: THREE.Scene,
    private readonly camera: THREE.Camera,
    quality: Quality,
  ) {
    this.build(quality);
  }

  get uniforms(): Uniforms {
    return this.fxPass.uniforms as Uniforms;
  }

  setQuality(quality: Quality): void {
    this.composer.dispose();
    this.build(quality);
    this.setSize(this.w, this.h, this.pr);
  }

  setSize(w: number, h: number, pixelRatio: number): void {
    this.w = w;
    this.h = h;
    this.pr = pixelRatio;
    this.composer.setPixelRatio(pixelRatio);
    this.composer.setSize(w, h);
  }

  render(dt: number, elapsed: number): void {
    this.uniforms.time.value = elapsed;
    this.composer.render(dt);
  }

  private build(quality: Quality): void {
    const samples = quality === 'high' ? 4 : quality === 'medium' ? 2 : 0;
    const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples });
    this.composer = new EffectComposer(this.renderer, target);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    if (quality !== 'low') {
      // threshold sits above lit surfaces, so only bulbs, flames, eyes and the exit bloom
      const strength = quality === 'high' ? 0.7 : 0.55;
      this.composer.addPass(new UnrealBloomPass(new THREE.Vector2(256, 256), strength, 0.6, 6.0));
    }
    this.fxPass = new ShaderPass(HorrorShader);
    this.composer.addPass(this.fxPass);
    this.composer.addPass(new OutputPass());
  }
}
