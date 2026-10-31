/** Shop icons: a shaded canvas thumbnail per ship, and a vector glyph per outfit category. */
import type { OutfitDef, ShipDef } from '../data/schemas';
import { drawShipFrame } from '../render/sprites';

/** Draws one frame of the ship, nose up, into a new size x size canvas. */
export function shipIcon(def: ShipDef, size: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  c.setAttribute('class', 'ship-icon');
  c.setAttribute('data-hull', def.hull);
  const ctx = c.getContext('2d');
  if (ctx) drawShipFrame(ctx, size, def);
  return c;
}

/** Stroke colour per tech tier: grey (1) stepping to gold (5). */
export const TIER_STROKE = ['#9aa0a6', '#8fb4c9', '#7fd0a8', '#e0c35a', '#ffb81c'] as const;

const SVG_NS = 'http://www.w3.org/2000/svg';

/** One original glyph per category, drawn in a 24x24 box. */
const GLYPHS: Record<OutfitDef['category'], string[]> = {
  // Stacked crates.
  cargo: ['M3 11h8v8H3z', 'M13 11h8v8h-8z', 'M8 3h8v8H8z', 'M12 3v8'],
  // Drop over a gauge arc.
  fuel: ['M12 3c3 4 5 6.5 5 9a5 5 0 0 1-10 0c0-2.5 2-5 5-9z', 'M4 21h16', 'M9.5 13.5a2.5 2.5 0 0 0 2.5 2.5'],
  // Layered plating chevrons.
  armor: ['M12 3l8 3v6c0 4.5-3.500 7.5-8 9-4.5-1.5-8-4.5-8-9V6z', 'M8 9l4 2.5L16 9', 'M8 13l4 2.5 4-2.5'],
  // Dome with a field arc.
  shields: ['M3 18a9 9 0 0 1 18 0z', 'M7 18a5 5 0 0 1 10 0', 'M12 4v2', 'M4 21h16'],
  // Star chart: three nodes joined by lanes.
  map: ['M5 17l6-9 8 6', 'M5 17h0', 'M11 8h0', 'M19 14h0', 'M3 21h18'],
  // Funnel scoop gathering into a point.
  scoop: ['M3 5h18l-6 8v7l-6-3v-4z', 'M7 5l3 5', 'M17 5l-3 5'],
  // Barrel with a muzzle flash.
  gun: ['M3 10h12v4H3z', 'M15 12h3', 'M20 9l-2 3 2 3', 'M6 14v5h3v-5'],
  // Round mount with a pivoting barrel.
  turret: ['M12 12m-6 0a6 6 0 1 0 12 0a6 6 0 1 0-12 0', 'M12 12l8-8', 'M17 3l4 0 0 4', 'M12 18v3'],
  // Tube rack with two ports.
  launcher: ['M3 8h18v8H3z', 'M8 8v8', 'M16 8v8', 'M5 20h14'],
  // Missile body with fins.
  ammo: ['M6 18L16 8', 'M16 8l3-4 1 1-4 3', 'M6 18l-2-5 4 1z', 'M6 18l5 2-1-4z'],
  // Straight beam from an emitter.
  beam: ['M3 9h4v6H3z', 'M7 12h14', 'M17 9l4 3-4 3'],
  // Capsule with a hatch window.
  pod: ['M7 4h10a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3z', 'M12 12m-3 0a3 3 0 1 0 6 0a3 3 0 1 0-6 0'],
  // Box with scrambled signal lines.
  scrambler: ['M4 8h16v10H4z', 'M7 13l2-2 2 3 2-4 2 3 2-2', 'M9 8V5', 'M15 8V5'],
};

/** Outline glyph for an outfit; `data-stroke` records the tier colour. */
export function outfitIcon(def: OutfitDef, size: number): SVGSVGElement {
  const stroke = TIER_STROKE[Math.min(5, Math.max(1, def.techTier)) - 1];
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('class', 'outfit-icon');
  svg.setAttribute('data-category', def.category);
  svg.setAttribute('data-stroke', stroke);
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', stroke);
  svg.setAttribute('stroke-width', '1.6');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  for (const d of GLYPHS[def.category]) {
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', d);
    svg.append(path);
  }
  return svg;
}
