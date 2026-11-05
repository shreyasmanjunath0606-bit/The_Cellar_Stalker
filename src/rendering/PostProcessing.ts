import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

/** Vignette + film grain + chromatic aberration + radial screen distortion. */
const HorrorShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    time: { value: 0 },
    vignette: { value: 0.85 },
    grain: { value: 0.1 },
    aberration: { value: 0.0012 },
    distortion: { value: 0 },
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

      vec2 dir = centered * (aberration + r2 * aberration * 3.0);
      float cr = texture2D(tDiffuse, uv + dir).r;
      float cg = texture2D(tDiffuse, uv).g;
      float cb = texture2D(tDiffuse, uv - dir).b;
      vec3 col = vec3(cr, cg, cb);

      float v = smoothstep(0.85, 0.15, length(centered) * (1.0 + vignette * 0.6));
      col *= mix(1.0, v, vignette);

      float n = hash(vUv * vec2(1920.0, 1080.0) + fract(time) * 100.0) - 0.5;
      col += n * grain * (1.0 - dot(col, vec3(0.33)) * 0.5);

      gl_FragColor = vec4(col, 1.0);
    }
  `,
};

export class PostProcessing {
  private readonly composer: EffectComposer;
  private readonly fxPass: ShaderPass;

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) {
    this.composer = new EffectComposer(renderer);
    this.composer.addPass(new RenderPass(scene, camera));
    this.fxPass = new ShaderPass(HorrorShader);
    this.composer.addPass(this.fxPass);
    this.composer.addPass(new OutputPass());
  }

  get uniforms(): typeof HorrorShader.uniforms {
    return this.fxPass.uniforms as typeof HorrorShader.uniforms;
  }

  setSize(w: number, h: number, pixelRatio: number): void {
    this.composer.setPixelRatio(pixelRatio);
    this.composer.setSize(w, h);
  }

  render(dt: number, elapsed: number): void {
    this.uniforms.time.value = elapsed;
    this.composer.render(dt);
  }
}
