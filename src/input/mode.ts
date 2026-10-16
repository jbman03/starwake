import { ACTION_IDS } from './actions';
import type { Bindings } from './bindings';

export type InputModeName = 'keyboard' | 'touch';

const CAPTURE = { capture: true } as const;

/** Best first guess before any input: touch on phones and tablets (coarse pointer, no mouse). */
export function initialInputMode(): InputModeName {
  if (typeof matchMedia !== 'function') return 'keyboard';
  return matchMedia('(pointer: coarse)').matches && !matchMedia('(any-pointer: fine)').matches ? 'touch' : 'keyboard';
}

/**
 * Which controls the player is using: 'touch' after a touch pointerdown, 'keyboard' after any
 * bound keydown. Touch rails are shown only in touch mode.
 */
export class InputMode {
  private current: InputModeName;
  private listeners = new Set<(mode: InputModeName) => void>();

  constructor(
    private target: EventTarget,
    private getBindings: () => Bindings,
    initial: InputModeName = initialInputMode(),
  ) {
    this.current = initial;
    // Capture phase so nothing (Phaser, a button handler) can hide the event from us.
    target.addEventListener('pointerdown', this.onPointer, CAPTURE);
    target.addEventListener('keydown', this.onKey, CAPTURE);
  }

  get mode(): InputModeName {
    return this.current;
  }

  set(mode: InputModeName): void {
    if (mode === this.current) return;
    this.current = mode;
    this.listeners.forEach((fn) => fn(mode));
  }

  onChange(fn: (mode: InputModeName) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private onPointer = (ev: Event): void => {
    if ((ev as PointerEvent).pointerType === 'touch') this.set('touch');
  };

  private onKey = (ev: Event): void => {
    const code = (ev as KeyboardEvent).code;
    // Typing a pilot name on a phone's soft keyboard is not switching to keyboard play.
    const tag = (ev.target as { tagName?: string } | null)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    const b = this.getBindings();
    if (ACTION_IDS.some((id) => b[id].includes(code))) this.set('keyboard');
  };

  dispose(): void {
    this.target.removeEventListener('pointerdown', this.onPointer, CAPTURE);
    this.target.removeEventListener('keydown', this.onKey, CAPTURE);
    this.listeners.clear();
  }
}
