import { NO_INSETS, type Insets } from './touch';

let probe: HTMLElement | null = null;
let current: Insets = NO_INSETS;
let started = false;

/** Read the safe-area insets now, via a hidden element padded by env(safe-area-inset-*). */
export function measureInsets(): Insets {
  if (typeof document === 'undefined' || !document.body) return current;
  if (!probe) {
    probe = document.createElement('div');
    probe.setAttribute('aria-hidden', 'true');
    probe.style.cssText =
      'position:fixed;left:0;top:0;width:0;height:0;visibility:hidden;pointer-events:none;' +
      'padding:env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px);';
    document.body.append(probe);
  }
  const cs = getComputedStyle(probe);
  const n = (v: string) => Math.max(0, Math.round(parseFloat(v) || 0));
  current = { top: n(cs.paddingTop), right: n(cs.paddingRight), bottom: n(cs.paddingBottom), left: n(cs.paddingLeft) };
  return current;
}

/** The last measured insets; re-measured on resize and orientation change. */
export function getInsets(): Insets {
  if (!started && typeof window !== 'undefined') {
    started = true;
    window.addEventListener('resize', measureInsets);
    window.addEventListener('orientationchange', measureInsets);
    measureInsets();
  }
  return current;
}
