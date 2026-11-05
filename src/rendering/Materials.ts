import * as THREE from 'three';

export interface Materials {
  concrete: THREE.MeshStandardMaterial;
  wall: THREE.MeshStandardMaterial;
  wood: THREE.MeshStandardMaterial;
  metal: THREE.MeshStandardMaterial;
  crate: THREE.MeshStandardMaterial;
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
): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    map: tex(albedo, true),
    roughnessMap: tex(roughnessCanvas(512, roughBase, roughVar), false),
    roughness: 1,
    metalness,
    bumpMap: tex(noiseCanvas(512), false),
    bumpScale: bump,
  });
}

export function createMaterials(): Materials {
  return {
    concrete: pbr(concreteAlbedo(512, '#4b4d4a'), 0.85, 0.3, 0.0, 2.5),
    wall: pbr(concreteAlbedo(512, '#3a3f3a'), 0.8, 0.4, 0.0, 3.5),
    wood: pbr(woodAlbedo(512), 0.7, 0.4, 0.0, 1.5),
    metal: pbr(metalAlbedo(512), 0.5, 0.6, 0.85, 1.0),
    crate: pbr(woodAlbedo(512), 0.8, 0.3, 0.0, 2.0),
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
