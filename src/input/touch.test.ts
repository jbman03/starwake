import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../save/settings';
import {
  BUTTON_SIZES,
  computeLayout,
  FIRE_SCALE,
  MIN_RAIL_WIDTH,
  railMetrics,
  rectsIntersect,
  stickFromOffset,
  TouchSource,
  type Rect,
} from './touch';

const touch = (over: Partial<typeof DEFAULT_SETTINGS.touch> = {}) => ({ ...DEFAULT_SETTINGS.touch, ...over });

describe('computeLayout', () => {
  it('wide phone (844×390): opaque rails ≥120 px each, full-height view between them, clear = view', () => {
    const l = computeLayout(844, 390, touch());
    expect(l.overlayRails).toBe(false);
    expect(l.leftRail.w).toBeGreaterThanOrEqual(MIN_RAIL_WIDTH);
    expect(l.rightRail.w).toBeGreaterThanOrEqual(MIN_RAIL_WIDTH);
    expect(l.leftRail).toEqual({ x: 0, y: 0, w: 120, h: 390 });
    expect(l.rightRail).toEqual({ x: 724, y: 0, w: 120, h: 390 });
    expect(l.view).toEqual({ x: 120, y: 0, w: 604, h: 390 });
    expect(l.clear).toEqual(l.view);
    expect(rectsIntersect(l.leftRail, l.view)).toBe(false);
    expect(rectsIntersect(l.rightRail, l.view)).toBe(false);
  });

  it('very wide screen: rails take the width beyond 16:9', () => {
    const l = computeLayout(2000, 500, touch());
    const railW = (2000 - (500 * 16) / 9) / 2;
    expect(l.leftRail.w).toBeCloseTo(railW, 6);
    expect(l.view.w).toBeCloseTo((500 * 16) / 9, 6);
    expect(l.view.h).toBe(500);
  });

  it('4:3 tablet (800×600): rails overlay the outer 18% of a full-screen view; clear excludes them', () => {
    const l = computeLayout(800, 600, touch());
    expect(l.overlayRails).toBe(true);
    expect(l.view).toEqual({ x: 0, y: 0, w: 800, h: 600 });
    expect(l.leftRail).toEqual({ x: 0, y: 0, w: 144, h: 600 });
    expect(l.rightRail).toEqual({ x: 656, y: 0, w: 144, h: 600 });
    expect(l.clear).toEqual({ x: 144, y: 0, w: 512, h: 600 });
    expect(rectsIntersect(l.leftRail, l.clear)).toBe(false);
    expect(rectsIntersect(l.rightRail, l.clear)).toBe(false);
  });

  it('mirror swaps the rails', () => {
    for (const [w, h] of [[844, 390], [800, 600]]) {
      const a = computeLayout(w, h, touch());
      const b = computeLayout(w, h, touch({ mirror: true }));
      expect(b.leftRail).toEqual(a.rightRail);
      expect(b.rightRail).toEqual(a.leftRail);
      expect(b.view).toEqual(a.view);
      expect(b.clear).toEqual(a.clear);
    }
  });
});

describe('rectsIntersect', () => {
  const r = (x: number, y: number, w: number, h: number): Rect => ({ x, y, w, h });
  it('touching edges do not intersect; overlap does', () => {
    expect(rectsIntersect(r(0, 0, 10, 10), r(10, 0, 10, 10))).toBe(false);
    expect(rectsIntersect(r(0, 0, 10, 10), r(9, 9, 10, 10))).toBe(true);
  });
});

describe('computeLayout with safe-area insets', () => {
  const insets = { top: 0, right: 47, bottom: 21, left: 47 };

  it('rails include their edge inset and never intersect the view (844x390)', () => {
    for (const mirror of [false, true]) {
      const l = computeLayout(844, 390, touch({ mirror }), insets);
      expect(rectsIntersect(l.leftRail, l.view)).toBe(false);
      expect(rectsIntersect(l.rightRail, l.view)).toBe(false);
      const [physLeft, physRight] = [l.leftRail, l.rightRail].sort((a, b) => a.x - b.x);
      expect(physLeft.x).toBe(0);
      expect(physLeft.w).toBe(120 + 47);
      expect(physRight.x + physRight.w).toBe(844);
      expect(l.view.x).toBe(167);
      expect(l.view.w).toBe(844 - 2 * 167);
    }
  });

  it('overlay mode: clear excludes the inset-grown rails', () => {
    const l = computeLayout(800, 600, touch(), { top: 0, right: 40, bottom: 0, left: 30 });
    expect(rectsIntersect(l.leftRail, l.clear)).toBe(false);
    expect(rectsIntersect(l.rightRail, l.clear)).toBe(false);
  });

  it('stacks fit inside the rails minus the insets, every size and steering', () => {
    for (const mirror of [false, true]) {
      for (const size of ['S', 'M', 'L'] as const) {
        for (const steering of ['point', 'classic'] as const) {
          const l = computeLayout(844, 390, touch({ mirror }), insets);
          const m = railMetrics(l, touch({ buttonSize: size }), steering);
          const inner = Math.min(l.leftRail.w, l.rightRail.w) - 47 - 2 * m.pad;
          const usable = 390 - insets.top - insets.bottom - 2 * m.pad;
          expect(m.leftStackHeight).toBeLessThanOrEqual(usable);
          expect(m.rightStackHeight).toBeLessThanOrEqual(usable);
          expect(m.fire).toBeLessThanOrEqual(inner);
          expect(m.stick).toBeLessThanOrEqual(inner);
        }
      }
    }
  });

  it('zero insets reproduce the plain layout', () => {
    expect(computeLayout(844, 390, touch(), { top: 0, right: 0, bottom: 0, left: 0 })).toEqual(
      computeLayout(844, 390, touch()),
    );
  });
});

