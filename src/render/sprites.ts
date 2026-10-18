/**
 * Procedural placeholder art in a classic pre-rendered style: ships get 36 rotation frames
 * whose lighting stays fixed (light from the top-left of the screen), planets are lit spheres.
 * Everything is generated into canvases here; no image files.
 */
import type Phaser from 'phaser';
import type { PlanetDef, ShipDef, SystemDef } from '../data/schemas';

export const SHIP_FRAMES = 36;
const FRAME_STEP = (Math.PI * 2) / SHIP_FRAMES;

/** Screen-space light direction (toward the light): top-left, somewhat above. */
const LIGHT = normalize3(-0.55, -0.6, 0.58);

/** Frame index for a heading in radians (0 = +x, clockwise on screen since y points down). */
export function shipFrame(heading: number): number {
  const i = Math.round(heading / FRAME_STEP) % SHIP_FRAMES;
  return (i + SHIP_FRAMES) % SHIP_FRAMES;
}

export const shipTextureKey = (def: ShipDef) => `ship:${def.id}`;
export const planetTextureKey = (p: PlanetDef) => `planet:${p.id}`;
export const starTextureKey = (s: SystemDef) => `star:${s.id}`;
export const starfieldKey = (layer: number) => `starfield:${layer}`;

// ---------------------------------------------------------------- helpers

function normalize3(x: number, y: number, z: number): [number, number, number] {
  const l = Math.hypot(x, y, z);
  return [x / l, y / l, z / l];
}

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Small deterministic PRNG (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const smooth = (e0: number, e1: number, x: number) => {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d', { willReadFrequently: true })!];
}

function addCanvasTexture(scene: Phaser.Scene, key: string, c: HTMLCanvasElement): Phaser.Textures.CanvasTexture {
  if (scene.textures.exists(key)) scene.textures.remove(key);
  const tex = scene.textures.addCanvas(key, c);
  if (!tex) throw new Error(`could not create texture ${key}`);
  return tex;
}

/** 3D value noise with smooth interpolation, seeded. */
function makeNoise3(seed: number): (x: number, y: number, z: number) => number {
  const perm = new Uint8Array(512);
  const r = rng(seed);
  const p = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [p[i], p[j]] = [p[j], p[i]];
  }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  const val = (x: number, y: number, z: number) => perm[(perm[(perm[x & 255] + y) & 255] + z) & 255] / 255;
  const f = (t: number) => t * t * (3 - 2 * t);
  return (x, y, z) => {
    const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
    const xf = f(x - xi), yf = f(y - yi), zf = f(z - zi);
    const c = (dx: number, dy: number, dz: number) => val(xi + dx, yi + dy, zi + dz);
    const x00 = lerp(c(0, 0, 0), c(1, 0, 0), xf), x10 = lerp(c(0, 1, 0), c(1, 1, 0), xf);
    const x01 = lerp(c(0, 0, 1), c(1, 0, 1), xf), x11 = lerp(c(0, 1, 1), c(1, 1, 1), xf);
    return lerp(lerp(x00, x10, yf), lerp(x01, x11, yf), zf);
  };
}

function fbm(n: (x: number, y: number, z: number) => number, x: number, y: number, z: number, oct = 5): number {
  let sum = 0, amp = 0.5, freq = 1, norm = 0;
  for (let i = 0; i < oct; i++) {
    sum += amp * n(x * freq, y * freq, z * freq);
    norm += amp;
    amp *= 0.5;
    freq *= 2.03;
  }
  return sum / norm;
}

/** Separable box blur on a single-channel float image (in place via temp). */
function boxBlur(src: Float32Array, w: number, h: number, r: number): Float32Array {
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  const n = 2 * r + 1;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let k = -r; k <= r; k++) s += src[y * w + Math.min(w - 1, Math.max(0, x + k))];
      tmp[y * w + x] = s / n;
    }
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let k = -r; k <= r; k++) s += tmp[Math.min(h - 1, Math.max(0, y + k)) * w + x];
      out[y * w + x] = s / n;
    }
  return out;
}

// ---------------------------------------------------------------- ships

