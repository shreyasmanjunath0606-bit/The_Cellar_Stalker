import * as THREE from 'three';
import { Flashlight, SPOT_ANGLE } from '../player/Flashlight';

interface EmitOptions {
  color: number;
  /** Initial speed range (m/s). */
  speed: [number, number];
  /** Extra upward velocity (m/s). */
  lift?: number;
  life: [number, number];
  size: [number, number];
  alpha?: number;
  gravity?: number;
  drag?: number;
  /** Random offset of the spawn point (m). */
  spread?: number;
}

const POINT_VERT = /* glsl */ `
  attribute vec4 aColor;
  attribute float aSize;
  uniform float uScale;
  varying vec4 vColor;
  void main() {
    vColor = aColor;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * uScale / max(0.1, -mv.z);
    gl_Position = projectionMatrix * mv;
  }
`;
const POINT_FRAG = /* glsl */ `
  varying vec4 vColor;
  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    float a = smoothstep(1.0, 0.0, d);
    gl_FragColor = vec4(vColor.rgb, vColor.a * a);
  }
`;

/** Fixed-size pool of CPU-simulated point sprites. */
class ParticleSystem {
  readonly points: THREE.Points;
  readonly material: THREE.ShaderMaterial;
  private readonly pos: Float32Array;
  private readonly col: Float32Array;
  private readonly size: Float32Array;
  private readonly vel: Float32Array;
  private readonly life: Float32Array;
  private readonly span: Float32Array;
  private readonly alpha: Float32Array;
  private readonly baseSize: Float32Array;
  private readonly grav: Float32Array;
  private readonly drag: Float32Array;
  private readonly geo = new THREE.BufferGeometry();
  private readonly tint = new THREE.Color();
  private cursor = 0;
  private live = 0;

  constructor(private readonly max: number, additive: boolean, private readonly grow: number) {
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 4);
    this.size = new Float32Array(max);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.span = new Float32Array(max);
    this.alpha = new Float32Array(max);
    this.baseSize = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.geo.setAttribute('aColor', new THREE.BufferAttribute(this.col, 4));
    this.geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1));
    this.material = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 600 } },
      vertexShader: POINT_VERT,
      fragmentShader: POINT_FRAG,
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(this.geo, this.material);
    this.points.frustumCulled = false;
  }

  emit(at: THREE.Vector3, count: number, o: EmitOptions): void {
    const rnd = (r: [number, number]): number => r[0] + Math.random() * (r[1] - r[0]);
    this.tint.setHex(o.color);
    for (let n = 0; n < count; n++) {
      const i = this.cursor;
      this.cursor = (this.cursor + 1) % this.max;
      const s = o.spread ?? 0;
      this.pos[i * 3] = at.x + (Math.random() - 0.5) * s;
      this.pos[i * 3 + 1] = at.y + (Math.random() - 0.5) * s;
      this.pos[i * 3 + 2] = at.z + (Math.random() - 0.5) * s;
      // random direction on a sphere
      const u = Math.random() * 2 - 1;
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(1 - u * u);
      const sp = rnd(o.speed);
      this.vel[i * 3] = Math.cos(a) * r * sp;
      this.vel[i * 3 + 1] = u * sp + (o.lift ?? 0);
      this.vel[i * 3 + 2] = Math.sin(a) * r * sp;
      this.life[i] = this.span[i] = rnd(o.life);
      this.alpha[i] = o.alpha ?? 1;
      this.baseSize[i] = rnd(o.size);
      this.grav[i] = o.gravity ?? 0;
      this.drag[i] = o.drag ?? 0;
      const shade = 0.75 + Math.random() * 0.25;
      this.col[i * 4] = this.tint.r * shade;
      this.col[i * 4 + 1] = this.tint.g * shade;
      this.col[i * 4 + 2] = this.tint.b * shade;
    }
    this.live = this.max;
  }

  clear(): void {
    this.life.fill(0);
    this.size.fill(0);
    this.geo.attributes.aSize.needsUpdate = true;
    this.live = 0;
  }

  update(dt: number): void {
    if (this.live === 0) return;
    let alive = 0;
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this.size[i] = 0;
        continue;
      }
      alive++;
      const k = 1 - Math.exp(-this.drag[i] * dt);
      const j = i * 3;
      this.vel[j] -= this.vel[j] * k;
      this.vel[j + 1] -= this.vel[j + 1] * k + this.grav[i] * dt;
      this.vel[j + 2] -= this.vel[j + 2] * k;
      this.pos[j] += this.vel[j] * dt;
      this.pos[j + 1] += this.vel[j + 1] * dt;
      this.pos[j + 2] += this.vel[j + 2] * dt;
      if (this.pos[j + 1] < 0.02 && this.vel[j + 1] < 0) {
        // bounce off the floor
        this.pos[j + 1] = 0.02;
        this.vel[j + 1] *= -0.35;
        this.vel[j] *= 0.6;
        this.vel[j + 2] *= 0.6;
      }
      const t = this.life[i] / this.span[i]; // 1 -> 0
      this.col[i * 4 + 3] = this.alpha[i] * Math.min(1, t * 2.5);
      this.size[i] = this.baseSize[i] * (1 + (1 - t) * this.grow);
    }
    this.live = alive;
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.aColor.needsUpdate = true;
    this.geo.attributes.aSize.needsUpdate = true;
  }
}

