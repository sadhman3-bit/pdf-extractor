// Draws the app icon as PNGs (192 and 512) with no dependencies. Run once; outputs are committed.
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
const DARK = [0x16, 0x1a, 0x1f];
const BLUE = [0x7c, 0xc4, 0xe4];
const WHITE = [0xff, 0xff, 0xff];

function crc32(buf) {
  let c,
    crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function draw(size) {
  const px = (x, y) => {
    const u = x / size;
    const v = y / size;
    // Document body with a folded corner, centred.
    const inDoc =
      u > 0.28 && u < 0.72 && v > 0.2 && v < 0.8 && !(u > 0.58 && v < 0.34 && u - 0.58 > v - 0.2);
    if (inDoc) {
      const line = (v > 0.48 && v < 0.52) || (v > 0.6 && v < 0.64);
      if (line && u > 0.36 && u < 0.64) return BLUE;
      return WHITE;
    }
    return DARK;
  };
  const raw = Buffer.alloc((size * 3 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b] = px(x, y);
      const o = y * (size * 3 + 1) + 1 + x * 3;
      raw[o] = r;
      raw[o + 1] = g;
      raw[o + 2] = b;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

for (const s of [192, 512]) writeFileSync(join(out, `icon-${s}.png`), draw(s));
writeFileSync(
  join(out, 'icon.svg'),
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="12" fill="#161A1F"/><path d="M18 13h19l9 9v29H18z" fill="#fff"/><path d="M37 13v9h9" fill="#C9CED6"/><path d="M23 32h18M23 40h18" stroke="#7CC4E4" stroke-width="3"/></svg>\n`,
);
console.log('icons written');