type Pt = [number, number];
type Hull = ShipDef['hull'];

interface HullProfile {
  /** Hull outline in units of ship radius, nose toward +x. Mirrored about the x axis. */
  half: Pt[];
  /** Raised centre body. */
  fuselage: Pt[];
  /** Cockpit canopy: centre x, half-length, half-width. */
  canopy: [number, number, number];
  /** Accent stripe polygon for the +y side (mirrored to -y). */
  stripe: Pt[];
  /** x positions of panel seams across the fuselage, and the seam half-width. */
  seams: number[];
  seamHalfWidth: number;
  /** Engine nozzle rectangles for the +y side (x, y, w, h); mirrored to -y. */
  nozzles: [number, number, number, number][];
}

const HULL_HALF: Pt[] = [
  [1.05, 0],
  [0.75, 0.16],
  [0.3, 0.3],
  [0.0, 0.34],
  [-0.2, 0.88],
  [-0.42, 0.98],
  [-0.62, 0.92],
  [-0.55, 0.4],
  [-0.78, 0.34],
  [-0.86, 0.2],
];
const FUSELAGE_HALF: Pt[] = [
  [0.95, 0],
  [0.6, 0.15],
  [0.1, 0.24],
  [-0.6, 0.24],
  [-0.8, 0.14],
];

/** One silhouette per hull class. `pod` is the original starter shuttle shape. */
export const HULL_PROFILES: Record<Hull, HullProfile> = {
  // Starter shuttle: stubby body with broad rear wings.
  pod: {
    half: HULL_HALF,
    fuselage: FUSELAGE_HALF,
    canopy: [0.42, 0.24, 0.1],
    stripe: [[-0.28, 0.55], [-0.4, 0.86], [-0.5, 0.84], [-0.38, 0.5]],
    seams: [-0.1, -0.45],
    seamHalfWidth: 0.24,
    nozzles: [[-0.88, 0.06, 0.1, 0.14]],
  },
  // Slim needle nose with long swept-back blades.
  dart: {
    half: [
      [1.1, 0],
      [0.55, 0.07],
      [0.1, 0.13],
      [-0.2, 0.18],
      [-0.55, 0.82],
      [-0.78, 0.9],
      [-0.7, 0.34],
      [-0.9, 0.2],
      [-0.94, 0.08],
    ],
    fuselage: [[1.0, 0], [0.4, 0.09], [-0.2, 0.13], [-0.8, 0.1]],
    canopy: [0.38, 0.22, 0.06],
    stripe: [[-0.3, 0.3], [-0.6, 0.78], [-0.68, 0.8], [-0.5, 0.3]],
    seams: [0.0, -0.4],
    seamHalfWidth: 0.12,
    nozzles: [[-0.96, 0.02, 0.08, 0.1]],
  },
  // Broad arrowhead with a deep chevron cut at the stern.
  wedge: {
    half: [
      [1.0, 0],
      [0.55, 0.26],
      [0.05, 0.58],
      [-0.4, 0.92],
      [-0.78, 0.96],
      [-0.86, 0.62],
      [-0.7, 0.3],
      [-0.82, 0.12],
    ],
    fuselage: [[0.9, 0], [0.4, 0.2], [-0.2, 0.34], [-0.7, 0.3], [-0.78, 0.12]],
    canopy: [0.35, 0.26, 0.11],
    stripe: [[0.1, 0.4], [-0.3, 0.8], [-0.42, 0.78], [-0.05, 0.36]],
    seams: [0.0, -0.35],
    seamHalfWidth: 0.3,
    nozzles: [[-0.9, 0.1, 0.1, 0.18], [-0.9, 0.42, 0.1, 0.16]],
  },
  // Blunt boxy spine flanked by square cargo pods.
  hauler: {
    half: [
      [1.0, 0],
      [0.88, 0.2],
      [0.62, 0.26],
      [0.56, 0.62],
      [0.5, 0.66],
      [-0.58, 0.66],
      [-0.62, 0.5],
      [-0.62, 0.4],
      [-0.9, 0.38],
      [-0.94, 0.14],
    ],
    fuselage: [[0.9, 0], [0.7, 0.2], [-0.8, 0.22], [-0.86, 0.1]],
    canopy: [0.72, 0.14, 0.12],
    stripe: [[0.3, 0.3], [0.3, 0.6], [-0.3, 0.6], [-0.3, 0.3]],
    seams: [0.3, -0.05, -0.4],
    seamHalfWidth: 0.62,
    nozzles: [[-0.96, 0.04, 0.1, 0.12], [-0.96, 0.24, 0.1, 0.12]],
  },
  // Long, smooth spindle with a bulging mid-section and window row.
  liner: {
    half: [
      [1.08, 0],
      [0.95, 0.16],
      [0.7, 0.32],
      [0.3, 0.42],
      [-0.2, 0.46],
      [-0.65, 0.4],
      [-0.9, 0.28],
      [-1.0, 0.16],
      [-1.0, 0.06],
    ],
    fuselage: [[0.98, 0], [0.7, 0.18], [0.0, 0.3], [-0.7, 0.26], [-0.92, 0.1]],
    canopy: [0.74, 0.2, 0.1],
    stripe: [[0.45, 0.34], [-0.45, 0.4], [-0.45, 0.35], [0.45, 0.3]],
    seams: [0.3, -0.1, -0.5],
    seamHalfWidth: 0.3,
    nozzles: [[-1.04, 0.04, 0.09, 0.1]],
  },
  // Huge flat-decked slab: squared bow, wide beam, stepped stern.
  carrier: {
    half: [
      [1.0, 0.12],
      [0.94, 0.52],
      [0.62, 0.72],
      [0.0, 0.94],
      [-0.7, 0.98],
      [-0.96, 0.84],
      [-0.98, 0.5],
      [-0.9, 0.34],
      [-0.94, 0.16],
    ],
    fuselage: [[0.9, 0.1], [0.8, 0.36], [-0.8, 0.4], [-0.86, 0.14]],
    canopy: [0.55, 0.12, 0.18],
    stripe: [[0.7, 0.55], [-0.6, 0.75], [-0.6, 0.68], [0.7, 0.48]],
    seams: [0.4, 0.0, -0.4],
    seamHalfWidth: 0.4,
    nozzles: [[-1.0, 0.12, 0.1, 0.2], [-1.0, 0.5, 0.1, 0.2]],
  },
};

