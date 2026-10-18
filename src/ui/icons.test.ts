// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { loadGameData } from '../data/load';
import type { OutfitDef, ShipDef } from '../data/schemas';
import { HULL_PROFILES } from '../render/sprites';
import { outfitIcon, shipIcon } from './icons';

const CATEGORIES: OutfitDef['category'][] = ['cargo', 'fuel', 'armor', 'shields', 'map', 'scoop'];
const HULLS: ShipDef['hull'][] = ['pod', 'dart', 'wedge', 'hauler', 'liner', 'carrier'];

describe('outfitIcon', () => {
  it('returns an svg tagged with its category for all categories', () => {
    for (const category of CATEGORIES) {
      const def = { id: 'x', name: 'X', description: '', price: 1, techTier: 1, space: 1, max: 1, category, effect: {} } as unknown as OutfitDef;
      const svg = outfitIcon(def, 24);
      expect(svg.tagName.toLowerCase()).toBe('svg');
      expect(svg.getAttribute('data-category')).toBe(category);
      expect(svg.getAttribute('width')).toBe('24');
    }
  });

  it('steps stroke colour with tech tier', () => {
    const mk = (techTier: number) =>
      outfitIcon({ category: 'fuel', techTier } as unknown as OutfitDef, 20).getAttribute('data-stroke');
    expect(new Set([1, 2, 3, 4, 5].map(mk)).size).toBe(5);
  });
});

describe('shipIcon', () => {
  it('returns a canvas of the requested size for every hull', async () => {
    const data = await loadGameData();
    const base = Object.values(data.ships)[0];
    for (const hull of HULLS) {
      const c = shipIcon({ ...base, hull }, 48);
      expect(c.tagName.toLowerCase()).toBe('canvas');
      expect(c.width).toBe(48);
      expect(c.height).toBe(48);
    }
  });
});

describe('hull profiles', () => {
  it('gives every hull a distinct outline', () => {
    const outlines = HULLS.map((h) => JSON.stringify(HULL_PROFILES[h].half));
    expect(new Set(outlines).size).toBe(HULLS.length);
  });
});
