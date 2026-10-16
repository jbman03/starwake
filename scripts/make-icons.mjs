// Generates the original placeholder app icons (public/icons/icon-192.png and icon-512.png):
// a simple stylized ship silhouette over a dark circle. No dependencies; PNGs are encoded by hand.
// Run: node scripts/make-icons.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const BG = [5, 7, 15]; // full-bleed square, matches theme_color (also the maskable safe backdrop)
const DISC = [14, 22, 38];
const RING = [109, 135, 168];
const SHIP = [223, 230, 238];
const GLOW = [127, 178, 255];

// Ship outline in a unit square (0..1), nose up. Kept inside the central 60% for maskable icons.
const HULL = [
  [0.5, 0.2], [0.565, 0.38], [0.565, 0.5], [0.72, 0.64], [0.72, 0.72], [0.575, 0.67],
  [0.55, 0.78], [0.45, 0.78], [0.425, 0.67], [0.28, 0.72], [0.28, 0.64], [0.435, 0.5], [0.435, 0.38],
];
const FLAME = [[0.465, 0.79], [0.5, 0.88], [0.535, 0.79]];

function inPoly(poly, x, y) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function colorAt(x, y) {
  const d = Math.hypot(x - 0.5, y - 0.5);
  if (inPoly(HULL, x, y)) return SHIP;
  if (inPoly(FLAME, x, y)) return GLOW;
  if (d > 0.4 && d <= 0.43) return RING;
  if (d <= 0.4) return DISC;
  return BG;
}

function render(size) {
  const ss = 3; // samples per axis for antialiasing
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let py = 0; py < size; py++) {
    raw[py * (size * 4 + 1)] = 0; // filter: none
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const c = colorAt((px + (sx + 0.5) / ss) / size, (py + (sy + 0.5) / ss) / size);
          r += c[0]; g += c[1]; b += c[2];
        }
      }
      const n = ss * ss;
      const o = py * (size * 4 + 1) + 1 + px * 4;
      raw[o] = Math.round(r / n);
      raw[o + 1] = Math.round(g / n);
      raw[o + 2] = Math.round(b / n);
      raw[o + 3] = 255;
    }
  }
  return raw;
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(render(size), { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync('public/icons', { recursive: true });
for (const size of [192, 512]) {
  writeFileSync(`public/icons/icon-${size}.png`, png(size));
  console.log(`wrote public/icons/icon-${size}.png`);
}
