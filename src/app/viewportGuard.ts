/**
 * Keeps the page itself from zooming or scrolling under the game.
 *
 * On iPhone browsers (all WebKit) a double-tap or pinch on a planet screen zooms and pans the whole
 * page, and a long screen can scroll it. Back in flight the game canvas swallows every gesture, so
 * the player can't undo it: the ship sits off-centre (e.g. at the bottom) for the rest of the session.
 * We block page zoom where we can, and whenever flight resumes we snap the page back.
 */

/** The viewport meta we (re)apply. maximum-scale=1 also resets an existing zoom on iOS. */
export const LOCKED_VIEWPORT = 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover';

/** The slice of `window` the guard uses (a fake in tests). */
export interface GuardWindow {
  visualViewport: { scale: number; offsetTop: number; offsetLeft: number } | null;
  scrollX: number;
  scrollY: number;
  scrollTo(x: number, y: number): void;
  document: {
    querySelector(sel: string): { content: string } | null;
    addEventListener(type: string, fn: (e: Event) => void, opts?: AddEventListenerOptions): void;
  };
}

/** Is the page zoomed, panned or scrolled away from its normal place? */
export function pageDisplaced(w: GuardWindow): boolean {
  const vv = w.visualViewport;
  const zoomedOrPanned = !!vv && (Math.abs(vv.scale - 1) > 0.01 || Math.abs(vv.offsetTop) > 0.5 || Math.abs(vv.offsetLeft) > 0.5);
  return zoomedOrPanned || w.scrollX !== 0 || w.scrollY !== 0;
}

/** Put a displaced page back (unzoomed, unscrolled) and let the game re-measure. Returns whether it acted. */
export function restoreViewport(w: GuardWindow, refreshGame: () => void): boolean {
  if (!pageDisplaced(w)) return false;
  const meta = w.document.querySelector('meta[name="viewport"]');
  if (meta) meta.content = LOCKED_VIEWPORT;
  w.scrollTo(0, 0);
  refreshGame();
  return true;
}

/** Block pinch-zoom: WebKit's gesture events, and any two-finger touch move. One-finger scrolling still works. */
export function installZoomBlock(w: GuardWindow): void {
  const stop = (e: Event) => e.preventDefault();
  w.document.addEventListener('gesturestart', stop, { passive: false });
  w.document.addEventListener('gesturechange', stop, { passive: false });
  w.document.addEventListener(
    'touchmove',
    (e) => {
      if (((e as TouchEvent).touches?.length ?? 0) > 1) e.preventDefault();
    },
    { passive: false },
  );
}
