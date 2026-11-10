import * as THREE from 'three';

export interface Materials {
  concrete: THREE.MeshStandardMaterial;
  wall: THREE.MeshStandardMaterial;
  wood: THREE.MeshStandardMaterial;
  metal: THREE.MeshStandardMaterial;
  crate: THREE.MeshStandardMaterial;
  brick: THREE.MeshStandardMaterial;
  stone: THREE.MeshStandardMaterial;
  /** Floor blood-pool decals (a few variations). */
  blood: THREE.Material[];
  /** Soft radial sprite texture for halos and glows. */
  glow: THREE.Texture;
  /** Flashlight lens pattern. */
  cookie: THREE.Texture;
  /** Wall-writing decal for the given words (cached). */
  text(words: string): THREE.Material;
}

const TILE_METERS = 2;

function makeCanvas(size: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return [c, c.getContext('2d')!];
}

/** Grayscale multi-octave value noise, used for bump, roughness and grime. */
function noiseCanvas(size: number, octaves = 6): HTMLCanvasElement {
  const [c, ctx] = makeCanvas(size);
  ctx.fillStyle = '#808080';
  ctx.fillRect(0, 0, size, size);
  ctx.imageSmoothingEnabled = true;
  for (let o = 0; o < octaves; o++) {
    const s = 4 << o;
    if (s > size) break;
    const [n, nctx] = makeCanvas(s);
    const img = nctx.createImageData(s, s);
    for (let i = 0; i < s * s; i++) {
      const v = Math.random() * 255;
      img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
      img.data[i * 4 + 3] = 255;
    }
    nctx.putImageData(img, 0, 0);
    ctx.globalAlpha = 0.9 / (o + 1.5);
    ctx.drawImage(n, 0, 0, size, size);
  }
  ctx.globalAlpha = 1;
  return c;
}

