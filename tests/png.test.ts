// The e2e scripts tell a blank frame from a drawn one with tests/e2e/png.cjs; these tests check that helper itself.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import zlib from 'node:zlib';

interface Png { width: number; height: number; channels: number; data: Uint8Array }
interface Stats { mean: number; std: number; white: number; black: number; samples: number }
const { decodePng, frameStats, blankReason, diffFraction } = createRequire(import.meta.url)('./e2e/png.cjs') as {
  decodePng(buf: Buffer): Png;
  frameStats(png: Png): Stats;
  blankReason(stats: Stats): 'white' | 'black' | 'uniform' | null;
  diffFraction(a: Png, b: Png, tolerance?: number): number;
};

const chunk = (type: string, body: Buffer) => {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(body.length, 0);
  head.write(type, 4, 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(Buffer.concat([head.subarray(4), body])), 0);
  return Buffer.concat([head, body, crc]);
};

/** Encode 8-bit pixels, filtering row y with `filters[y % filters.length]` (0 none, 1 sub, 2 up, 3 average, 4 Paeth). */
function encode(width: number, height: number, channels: 3 | 4, pixel: (x: number, y: number, c: number) => number, filters = [0], opts: { depth?: number; color?: number; interlace?: number } = {}) {
  const stride = width * channels;
  const rows: Uint8Array[] = [];
  for (let y = 0; y < height; y++) rows.push(Uint8Array.from({ length: stride }, (_, i) => pixel(Math.floor(i / channels), y, i % channels)));
  const out: number[] = [];
  rows.forEach((row, y) => {
    const f = filters[y % filters.length];
    out.push(f);
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? row[i - channels] : 0;
      const b = y > 0 ? rows[y - 1][i] : 0;
      const c = i >= channels && y > 0 ? rows[y - 1][i - channels] : 0;
      const p = a + b - c;
      const pa = Math.abs(p - a);
      const pb = Math.abs(p - b);
      const pc = Math.abs(p - c);
      const predict = [0, a, b, (a + b) >> 1, pa <= pb && pa <= pc ? a : pb <= pc ? b : c][f];
      out.push((row[i] - predict) & 255);
    }
  });
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = opts.depth ?? 8;
  ihdr[9] = opts.color ?? (channels === 3 ? 2 : 6);
  ihdr[12] = opts.interlace ?? 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(Buffer.from(out))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const texture = (x: number, y: number, c: number) => (x * 37 + y * 91 + c * 53 + ((x * y) % 7) * 11) & 255;

test('the PNG decoder restores pixels through all five row filters, in RGB and RGBA', () => {
  for (const channels of [3, 4] as const) {
    const png = decodePng(encode(23, 11, channels, texture, [0, 1, 2, 3, 4]));
    assert.equal(png.width, 23);
    assert.equal(png.height, 11);
    assert.equal(png.channels, channels);
    for (let y = 0; y < 11; y++)
      for (let x = 0; x < 23; x++)
        for (let c = 0; c < channels; c++) assert.equal(png.data[(y * 23 + x) * channels + c], texture(x, y, c), `pixel ${x},${y} channel ${c}`);
  }
});

test('the PNG decoder refuses what it cannot read instead of guessing', () => {
  assert.throws(() => decodePng(Buffer.from('not a png at all')), /not a PNG/);
  assert.throws(() => decodePng(encode(4, 4, 3, texture, [0], { depth: 16 })), /bit depth/);
  assert.throws(() => decodePng(encode(4, 4, 3, texture, [0], { color: 3 })), /colour type/);
  assert.throws(() => decodePng(encode(4, 4, 3, texture, [0], { interlace: 1 })), /interlaced/);
});

test('blank frames are told from drawn ones', () => {
  const flat = (v: number) => decodePng(encode(64, 36, 4, () => v));
  assert.equal(blankReason(frameStats(flat(255))), 'white');
  assert.equal(blankReason(frameStats(flat(0))), 'black');
  assert.equal(blankReason(frameStats(flat(128))), 'uniform');
  const picture = frameStats(decodePng(encode(64, 36, 4, (x, y) => (x + y) * 3)));
  assert.equal(blankReason(picture), null);
  assert.ok(picture.std > 0.1 && picture.mean > 0.2 && picture.mean < 0.8);
  // a white frame with a small dark patch is still blank: 98 % of the samples are white
  const almost = decodePng(encode(100, 100, 4, (x, y) => (x < 8 && y < 8 ? 0 : 255)));
  assert.equal(blankReason(frameStats(almost)), 'white');
});

test('frame statistics use Rec. 709 luminance over every 4th pixel', () => {
  const green = frameStats(decodePng(encode(40, 40, 3, (_x, _y, c) => (c === 1 ? 255 : 0))));
  assert.ok(Math.abs(green.mean - 0.7152) < 1e-9);
  assert.equal(green.samples, 400);
  assert.ok(green.std < 1e-9);
});

test('image differences count the pixels that moved by more than the tolerance', () => {
  const base = (x: number, y: number, c: number) => texture(x, y, c) % 200; // headroom, so a nudge does not wrap
  const a = decodePng(encode(40, 40, 4, base));
  assert.equal(diffFraction(a, a), 0);
  const nudged = decodePng(encode(40, 40, 4, (x, y, c) => base(x, y, c) + 2));
  assert.equal(diffFraction(a, nudged, 2), 0, 'a change of 2/255 is within the tolerance');
  const moved = decodePng(encode(40, 40, 4, (x, y, c) => base(x, y, c) + 3));
  assert.equal(diffFraction(a, moved, 2), 1);
  assert.throws(() => diffFraction(a, decodePng(encode(20, 40, 4, base))), /size/);
});