const MOTES = 900;
const MOTE_BOX = new THREE.Vector3(9, 3.2, 9);

/** Dust hanging in the air. Wraps around the camera and lights up inside the flashlight beam. */
class DustMotes {
  readonly points: THREE.Points;
  readonly material: THREE.ShaderMaterial;

  constructor() {
    const pos = new Float32Array(MOTES * 3);
    const seed = new Float32Array(MOTES);
    for (let i = 0; i < MOTES; i++) {
      pos[i * 3] = Math.random() * MOTE_BOX.x;
      pos[i * 3 + 1] = Math.random() * MOTE_BOX.y;
      pos[i * 3 + 2] = Math.random() * MOTE_BOX.z;
      seed[i] = Math.random();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uScale: { value: 600 },
        uBox: { value: MOTE_BOX },
        uLightPos: { value: new THREE.Vector3() },
        uLightDir: { value: new THREE.Vector3(0, 0, -1) },
        uLight: { value: 0 },
        uCone: { value: new THREE.Vector2(Math.cos(SPOT_ANGLE), Math.cos(SPOT_ANGLE * 0.7)) },
      },
      vertexShader: /* glsl */ `
        attribute float aSeed;
        uniform float uTime;
        uniform float uScale;
        uniform vec3 uBox;
        uniform vec3 uLightPos;
        uniform vec3 uLightDir;
        uniform float uLight;
        uniform vec2 uCone;
        varying float vAlpha;
        void main() {
          vec3 p = position;
          p.y -= uTime * 0.015 * (0.4 + aSeed);
          p.x += sin(uTime * 0.21 + aSeed * 40.0) * 0.18;
          p.z += cos(uTime * 0.17 + aSeed * 31.0) * 0.18;
          // keep the cloud centred on the camera
          p = mod(p - cameraPosition + uBox * 0.5, uBox) - uBox * 0.5 + cameraPosition;
          vec4 mv = viewMatrix * vec4(p, 1.0);

          vec3 toP = p - uLightPos;
          float dist = length(toP);
          float c = dot(toP / max(dist, 0.001), uLightDir);
          float beam = smoothstep(uCone.x, uCone.y, c) * uLight * clamp(1.0 - dist / 8.0, 0.0, 1.0);
          float near = smoothstep(0.2, 0.9, -mv.z);
          vAlpha = (0.035 + beam * 0.75) * near * (0.4 + 0.6 * aSeed);

          gl_PointSize = max(1.0, (0.008 + 0.014 * aSeed) * uScale / max(0.1, -mv.z));
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        varying float vAlpha;
        void main() {
          float d = length(gl_PointCoord - 0.5) * 2.0;
          gl_FragColor = vec4(vec3(1.0, 0.94, 0.82), vAlpha * smoothstep(1.0, 0.2, d));
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
  }
}

/** World-space VFX that outlive any one level: sparks, dust, shards and floating motes. */
export class Effects {
  private readonly glowing = new ParticleSystem(384, true, 0);
  private readonly dust = new ParticleSystem(384, false, 2.5);
  private readonly motes = new DustMotes();
  private readonly buf = new THREE.Vector2();
  private readonly at = new THREE.Vector3();

  constructor(scene: THREE.Scene) {
    scene.add(this.motes.points, this.dust.points, this.glowing.points);
  }

  /** A vase bursting: flying chips and a low cloud of dust. */
  shatter(pos: THREE.Vector3): void {
    this.dust.emit(pos, 26, {
      color: 0x8a7458, speed: [0.8, 3.2], lift: 1.2, life: [0.5, 1.1], size: [0.02, 0.05], gravity: 9, alpha: 1,
    });
    this.puff(pos, 14);
  }

  /** Soft dust kicked up from the floor. */
  puff(pos: THREE.Vector3, count: number): void {
    this.at.set(pos.x, Math.max(0.08, pos.y * 0.3), pos.z);
    this.dust.emit(this.at, count, {
      color: 0x6f6a60, speed: [0.15, 0.7], lift: 0.25, life: [0.9, 2], size: [0.1, 0.22],
      alpha: 0.22, drag: 1.6, spread: 0.3,
    });
  }

  /** Something worth having: a rising swirl of gold or green. */
  sparkle(pos: THREE.Vector3, color: number): void {
    this.glowing.emit(pos, 26, {
      color, speed: [0.2, 1.1], lift: 0.7, life: [0.5, 1.1], size: [0.012, 0.03], drag: 2.2, spread: 0.1,
    });
  }

  /** Electrical sparks spitting from a fitting. */
  sparks(pos: THREE.Vector3): void {
    this.glowing.emit(pos, 18, {
      color: 0xffc070, speed: [0.6, 2.6], life: [0.3, 0.9], size: [0.012, 0.024], gravity: 9, drag: 0.6,
    });
  }

  /** Grit shaken loose along the top of the rising cellar door. */
  doorDust(pos: THREE.Vector3): void {
    for (let i = 0; i < 6; i++) {
      this.at.set(pos.x - 1.1 + i * 0.44, 2.1, pos.z - 0.2);
      this.dust.emit(this.at, 5, {
        color: 0x7a746a, speed: [0.05, 0.4], life: [1.2, 2.4], size: [0.06, 0.16], alpha: 0.3,
        gravity: 1.4, drag: 1.2, spread: 0.3,
      });
    }
  }

  clear(): void {
    this.glowing.clear();
    this.dust.clear();
  }

  update(
    dt: number,
    elapsed: number,
    renderer: THREE.WebGLRenderer,
    camera: THREE.PerspectiveCamera,
    flashlight: Flashlight | null,
  ): void {
    // world-size -> pixel-size factor for point sprites
    const h = renderer.getDrawingBufferSize(this.buf).y;
    const scale = h / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
    this.glowing.material.uniforms.uScale.value = scale;
    this.dust.material.uniforms.uScale.value = scale;
    this.glowing.update(dt);
    this.dust.update(dt);

    const u = this.motes.material.uniforms;
    u.uScale.value = scale;
    u.uTime.value = elapsed;
    if (flashlight) {
      u.uLightPos.value.copy(flashlight.group.position);
      (u.uLightDir.value as THREE.Vector3).set(0, 0, -1).applyQuaternion(flashlight.group.quaternion);
      u.uLight.value = flashlight.level;
    } else {
      u.uLight.value = 0;
    }
  }
}