function stains(ctx: CanvasRenderingContext2D, size: number, count: number, maxAlpha: number): void {
  ctx.globalCompositeOperation = 'multiply';
  for (let i = 0; i < count; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const r = size * (0.05 + Math.random() * 0.25);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    const a = Math.random() * maxAlpha;
    g.addColorStop(0, `rgba(20,16,10,${a})`);
    g.addColorStop(1, 'rgba(20,16,10,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  // damp streaks running down from the top
  for (let i = 0; i < count; i++) {
    const x = Math.random() * size;
    const len = size * (0.2 + Math.random() * 0.6);
    const g = ctx.createLinearGradient(0, 0, 0, len);
    g.addColorStop(0, `rgba(10,12,10,${Math.random() * maxAlpha})`);
    g.addColorStop(1, 'rgba(10,12,10,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x, 0, 2 + Math.random() * 6, len);
  }
  ctx.globalCompositeOperation = 'source-over';
}

function cracks(ctx: CanvasRenderingContext2D, size: number, count: number): void {
  ctx.strokeStyle = 'rgba(0,0,0,0.5)';
  ctx.lineWidth = 1;
  for (let i = 0; i < count; i++) {
    let x = Math.random() * size;
    let y = Math.random() * size;
    ctx.beginPath();
    ctx.moveTo(x, y);
    for (let s = 0; s < 12; s++) {
      x += (Math.random() - 0.5) * 40;
      y += Math.random() * 25;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
}

function concreteAlbedo(size: number, base: string): HTMLCanvasElement {
  const [c, ctx] = makeCanvas(size);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);
  ctx.globalCompositeOperation = 'overlay';
  ctx.drawImage(noiseCanvas(size), 0, 0);
  ctx.globalCompositeOperation = 'source-over';
  stains(ctx, size, 16, 0.5);
  cracks(ctx, size, 5);
  return c;
}

function woodAlbedo(size: number): HTMLCanvasElement {
  const [c, ctx] = makeCanvas(size);
  const planks = 8;
  const w = size / planks;
  for (let p = 0; p < planks; p++) {
    const l = 16 + Math.random() * 10;
    ctx.fillStyle = `hsl(28, 35%, ${l}%)`;
    ctx.fillRect(p * w, 0, w, size);
    for (let g = 0; g < 40; g++) {
      ctx.strokeStyle = `rgba(0,0,0,${Math.random() * 0.25})`;
      const x = p * w + Math.random() * w;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.bezierCurveTo(x + 4, size * 0.3, x - 4, size * 0.6, x + 2, size);
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(0,0,0,0.85)';
    ctx.fillRect(p * w, 0, 2, size);
  }
  ctx.globalCompositeOperation = 'overlay';
  ctx.drawImage(noiseCanvas(size), 0, 0);
  ctx.globalCompositeOperation = 'source-over';
  stains(ctx, size, 14, 0.55);
  return c;
}

function metalAlbedo(size: number): HTMLCanvasElement {
  const [c, ctx] = makeCanvas(size);
  ctx.fillStyle = '#3a3d40';
  ctx.fillRect(0, 0, size, size);
  ctx.globalCompositeOperation = 'overlay';
  ctx.drawImage(noiseCanvas(size), 0, 0);
  ctx.globalCompositeOperation = 'multiply';
  for (let i = 0; i < 30; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const r = 10 + Math.random() * 50;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(140,70,25,0.7)');
    g.addColorStop(1, 'rgba(140,70,25,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  ctx.globalCompositeOperation = 'source-over';
  return c;
}

function roughnessCanvas(size: number, base: number, variance: number): HTMLCanvasElement {
  const [c, ctx] = makeCanvas(size);
  const v = Math.round(base * 255);
  ctx.fillStyle = `rgb(${v},${v},${v})`;
  ctx.fillRect(0, 0, size, size);
  ctx.globalAlpha = variance;
  ctx.drawImage(noiseCanvas(size), 0, 0);
  ctx.globalAlpha = 1;
  return c;
}

function tex(canvas: HTMLCanvasElement, srgb: boolean): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(canvas);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function pbr(
  albedo: HTMLCanvasElement,
  roughBase: number,
  roughVar: number,
  metalness: number,
  bump: number,
  bumpCanvas: HTMLCanvasElement = noiseCanvas(512),
): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    map: tex(albedo, true),
    roughnessMap: tex(roughnessCanvas(512, roughBase, roughVar), false),
    roughness: 1,
    metalness,
    bumpMap: tex(bumpCanvas, false),
    bumpScale: bump,
  });
}

/** Running-bond brickwork. Returns the albedo and a matching height map (mortar recessed). */
function brick(size: number, hue: number, sat: number, light: number): [HTMLCanvasElement, HTMLCanvasElement] {
  const [c, ctx] = makeCanvas(size);
  const [b, bctx] = makeCanvas(size);
  const rows = 8;
  const cols = 4;
  const bh = size / rows;
  const bw = size / cols;
  const gap = 5;
  ctx.fillStyle = '#1b1a18';
  ctx.fillRect(0, 0, size, size);
  bctx.fillStyle = '#000';
  bctx.fillRect(0, 0, size, size);
  for (let r = 0; r < rows; r++) {
    const shift = r % 2 ? bw / 2 : 0;
    for (let col = -1; col <= cols; col++) {
      const x = col * bw + shift;
      const l = light + (Math.random() - 0.5) * 9;
      ctx.fillStyle = `hsl(${hue + (Math.random() - 0.5) * 10}, ${sat}%, ${l}%)`;
      ctx.fillRect(x + gap / 2, r * bh + gap / 2, bw - gap, bh - gap);
      const v = 150 + Math.random() * 70;
      bctx.fillStyle = `rgb(${v},${v},${v})`;
      bctx.fillRect(x + gap / 2, r * bh + gap / 2, bw - gap, bh - gap);
    }
  }
  ctx.globalCompositeOperation = 'overlay';
  ctx.drawImage(noiseCanvas(size), 0, 0);
  ctx.globalCompositeOperation = 'source-over';
  stains(ctx, size, 18, 0.6);
  bctx.globalAlpha = 0.35;
  bctx.drawImage(noiseCanvas(size), 0, 0);
  bctx.globalAlpha = 1;
  return [c, b];
}

/** Soft radial falloff used for halos, eye glows and flames. */
function glowTexture(): THREE.CanvasTexture {
  const [c, ctx] = makeCanvas(128);
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.45)');
  g.addColorStop(0.6, 'rgba(255,255,255,0.1)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Flashlight lens pattern: hot centre, dim outer ring, a few smudges and a filament shadow. */
function cookieTexture(): THREE.CanvasTexture {
  const size = 256;
  const [c, ctx] = makeCanvas(size);
  const h = size / 2;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, size, size);
  const g = ctx.createRadialGradient(h, h, 0, h, h, h);
  g.addColorStop(0, '#ffffff');
  g.addColorStop(0.3, '#f2f2f2');
  g.addColorStop(0.52, '#a8a8a8');
  g.addColorStop(0.6, '#c9c9c9');
  g.addColorStop(0.72, '#7a7a7a');
  g.addColorStop(0.9, '#3c3c3c');
  g.addColorStop(1, '#000000');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  ctx.globalCompositeOperation = 'multiply';
  for (let i = 0; i < 9; i++) {
    const x = h + (Math.random() - 0.5) * size * 0.7;
    const y = h + (Math.random() - 0.5) * size * 0.7;
    const r = 6 + Math.random() * 22;
    const s = ctx.createRadialGradient(x, y, 0, x, y, r);
    s.addColorStop(0, 'rgba(120,120,120,1)');
    s.addColorStop(1, 'rgba(255,255,255,1)');
    ctx.fillStyle = s;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  ctx.strokeStyle = 'rgba(205,205,205,1)';
  ctx.lineWidth = 2;
  for (const r of [0.2, 0.44]) {
    ctx.beginPath();
    ctx.arc(h, h, size * r, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.globalCompositeOperation = 'source-over';
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function decalMaterial(canvas: HTMLCanvasElement, roughness: number): THREE.MeshStandardMaterial {
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 4;
  return shared(
    new THREE.MeshStandardMaterial({
      map, transparent: true, depthWrite: false, roughness,
      polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
    }),
  );
}

/** Old blood: a dark pool with satellite drops and a drag smear. */
function bloodDecal(): THREE.MeshStandardMaterial {
  const size = 256;
  const [c, ctx] = makeCanvas(size);
  const blob = (x: number, y: number, r: number, a: number): void => {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(120,10,8,${a})`);
    g.addColorStop(0.7, `rgba(96,8,6,${a * 0.8})`);
    g.addColorStop(1, 'rgba(90,6,5,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  };
  const cx = size / 2;
  for (let i = 0; i < 7; i++) {
    blob(cx + (Math.random() - 0.5) * 70, cx + (Math.random() - 0.5) * 70, 28 + Math.random() * 36, 0.9);
  }
  for (let i = 0; i < 40; i++) {
    const a = Math.random() * Math.PI * 2;
    const d = 50 + Math.random() * 70;
    blob(cx + Math.cos(a) * d, cx + Math.sin(a) * d, 1.5 + Math.random() * 6, 0.85);
  }
  const a = Math.random() * Math.PI * 2;
  for (let i = 0; i < 26; i++) {
    blob(cx + Math.cos(a) * i * 4, cx + Math.sin(a) * i * 4, 16 - i * 0.45, 0.25);
  }
  return decalMaterial(c, 0.25);
}

/** Words clawed into the wall in something dark. */
function textDecal(text: string): THREE.MeshStandardMaterial {
  const [c, ctx] = makeCanvas(1024);
  c.height = 256;
  ctx.textBaseline = 'middle';
  ctx.font = 'bold 120px "Courier New", monospace';
  const total = ctx.measureText(text).width;
  const scale = Math.min(1, 960 / total);
  let x = (1024 - total * scale) / 2;
  for (const ch of text) {
    const w = ctx.measureText(ch).width * scale;
    ctx.save();
    ctx.translate(x + w / 2, 128 + (Math.random() - 0.5) * 26);
    ctx.rotate((Math.random() - 0.5) * 0.22);
    ctx.scale(scale, 1 + (Math.random() - 0.5) * 0.25);
    ctx.textAlign = 'center';
    ctx.fillStyle = `rgba(${86 + Math.random() * 40},6,4,${0.75 + Math.random() * 0.25})`;
    ctx.fillText(ch, 0, 0);
    ctx.restore();
    // drips
    if (ch !== ' ' && Math.random() < 0.45) {
      ctx.fillStyle = 'rgba(86,6,4,0.7)';
      ctx.fillRect(x + w * (0.3 + Math.random() * 0.4), 150, 3, 20 + Math.random() * 70);
    }
    x += w;
  }
  return decalMaterial(c, 0.5);
}

/** Flags a material as owned by the game, not a level, so level teardown leaves it alone. */
function shared<T extends THREE.Material>(m: T): T {
  m.userData.shared = true;
  return m;
}

export function createMaterials(): Materials {
  const [brickA, brickB] = brick(512, 12, 30, 20);
  const [stoneA, stoneB] = brick(512, 80, 5, 24);
  const decalCache = new Map<string, THREE.Material>();
  return {
    concrete: shared(pbr(concreteAlbedo(512, '#4b4d4a'), 0.85, 0.3, 0.0, 2.5)),
    wall: shared(pbr(concreteAlbedo(512, '#3a3f3a'), 0.8, 0.4, 0.0, 3.5)),
    wood: shared(pbr(woodAlbedo(512), 0.7, 0.4, 0.0, 1.5)),
    metal: shared(pbr(metalAlbedo(512), 0.5, 0.6, 0.85, 1.0)),
    crate: shared(pbr(woodAlbedo(512), 0.8, 0.3, 0.0, 2.0)),
    brick: shared(pbr(brickA, 0.85, 0.3, 0.0, 5, brickB)),
    stone: shared(pbr(stoneA, 0.9, 0.25, 0.0, 6, stoneB)),
    blood: [bloodDecal(), bloodDecal(), bloodDecal()],
    glow: glowTexture(),
    cookie: cookieTexture(),
    text(words: string): THREE.Material {
      let m = decalCache.get(words);
      if (!m) decalCache.set(words, (m = textDecal(words)));
      return m;
    },
  };
}

/**
 * Rescales the UVs of a BoxGeometry so textures keep a constant world-space
 * density regardless of the box's dimensions.
 */
export function scaleBoxUVs(geo: THREE.BoxGeometry, w: number, h: number, d: number): void {
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  // face order in BoxGeometry: +x, -x, +y, -y, +z, -z (4 vertices each)
  const dims: [number, number][] = [
    [d, h], [d, h], [w, d], [w, d], [w, h], [w, h],
  ];
  for (let f = 0; f < 6; f++) {
    for (let v = 0; v < 4; v++) {
      const i = f * 4 + v;
      uv.setXY(i, (uv.getX(i) * dims[f][0]) / TILE_METERS, (uv.getY(i) * dims[f][1]) / TILE_METERS);
    }
  }
  uv.needsUpdate = true;
}