function mirrored(half: Pt[]): Pt[] {
  const back = half.filter((p) => p[1] !== 0).map(([x, y]) => [x, -y] as Pt).reverse();
  return [...half, ...back];
}

function pathPoly(ctx: CanvasRenderingContext2D, pts: Pt[]): void {
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
}

/** Draws into ctx with a transform that maps ship units to pixels, rotated to `angle`. */
function withShipTransform(ctx: CanvasRenderingContext2D, size: number, scale: number, angle: number, fn: () => void) {
  ctx.save();
  ctx.translate(size / 2, size / 2);
  ctx.rotate(angle);
  ctx.scale(scale, scale);
  fn();
  ctx.restore();
}

function readChannel(ctx: CanvasRenderingContext2D, size: number, ch: number): Float32Array {
  const d = ctx.getImageData(0, 0, size, size).data;
  const out = new Float32Array(size * size);
  for (let i = 0; i < out.length; i++) out[i] = d[i * 4 + ch] / 255;
  return out;
}

/** Renders one lit hull frame and returns RGBA pixels. */
function renderShipFrame(size: number, scale: number, angle: number, hue: number, hullClass: Hull): ImageData {
  const prof = HULL_PROFILES[hullClass];
  const hull = mirrored(prof.half);
  const fuselage = mirrored(prof.fuselage);
  const [cx, crx, cry] = prof.canopy;

  // Height map: wings low, fuselage raised, cockpit canopy highest.
  const [, hctx] = canvas(size, size);
  withShipTransform(hctx, size, scale, angle, () => {
    hctx.fillStyle = 'rgb(130,130,130)';
    pathPoly(hctx, hull);
    hctx.fill();
    hctx.fillStyle = 'rgb(220,220,220)';
    pathPoly(hctx, fuselage);
    hctx.fill();
    hctx.fillStyle = 'rgb(255,255,255)';
    hctx.beginPath();
    hctx.ellipse(cx, 0, crx + 0.02, cry + 0.02, 0, 0, Math.PI * 2);
    hctx.fill();
  });
  const rawHeight = readChannel(hctx, size, 0);
  const height = boxBlur(boxBlur(rawHeight, size, size, 1), size, size, 1);

  // Colour map and coverage mask.
  const [, cctx] = canvas(size, size);
  withShipTransform(cctx, size, scale, angle, () => {
    cctx.fillStyle = `hsl(${hue}, 12%, 62%)`;
    pathPoly(cctx, hull);
    cctx.fill();
    cctx.fillStyle = `hsl(${hue}, 10%, 72%)`;
    pathPoly(cctx, fuselage);
    cctx.fill();
    // Wing stripes and panel seams.
    cctx.fillStyle = `hsl(${(hue + 180) % 360}, 55%, 45%)`;
    for (const s of [1, -1]) {
      cctx.beginPath();
      prof.stripe.forEach(([x, y], i) => (i ? cctx.lineTo(x, y * s) : cctx.moveTo(x, y * s)));
      cctx.closePath();
      cctx.fill();
    }
    cctx.strokeStyle = 'rgba(40,40,48,0.55)';
    cctx.lineWidth = 0.035;
    cctx.beginPath();
    for (const x of prof.seams) {
      cctx.moveTo(x, -prof.seamHalfWidth);
      cctx.lineTo(x, prof.seamHalfWidth);
    }
    cctx.stroke();
    // Canopy glass.
    cctx.fillStyle = 'rgb(40,70,110)';
    cctx.beginPath();
    cctx.ellipse(cx, 0, crx, cry, 0, 0, Math.PI * 2);
    cctx.fill();
    // Engine nozzles (dark).
    cctx.fillStyle = 'rgb(35,35,40)';
    for (const [x, y, w, h] of prof.nozzles) {
      cctx.fillRect(x, y, w, h);
      cctx.fillRect(x, -y - h, w, h);
    }
  });
  const col = cctx.getImageData(0, 0, size, size);
  const px = col.data;

  // Light it: normals from the height gradient, Lambert + Blinn specular, fixed screen-space light.
  const bump = 2.2;
  const [lx, ly, lz] = LIGHT;
  const [hx, hy, hz] = normalize3(lx, ly, lz + 1);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const a = px[i * 4 + 3];
      if (a === 0) continue;
      const hL = height[y * size + Math.max(0, x - 1)], hR = height[y * size + Math.min(size - 1, x + 1)];
      const hU = height[Math.max(0, y - 1) * size + x], hD = height[Math.min(size - 1, y + 1) * size + x];
      const [nx, ny, nz] = normalize3((hL - hR) * bump, (hU - hD) * bump, 1);
      const diff = Math.max(0, nx * lx + ny * ly + nz * lz);
      const spec = Math.pow(Math.max(0, nx * hx + ny * hy + nz * hz), 28) * 0.55;
      const shade = 0.22 + diff * 0.95;
      for (let c = 0; c < 3; c++) px[i * 4 + c] = Math.min(255, px[i * 4 + c] * shade + spec * 255);
    }
  }
  return col;
}

