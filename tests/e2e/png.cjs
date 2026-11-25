// A small PNG decoder and frame statistics, so the browser tests can tell a rendered frame from a blank one
// (all white, all black or a single flat colour) without any image dependency.
const zlib = require('node:zlib');

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Decode an 8-bit RGB or RGBA, non-interlaced PNG. Throws on anything else. Returns { width, height, channels, data }. */
function decodePng(buf) {
  if (buf.length < 8 || !buf.subarray(0, 8).equals(SIGNATURE)) throw new Error('not a PNG file');
  let pos = 8;
  let header = null;
  const idat = [];
  while (pos + 8 <= buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('latin1', pos + 4, pos + 8);
    const body = buf.subarray(pos + 8, pos + 8 + len);
    pos += 12 + len;
    if (type === 'IHDR') {
      header = { width: body.readUInt32BE(0), height: body.readUInt32BE(4), depth: body[8], color: body[9], interlace: body[12] };
    } else if (type === 'IDAT') idat.push(body);
    else if (type === 'IEND') break;
  }
  if (!header) throw new Error('PNG has no IHDR chunk');
  if (header.depth !== 8) throw new Error(`unsupported PNG bit depth ${header.depth}`);
  if (header.color !== 2 && header.color !== 6) throw new Error(`unsupported PNG colour type ${header.color}`);
  if (header.interlace !== 0) throw new Error('interlaced PNG is not supported');
  const channels = header.color === 2 ? 3 : 4;
  const { width, height } = header;
  const stride = width * channels;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  if (raw.length !== (stride + 1) * height) throw new Error(`PNG data has ${raw.length} bytes, expected ${(stride + 1) * height}`);
  const data = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const src = y * (stride + 1) + 1;
    const out = y * stride;
    for (let i = 0; i < stride; i++) {
      const x = raw[src + i];
      const a = i >= channels ? data[out + i - channels] : 0; // left
      const b = y > 0 ? data[out - stride + i] : 0; // up
      const c = i >= channels && y > 0 ? data[out - stride + i - channels] : 0; // up-left
      let v;
      switch (filter) {
        case 0: v = x; break;
        case 1: v = x + a; break;
        case 2: v = x + b; break;
        case 3: v = x + ((a + b) >> 1); break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a);
          const pb = Math.abs(p - b);
          const pc = Math.abs(p - c);
          v = x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
          break;
        }
        default: throw new Error(`unknown PNG row filter ${filter}`);
      }
      data[out + i] = v & 255;
    }
  }
  return { width, height, channels, data };
}

/**
 * Luminance statistics over every 4th pixel (Rec. 709 weights, 0..1): mean, standard deviation,
 * and the fractions of samples above 0.97 (`white`) and below 0.03 (`black`).
 */
function frameStats(png) {
  const { width, height, channels, data } = png;
  let n = 0;
  let sum = 0;
  let sumSq = 0;
  let white = 0;
  let black = 0;
  for (let p = 0; p < width * height; p += 4) {
    const o = p * channels;
    const l = (0.2126 * data[o] + 0.7152 * data[o + 1] + 0.0722 * data[o + 2]) / 255;
    n++;
    sum += l;
    sumSq += l * l;
    if (l > 0.97) white++;
    if (l < 0.03) black++;
  }
  const mean = sum / n;
  return { mean, std: Math.sqrt(Math.max(0, sumSq / n - mean * mean)), white: white / n, black: black / n, samples: n };
}

/** Why a frame counts as blank: "white", "black", "uniform", or null when it shows something. */
function blankReason(stats) {
  if (stats.white >= 0.98) return 'white';
  if (stats.black >= 0.98) return 'black';
  if (stats.std < 0.02) return 'uniform';
  return null;
}

/** Fraction of sampled pixels (every 4th) where any colour channel differs by more than `tolerance` (0..255). */
function diffFraction(a, b, tolerance = 2) {
  if (a.width !== b.width || a.height !== b.height || a.channels !== b.channels) throw new Error('images differ in size');
  let n = 0;
  let diff = 0;
  for (let p = 0; p < a.width * a.height; p += 4) {
    const o = p * a.channels;
    n++;
    for (let c = 0; c < 3; c++)
      if (Math.abs(a.data[o + c] - b.data[o + c]) > tolerance) {
        diff++;
        break;
      }
  }
  return diff / n;
}

module.exports = { decodePng, frameStats, blankReason, diffFraction };
