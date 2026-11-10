import * as THREE from 'three';

const CONE_LENGTH = 12;
export const SPOT_ANGLE = 0.45;
const BASE_INTENSITY = 90;

/**
 * Shadow-casting spotlight with a lens-shaped cookie and a faint additive
 * cone for a volumetric look. It trails the camera slightly, which reads as hand sway.
 */
export class Flashlight {
  readonly group = new THREE.Group();
  readonly light: THREE.SpotLight;
  battery = 100;
  on = true;
  /** Current output 0..1 after battery sag and flicker. */
  level = 1;

  private readonly coneMaterial: THREE.ShaderMaterial;
  private readonly offset = new THREE.Vector3(0.22, -0.18, -0.1);
  private flickerUntil = 0;
  private flickerLevel = 1;

  constructor(
    parent: THREE.Object3D,
    cookie: THREE.Texture,
    /** Battery percent per second. */
    private readonly drain: number,
    shadowSize: number,
  ) {
    this.light = new THREE.SpotLight(0xfff0d0, BASE_INTENSITY, 22, SPOT_ANGLE, 0.55, 1.6);
    this.light.castShadow = true;
    this.light.map = cookie;
    this.light.shadow.mapSize.set(shadowSize, shadowSize);
    this.light.shadow.camera.near = 0.1;
    this.light.shadow.camera.far = 22;
    this.light.shadow.bias = -0.0004;
    this.light.shadow.radius = 4;
    this.light.target.position.set(0, 0, -5);
    this.group.add(this.light, this.light.target);

    const radius = CONE_LENGTH * Math.tan(SPOT_ANGLE * 0.85);
    const geo = new THREE.ConeGeometry(radius, CONE_LENGTH, 32, 1, true);
    geo.translate(0, -CONE_LENGTH / 2, 0); // apex at origin, extending along -y
    geo.rotateX(Math.PI / 2); // ...then along -z
    this.coneMaterial = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      uniforms: { uIntensity: { value: 1 }, uLength: { value: CONE_LENGTH } },
      vertexShader: /* glsl */ `
        varying float vT;
        varying vec3 vNormalV;
        varying vec3 vViewDir;
        uniform float uLength;
        void main() {
          vT = -position.z / uLength;
          vNormalV = normalize(normalMatrix * normal);
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vViewDir = normalize(-mv.xyz);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uIntensity;
        varying float vT;
        varying vec3 vNormalV;
        varying vec3 vViewDir;
        void main() {
          float edge = pow(abs(dot(normalize(vNormalV), normalize(vViewDir))), 2.0);
          float fade = pow(1.0 - clamp(vT, 0.0, 1.0), 1.6);
          gl_FragColor = vec4(vec3(1.0, 0.93, 0.8), edge * fade * 0.07 * uIntensity);
        }
      `,
    });
    this.group.add(new THREE.Mesh(geo, this.coneMaterial));
    parent.add(this.group);
  }

  toggle(): boolean {
    if (this.battery > 0) this.on = !this.on;
    return this.on;
  }

  addBattery(amount: number): void {
    this.battery = Math.min(100, this.battery + amount);
  }

  setShadowSize(size: number): void {
    this.light.shadow.mapSize.set(size, size);
    this.light.shadow.map?.dispose();
    this.light.shadow.map = null;
  }

  /** `tension` 0..1 — how threatened the player is; drives flicker. `draining` false in menus. */
  update(dt: number, elapsed: number, camera: THREE.Camera, tension = 0, draining = true): void {
    this.group.position.copy(camera.position).add(this.offset.clone().applyQuaternion(camera.quaternion));
    this.group.quaternion.slerp(camera.quaternion, 1 - Math.exp(-dt * 9));

    if (this.on && draining) {
      this.battery = Math.max(0, this.battery - this.drain * dt);
      if (this.battery === 0) this.on = false;
    }

    let level = this.on ? 1 : 0;
    if (this.on) {
      if (this.battery < 25) level *= 0.35 + 0.65 * (this.battery / 25);
      const unstable = this.battery < 20 || tension > 0.05;
      if (unstable && elapsed > this.flickerUntil) {
        const chance = 0.25 + tension * 0.5;
        this.flickerLevel = Math.random() < chance ? Math.random() * 0.25 : 1;
        this.flickerUntil = elapsed + 0.03 + Math.random() * 0.12;
      } else if (!unstable) {
        this.flickerLevel = 1;
      }
      level *= this.flickerLevel;
    }
    this.level = level;
    this.light.intensity = BASE_INTENSITY * level;
    this.coneMaterial.uniforms.uIntensity.value = level;
  }
}