/** Draws one shaded frame of `def` at heading -90 degrees (nose up) filling a size x size context. */
export function drawShipFrame(ctx: CanvasRenderingContext2D, size: number, def: ShipDef): void {
  const scale = size / 2.4;
  ctx.putImageData(renderShipFrame(size, scale, -Math.PI / 2, hashString(def.id) % 360, def.hull), 0, 0);
}

/**
 * Generates SHIP_FRAMES frames (10° steps) of a shaded hull into one texture keyed
 * `shipTextureKey(def)`, with frames named 0..35. Use `shipFrame(heading)` to pick one.
 */
export function makeShipTextures(scene: Phaser.Scene, def: ShipDef): string {
  const key = shipTextureKey(def);
  const scale = def.radius * 1.35; // hull extends to ~1.05 units
  const size = Math.ceil(scale * 2.4 / 2) * 2;
  const cols = 6;
  const rows = Math.ceil(SHIP_FRAMES / cols);
  const [sheet, sctx] = canvas(cols * size, rows * size);
  const hue = hashString(def.id) % 360;
  for (let f = 0; f < SHIP_FRAMES; f++) {
    const img = renderShipFrame(size, scale, f * FRAME_STEP, hue, def.hull);
    const fx = (f % cols) * size, fy = Math.floor(f / cols) * size;
    sctx.putImageData(img, fx, fy);
    // Engine glow, drawn after lighting so it stays bright.
    const back = (-0.92 * scale);
    const gx = fx + size / 2 + Math.cos(f * FRAME_STEP) * back;
    const gy = fy + size / 2 + Math.sin(f * FRAME_STEP) * back;
    const g = sctx.createRadialGradient(gx, gy, 0, gx, gy, scale * 0.3);
    g.addColorStop(0, 'rgba(255,230,170,0.9)');
    g.addColorStop(0.4, 'rgba(255,140,60,0.45)');
    g.addColorStop(1, 'rgba(255,90,30,0)');
    sctx.save();
    sctx.globalCompositeOperation = 'lighter';
    sctx.fillStyle = g;
    sctx.fillRect(fx, fy, size, size);
    sctx.restore();
  }
  const tex = addCanvasTexture(scene, key, sheet);
  for (let f = 0; f < SHIP_FRAMES; f++) {
    tex.add(f, 0, (f % cols) * size, Math.floor(f / cols) * size, size, size);
  }
  tex.refresh();
  return key;
}