describe('railMetrics', () => {
  it('uses the S/M/L base size when there is room; Fire is 1.4×', () => {
    for (const size of ['S', 'M', 'L'] as const) {
      const m = railMetrics(computeLayout(1600, 700, touch()), touch({ buttonSize: size }), 'point');
      expect(m.button).toBe(BUTTON_SIZES[size]);
      expect(m.fire).toBeCloseTo(BUTTON_SIZES[size] * FIRE_SCALE, 6);
    }
  });

  it('every stack fits inside its rail on small phones, at every size and steering mode', () => {
    for (const [w, h] of [[844, 390], [932, 430], [780, 360], [667, 375], [800, 600]]) {
      for (const size of ['S', 'M', 'L'] as const) {
        for (const steering of ['point', 'classic'] as const) {
          const l = computeLayout(w, h, touch());
          const m = railMetrics(l, touch({ buttonSize: size }), steering);
          const inner = l.leftRail.w - 2 * m.pad;
          expect(m.leftStackHeight).toBeLessThanOrEqual(h - 2 * m.pad);
          expect(m.rightStackHeight).toBeLessThanOrEqual(h - 2 * m.pad);
          expect(m.fire).toBeLessThanOrEqual(inner);
          expect(m.stick).toBeLessThanOrEqual(inner);
          expect(m.radar).toBeLessThanOrEqual(inner);
          expect(m.button).toBeGreaterThanOrEqual(36);
        }
      }
    }
  });
});

describe('stickFromOffset', () => {
  it('angle uses screen convention (y down) and magnitude is clamped to 1', () => {
    const down = stickFromOffset(0, 30, 50);
    expect(down.angle).toBeCloseTo(Math.PI / 2, 6);
    expect(down.magnitude).toBeCloseTo(0.6, 6);
    expect(stickFromOffset(-200, 0, 50)).toEqual({ angle: Math.PI, magnitude: 1 });
    expect(stickFromOffset(0, 0, 50).magnitude).toBe(0);
  });
});

describe('TouchSource', () => {
  it('press/release report held and newly pressed actions; presses drain on poll', () => {
    const t = new TouchSource(() => 'point');
    t.press('firePrimary');
    let p = t.poll('flight');
    expect([...p.actions]).toEqual(['firePrimary']);
    expect([...p.pressed]).toEqual(['firePrimary']);
    p = t.poll('flight');
    expect([...p.actions]).toEqual(['firePrimary']);
    expect(p.pressed.size).toBe(0);
    t.release('firePrimary');
    expect(t.poll('flight').actions.size).toBe(0);
  });

  it('a tap shorter than one tick still registers as a press', () => {
    const t = new TouchSource(() => 'point');
    t.press('autoStop');
    t.release('autoStop');
    const p = t.poll('flight');
    expect(p.pressed.has('autoStop')).toBe(true);
    expect(p.actions.has('autoStop')).toBe(false);
  });

  it('poll filters by group', () => {
    const t = new TouchSource(() => 'point');
    t.press('firePrimary');
    expect(t.poll('menus').actions.size).toBe(0);
  });

  it('includes the stick with the current steering mode; releaseAll clears everything', () => {
    let mode: 'point' | 'classic' = 'point';
    const t = new TouchSource(() => mode);
    expect(t.poll('flight').stick).toBeUndefined();
    t.setStick(1, 0.7);
    expect(t.poll('flight').stick).toEqual({ angle: 1, magnitude: 0.7, mode: 'point' });
    mode = 'classic';
    expect(t.poll('flight').stick?.mode).toBe('classic');
    t.press('thrust');
    t.releaseAll();
    const p = t.poll('flight');
    expect(p.stick).toBeUndefined();
    expect(p.actions.size).toBe(0);
  });
});
