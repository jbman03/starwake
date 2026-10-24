import { describe, expect, it, vi } from 'vitest';
import { LOCKED_VIEWPORT, installZoomBlock, pageDisplaced, restoreViewport, type GuardWindow } from './viewportGuard';

function fakeWindow(vv: { scale: number; offsetTop: number; offsetLeft: number } | null, scrollX = 0, scrollY = 0) {
  const listeners: Record<string, ((e: Event) => void)[]> = {};
  const meta = { content: 'width=device-width, initial-scale=1, viewport-fit=cover' };
  const w = {
    visualViewport: vv,
    scrollX,
    scrollY,
    scrollTo: vi.fn(),
    document: {
      querySelector: (sel: string) => (sel === 'meta[name="viewport"]' ? meta : null),
      addEventListener: (type: string, fn: (e: Event) => void) => (listeners[type] ??= []).push(fn),
    },
  };
  return { w: w as unknown as GuardWindow, meta, listeners };
}

describe('pageDisplaced', () => {
  it('is false for an unzoomed, unscrolled page', () => {
    expect(pageDisplaced(fakeWindow({ scale: 1, offsetTop: 0, offsetLeft: 0 }).w)).toBe(false);
  });

  it('is true when the page is pinch- or double-tap-zoomed', () => {
    expect(pageDisplaced(fakeWindow({ scale: 2, offsetTop: 0, offsetLeft: 0 }).w)).toBe(true);
  });

  it('is true when the visual viewport is panned or the page is scrolled', () => {
    expect(pageDisplaced(fakeWindow({ scale: 1, offsetTop: 120, offsetLeft: 0 }).w)).toBe(true);
    expect(pageDisplaced(fakeWindow({ scale: 1, offsetTop: 0, offsetLeft: 0 }, 0, 80).w)).toBe(true);
  });

  it('copes with browsers that have no visualViewport', () => {
    expect(pageDisplaced(fakeWindow(null).w)).toBe(false);
  });
});

describe('restoreViewport', () => {
  it('scrolls to the origin, re-applies the locked viewport and refreshes the game scale', () => {
    const { w, meta } = fakeWindow({ scale: 2.4, offsetTop: 200, offsetLeft: 90 }, 0, 150);
    const refresh = vi.fn();
    expect(restoreViewport(w, refresh)).toBe(true);
    expect(w.scrollTo).toHaveBeenCalledWith(0, 0);
    expect(meta.content).toBe(LOCKED_VIEWPORT);
    expect(refresh).toHaveBeenCalled();
  });

  it('does nothing when the page is already in place', () => {
    const { w, meta } = fakeWindow({ scale: 1, offsetTop: 0, offsetLeft: 0 });
    const refresh = vi.fn();
    expect(restoreViewport(w, refresh)).toBe(false);
    expect(w.scrollTo).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
    expect(meta.content).not.toBe(LOCKED_VIEWPORT);
  });
});

describe('installZoomBlock', () => {
  const ev = (extra: object) => ({ preventDefault: vi.fn(), ...extra }) as unknown as Event & { preventDefault: ReturnType<typeof vi.fn> };

  it('blocks WebKit pinch gestures', () => {
    const { w, listeners } = fakeWindow({ scale: 1, offsetTop: 0, offsetLeft: 0 });
    installZoomBlock(w);
    for (const type of ['gesturestart', 'gesturechange']) {
      const e = ev({});
      listeners[type].forEach((fn) => fn(e));
      expect(e.preventDefault).toHaveBeenCalled();
    }
  });

  it('blocks two-finger touch moves but leaves one-finger scrolling alone', () => {
    const { w, listeners } = fakeWindow({ scale: 1, offsetTop: 0, offsetLeft: 0 });
    installZoomBlock(w);
    const two = ev({ touches: { length: 2 } });
    const one = ev({ touches: { length: 1 } });
    listeners.touchmove.forEach((fn) => fn(two));
    listeners.touchmove.forEach((fn) => fn(one));
    expect(two.preventDefault).toHaveBeenCalled();
    expect(one.preventDefault).not.toHaveBeenCalled();
  });
});