// ---------------------------------------------------------------- planets & stations

type RGB = [number, number, number];
const mix = (a: RGB, b: RGB, t: number): RGB => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

type Palette = { kind: 'terran' | 'rock' | 'gas' | 'ice'; stops: RGB[]; atmo: RGB | null };
const PALETTES: Palette[] = [
  { kind: 'terran', stops: [[20, 50, 110], [35, 85, 150], [70, 120, 60], [120, 110, 70], [235, 235, 235]], atmo: [120, 170, 255] },
  { kind: 'rock', stops: [[70, 55, 45], [120, 95, 75], [165, 140, 115], [200, 185, 160]], atmo: null },
  { kind: 'gas', stops: [[150, 100, 60], [200, 160, 110], [230, 210, 170], [170, 120, 80]], atmo: [255, 210, 160] },
  { kind: 'ice', stops: [[110, 140, 170], [170, 200, 220], [225, 235, 245]], atmo: [190, 220, 255] },
];

function ramp(stops: RGB[], t: number): RGB {
  const x = clamp01(t) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(x));
  return mix(stops[i], stops[i + 1], x - i);
}

/** Radial-gradient-lit sphere with procedural surface, light from top-left. */
function renderPlanet(radius: number, seed: number): HTMLCanvasElement {
  const pad = Math.ceil(radius * 0.12) + 2;
  const size = Math.ceil(radius * 2 + pad * 2);
  const [c, ctx] = canvas(size, size);
  const img = ctx.createImageData(size, size);
  const px = img.data;
  const pal = PALETTES[seed % PALETTES.length];
  const noise = makeNoise3(seed);
  const [lx, ly, lz] = LIGHT;
  const tilt = ((seed >> 8) % 100) / 400;
  const cx = size / 2, cy = size / 2;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5 - cx) / radius, v = (y + 0.5 - cy) / radius;
      const r2 = u * u + v * v;
      const r = Math.sqrt(r2);
      const i = (y * size + x) * 4;
      if (r > 1 + pad / radius) continue;

      if (r <= 1) {
        const z = Math.sqrt(Math.max(0, 1 - r2));
        let col: RGB;
        if (pal.kind === 'gas') {
          const band = v + tilt * u + (fbm(noise, u * 2, v * 2, z * 2, 3) - 0.5) * 0.35;
          col = ramp(pal.stops, 0.5 + 0.5 * Math.sin(band * 9 + seed));
        } else {
          const n = fbm(noise, u * 2.4 + 5, v * 2.4, z * 2.4);
          if (pal.kind === 'terran') {
            const lat = Math.abs(v);
            col = n < 0.5 ? ramp(pal.stops.slice(0, 2), n / 0.5) : ramp(pal.stops.slice(2, 4), (n - 0.5) / 0.3);
            if (lat > 0.82 || fbm(noise, u * 5, v * 5 + 9, z * 5, 3) > 0.68) col = mix(col, pal.stops[4], 0.85);
          } else {
            col = ramp(pal.stops, n * 1.3 - 0.15);
            const crater = fbm(noise, u * 7 + 3, v * 7, z * 7, 2);
            if (crater > 0.7) col = mix(col, [40, 35, 30], (crater - 0.7) * 1.6);
          }
        }
        // Normal is (u, v, z); soft terminator plus a touch of ambient.
        const nl = u * lx + v * ly + z * lz;
        const diff = smooth(-0.15, 0.6, nl);
        const shade = 0.05 + diff * 1.05;
        const spec = pal.kind === 'terran' ? Math.pow(Math.max(0, nl), 18) * 0.2 : 0;
        let out = col.map((ch) => ch * shade + spec * 255) as RGB;
        if (pal.atmo) out = mix(out, pal.atmo, Math.pow(r, 6) * 0.55 * smooth(-0.3, 0.4, nl));
        px[i] = Math.min(255, out[0]);
        px[i + 1] = Math.min(255, out[1]);
        px[i + 2] = Math.min(255, out[2]);
        px[i + 3] = Math.round(255 * clamp01((1 - r) * radius + 0.5));
      }
      // Atmospheric halo just outside the limb on the lit side.
      if (pal.atmo && r > 1 - 1 / radius) {
        const h = Math.pow(1 - clamp01((r - 1) / (pad / radius)), 2);
        const lit = smooth(-0.2, 0.5, (u * lx + v * ly) / Math.max(r, 1e-6));
        const a = h * lit * 0.6 * 255;
        if (px[i + 3] < a) {
          px[i] = pal.atmo[0];
          px[i + 1] = pal.atmo[1];
          px[i + 2] = pal.atmo[2];
          px[i + 3] = a;
        }
      }
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

