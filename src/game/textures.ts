// Procedural canvas textures, so the game ships without downloaded art.
import * as THREE from 'three';

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 100000) / 100000;
  };
}

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

function tex(c: HTMLCanvasElement, srgb = true, repeat = false): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function speckle(ctx: CanvasRenderingContext2D, w: number, h: number, amount: number, seed: number) {
  const r = rng(seed);
  const img = ctx.getImageData(0, 0, w, h);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (r() - 0.5) * amount;
    img.data[i] += n;
    img.data[i + 1] += n;
    img.data[i + 2] += n;
  }
  ctx.putImageData(img, 0, 0);
}

/** Stone pavers for one 4 m tile: 2 x 2 large slabs with soft joints (fine lines alias badly at grazing angles). */
export function paverTexture(seed = 1): THREE.CanvasTexture {
  return tex(paverCanvas(seed));
}

function paverCanvas(seed: number): HTMLCanvasElement {
  const S = 512;
  const [c, ctx] = canvas(S, S);
  const r = rng(seed);
  ctx.fillStyle = '#a39a8f';
  ctx.fillRect(0, 0, S, S);
  const n = 2;
  const q = S / n;
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) {
      const v = 204 + Math.floor(r() * 18);
      ctx.fillStyle = `rgb(${v},${v - 7},${v - 16})`;
      ctx.fillRect(i * q + 7, j * q + 7, q - 14, q - 14);
    }
  ctx.strokeStyle = 'rgba(255,240,220,0.22)';
  ctx.lineWidth = 10;
  ctx.strokeRect(5, 5, S - 10, S - 10);
  speckle(ctx, S, S, 16, seed);
  return c;
}

/** Pale veined marble. */
export function marbleTexture(seed = 7): THREE.CanvasTexture {
  return tex(marbleCanvas(seed), true, true);
}

function marbleCanvas(seed: number): HTMLCanvasElement {
  const S = 512;
  const [c, ctx] = canvas(S, S);
  const r = rng(seed);
  ctx.fillStyle = '#e9e3d8';
  ctx.fillRect(0, 0, S, S);
  for (let k = 0; k < 14; k++) {
    ctx.strokeStyle = `rgba(120,110,105,${0.08 + r() * 0.12})`;
    ctx.lineWidth = 1 + r() * 3;
    ctx.beginPath();
    let x = r() * S;
    let y = 0;
    ctx.moveTo(x, y);
    while (y < S) {
      x += (r() - 0.5) * 60;
      y += 20 + r() * 40;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  speckle(ctx, S, S, 14, seed);
  return c;
}

/**
 * A path-cube face. The walkway (centre + arms) is paved like every other walkway and inlaid with light; the rest is
 * darker carved stone. The puzzle is about which path faces up, so each face has to read from any side at a glance.
 */
export function cubeFaceTextures(arms: { u: number; v: number }[], accent: string, seed: number) {
  const S = 768;
  const q = S / 3;
  const [c, ctx] = canvas(S, S);
  const [e, ectx] = canvas(S, S);
  ctx.drawImage(marbleCanvas(seed), 0, 0, S, S);
  ctx.fillStyle = 'rgba(48,42,66,0.45)';
  ctx.fillRect(0, 0, S, S);
  ctx.strokeStyle = 'rgba(232,222,205,0.2)';
  ctx.lineWidth = 4;
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++) {
      ctx.strokeRect(i * q + 24, j * q + 24, q - 48, q - 48);
      ctx.beginPath();
      ctx.arc(i * q + q / 2, j * q + q / 2, q * 0.22, 0, Math.PI * 2);
      ctx.stroke();
    }
  const paving = paverCanvas(seed);
  for (const a of [{ u: 0, v: 0 }, ...arms]) ctx.drawImage(paving, (1 + a.u) * q, (1 + a.v) * q, q, q);
  ectx.fillStyle = '#000';
  ectx.fillRect(0, 0, S, S);
  ectx.strokeStyle = accent;
  ectx.lineCap = 'round';
  const inlay = (width: number, alpha: number) => {
    ectx.globalAlpha = alpha;
    ectx.lineWidth = width;
    ectx.beginPath();
    for (const a of arms) {
      ectx.moveTo(1.5 * q, 1.5 * q);
      ectx.lineTo((1.5 + a.u * 1.5) * q, (1.5 + a.v * 1.5) * q);
    }
    ectx.stroke();
  };
  inlay(70, 0.22); // soft halo on the paving
  inlay(18, 1); // the bright line itself
  ectx.globalAlpha = 1;
  ectx.fillStyle = accent;
  ectx.beginPath();
  ectx.arc(1.5 * q, 1.5 * q, 26, 0, Math.PI * 2);
  ectx.fill();
  return { map: tex(c), emissive: tex(e) };
}

/** Facade with a window grid; returns colour and emissive (lit windows) maps. */
export function facadeTextures(seed: number, cols = 6, rows = 14) {
  const W = 256;
  const Hh = 512;
  const [c, ctx] = canvas(W, Hh);
  const [e, ectx] = canvas(W, Hh);
  const r = rng(seed);
  ctx.fillStyle = '#3a3f52';
  ctx.fillRect(0, 0, W, Hh);
  ectx.fillStyle = '#000';
  ectx.fillRect(0, 0, W, Hh);
  const cw = W / cols;
  const rh = Hh / rows;
  for (let i = 0; i < cols; i++)
    for (let j = 0; j < rows; j++) {
      const x = i * cw + cw * 0.22;
      const y = j * rh + rh * 0.25;
      const w = cw * 0.56;
      const h = rh * 0.5;
      ctx.fillStyle = '#20232f';
      ctx.fillRect(x, y, w, h);
      if (r() < 0.32) {
        const warm = r() < 0.75;
        ectx.fillStyle = warm ? `rgba(255,${190 + Math.floor(r() * 50)},120,1)` : 'rgba(140,220,255,1)';
        ectx.fillRect(x, y, w, h);
      }
    }
  ctx.fillStyle = 'rgba(255,255,255,0.05)';
  for (let j = 0; j < rows; j++) ctx.fillRect(0, j * rh, W, 2);
  speckle(ctx, W, Hh, 10, seed);
  return { map: tex(c, true, true), emissive: tex(e, true, true) };
}

/** Mural that shows the six cube faces, as a diegetic hint. */
export function muralTexture(faces: { name: string; arms: { u: number; v: number }[] }[], accent: string) {
  const [c, ctx] = canvas(1024, 512);
  ctx.fillStyle = '#2b2a35';
  ctx.fillRect(0, 0, 1024, 512);
  ctx.strokeStyle = '#c8a25a';
  ctx.lineWidth = 6;
  ctx.strokeRect(10, 10, 1004, 492);
  const q = 1024 / 6;
  faces.forEach((f, i) => {
    const cx = i * q + q / 2;
    const cy = 230;
    ctx.fillStyle = '#e9e3d8';
    ctx.fillRect(cx - 60, cy - 60, 120, 120);
    ctx.strokeStyle = accent;
    ctx.lineWidth = 12;
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (const a of f.arms) {
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + a.u * 60, cy + a.v * 60);
    }
    ctx.stroke();
    ctx.fillStyle = '#e9e3d8';
    ctx.font = '28px serif';
    ctx.textAlign = 'center';
    ctx.fillText(f.name, cx, 360);
  });
  return tex(c);
}
