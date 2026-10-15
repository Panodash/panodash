// Generates the Signal v1 cursor icons with zero image dependencies.
// Usage: node scripts/make-icons.mjs <output-dir>
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const outDir = process.argv[2] ?? 'public/icons';

function crc32(buf) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(size, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

function roundedBoxDistance(x, y, left, top, right, bottom, radius) {
  const cx = (left + right) / 2;
  const cy = (top + bottom) / 2;
  const dx = Math.abs(x - cx) - ((right - left) / 2 - radius);
  const dy = Math.abs(y - cy) - ((bottom - top) / 2 - radius);
  return Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) + Math.min(Math.max(dx, dy), 0) - radius;
}

function coverage(distance) {
  return Math.min(1, Math.max(0, 0.5 - distance));
}

function blend(base, top, alpha) {
  return base.map((channel, index) => Math.round(channel + (top[index] - channel) * alpha));
}

function drawIcon(size) {
  const rgba = Buffer.alloc(size * size * 4);
  const ink = [0x0e, 0x15, 0x10];
  const signal = [0x37, 0xff, 0x8b];
  const mist = [0x8f, 0xa8, 0x94];
  const inset = size * 0.125;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const px = x + 0.5;
      const py = y + 0.5;
      const tile = coverage(roundedBoxDistance(px, py, inset, inset, size - inset, size - inset, size * 0.13));
      if (tile <= 0) continue;
      const cursor = coverage(roundedBoxDistance(px, py, size * 0.34, size * 0.29, size * 0.53, size * 0.71, size * 0.015));
      const pixel = size >= 32
        ? coverage(roundedBoxDistance(px, py, size * 0.59, size * 0.59, size * 0.69, size * 0.69, size * 0.012))
        : 0;
      const color = blend(blend(ink, signal, cursor), mist, pixel);
      const i = (y * size + x) * 4;
      rgba[i] = color[0];
      rgba[i + 1] = color[1];
      rgba[i + 2] = color[2];
      rgba[i + 3] = Math.round(255 * tile);
    }
  }
  return encodePng(size, rgba);
}

mkdirSync(outDir, { recursive: true });
for (const size of [16, 48, 128]) writeFileSync(join(outDir, `icon${size}.png`), drawIcon(size));
console.log(`Signal v1 icons written to ${outDir}`);