/** Shaded hub with a raised docking ring and spokes, seen from above. */
function renderStation(radius: number, seed: number): HTMLCanvasElement {
  const size = Math.ceil(radius * 2 + 4);
  const [c, ctx] = canvas(size, size);
  const img = ctx.createImageData(size, size);
  const px = img.data;
  const [lx, ly, lz] = LIGHT;
  const cx = size / 2, cy = size / 2;
  const R0 = 0.72, R1 = 0.98, HUB = 0.42;
  const spokeAngle = ((seed % 90) * Math.PI) / 180;
  const base: RGB = [150, 155, 165];

  const shadeOf = (nx: number, ny: number, nz: number, col: RGB, specK = 0.5): RGB => {
    const d = Math.max(0, nx * lx + ny * ly + nz * lz);
    const s = Math.pow(Math.max(0, d), 20) * specK * 255;
    return col.map((ch) => Math.min(255, ch * (0.18 + 0.95 * d) + s)) as RGB;
  };

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5 - cx) / radius, v = (y + 0.5 - cy) / radius;
      const r = Math.hypot(u, v);
      const i = (y * size + x) * 4;
      let out: RGB | null = null;
      let alpha = 1;
      if (r <= HUB) {
        const q = r / HUB;
        out = shadeOf(u / HUB, v / HUB, Math.sqrt(Math.max(0, 1 - q * q)), base);
        alpha = clamp01((HUB - r) * radius + 0.5);
      } else if (r >= R0 && r <= R1) {
        // Torus cross-section: normal tilts outward/inward across the ring's width.
        const t = ((r - R0) / (R1 - R0)) * 2 - 1;
        const nz = Math.sqrt(Math.max(0, 1 - t * t));
        out = shadeOf((u / r) * t, (v / r) * t, nz, [140, 140, 150]);
        // Window lights.
        const ang = Math.atan2(v, u);
        if (Math.abs(t) < 0.25 && Math.sin(ang * 24) > 0.85) out = [255, 220, 140];
        alpha = clamp01(Math.min(r - R0, R1 - r) * radius + 0.5);
      } else if (r > HUB && r < R0) {
        const ang = Math.atan2(v, u) - spokeAngle;
        const w = Math.abs(Math.sin(ang * 2)) * r; // 4 spokes
        if (w < 0.07) {
          out = shadeOf(0, 0, 1, [110, 112, 120]);
          alpha = clamp01((0.07 - w) * radius + 0.5);
        }
      }
      if (out) {
        px[i] = out[0];
        px[i + 1] = out[1];
        px[i + 2] = out[2];
        px[i + 3] = Math.round(alpha * 255);
      }
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

/** Planet texture (lit sphere) or, for stations, a shaded disc with a ring. */
export function makePlanetTexture(scene: Phaser.Scene, planet: PlanetDef): string {
  const key = planetTextureKey(planet);
  if (scene.textures.exists(key)) return key;
  const seed = hashString(planet.id);
  const c = planet.kind === 'station' ? renderStation(planet.radius, seed) : renderPlanet(planet.radius, seed);
  addCanvasTexture(scene, key, c);
  return key;
}

/** Glowing star disc; texture is larger than the disc to hold the corona. */
export function makeStarTexture(scene: Phaser.Scene, sys: SystemDef): string {
  const key = starTextureKey(sys);
  if (scene.textures.exists(key)) return key;
  const R = sys.starRadius;
  const size = Math.ceil(R * 5);
  const [c, ctx] = canvas(size, size);
  const h = hashString(sys.id);
  const tints: RGB[] = [[255, 220, 150], [255, 190, 120], [200, 220, 255], [255, 240, 210]];
  const [r, g, b] = tints[h % tints.length];
  const m = size / 2;
  const glow = ctx.createRadialGradient(m, m, R * 0.6, m, m, m);
  glow.addColorStop(0, `rgba(${r},${g},${b},0.55)`);
  glow.addColorStop(0.3, `rgba(${r},${g * 0.85},${b * 0.7},0.18)`);
  glow.addColorStop(1, `rgba(${r},${g * 0.7},${b * 0.5},0)`);
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, size, size);
  const disc = ctx.createRadialGradient(m, m, 0, m, m, R);
  disc.addColorStop(0, 'rgb(255,255,250)');
  disc.addColorStop(0.7, `rgb(${Math.min(255, r + 20)},${Math.min(255, g + 20)},${Math.min(255, b + 20)})`);
  disc.addColorStop(1, `rgb(${r},${g * 0.9},${b * 0.8})`);
  ctx.fillStyle = disc;
  ctx.beginPath();
  ctx.arc(m, m, R, 0, Math.PI * 2);
  ctx.fill();
  addCanvasTexture(scene, key, c);
  return key;
}

/** Tileable star layer: `layer` 0 is far/dim/dense, higher layers are nearer and brighter. */
export function makeStarfieldTexture(scene: Phaser.Scene, layer: number): string {
  const key = starfieldKey(layer);
  if (scene.textures.exists(key)) return key;
  const size = 512;
  const [c, ctx] = canvas(size, size);
  const r = rng(1000 + layer * 77);
  const count = [420, 140, 45][layer] ?? 60;
  for (let i = 0; i < count; i++) {
    const x = r() * size, y = r() * size;
    const bright = (0.35 + r() * 0.65) * (0.55 + layer * 0.22);
    const tint = r();
    const col = tint < 0.1 ? [180, 200, 255] : tint < 0.17 ? [255, 220, 180] : [255, 255, 255];
    const sz = layer === 2 && r() < 0.35 ? 2 : 1;
    ctx.fillStyle = `rgba(${col[0]},${col[1]},${col[2]},${clamp01(bright)})`;
    ctx.fillRect(Math.floor(x), Math.floor(y), sz, sz);
  }
  addCanvasTexture(scene, key, c);
  return key;
}
