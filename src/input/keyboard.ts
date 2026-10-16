import { ACTION_GROUP, ACTION_IDS, type ActionGroup, type ActionId } from './actions';
import type { Bindings } from './bindings';

type TargetLike = { tagName?: string; isContentEditable?: boolean };

/** Text-entry targets: keys typed there belong to the field, not the game. */
function isTextEntry(t: EventTarget | null): boolean {
  const el = t as TargetLike | null;
  if (!el || typeof el.tagName !== 'string') return false;
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable === true;
}

/** Focused buttons keep their default key behaviour (Space/Enter activate them). */
const isButton = (t: EventTarget | null) => (t as TargetLike | null)?.tagName === 'BUTTON';

export class KeyboardSource {
  private held = new Set<string>();
  private justPressed = new Set<string>();

  constructor(
    private target: EventTarget,
    private getBindings: () => Bindings,
  ) {
    target.addEventListener('keydown', this.onDown);
    target.addEventListener('keyup', this.onUp);
    if (typeof window !== 'undefined') window.addEventListener('blur', this.onBlur);
  }

  private isBound(code: string): boolean {
    const b = this.getBindings();
    return ACTION_IDS.some((id) => b[id].includes(code));
  }

  private onDown = (ev: Event): void => {
    const e = ev as KeyboardEvent;
    if (isTextEntry(e.target)) return;
    if (this.isBound(e.code) && !isButton(e.target)) e.preventDefault();
    if (e.repeat) return;
    if (!this.held.has(e.code)) this.justPressed.add(e.code);
    this.held.add(e.code);
  };

  private onUp = (ev: Event): void => {
    const e = ev as KeyboardEvent;
    // Always release, even from a text field, so a key can't stick down.
    if (this.isBound(e.code) && !isTextEntry(e.target) && !isButton(e.target)) e.preventDefault();
    this.held.delete(e.code);
  };

  private onBlur = (): void => {
    this.releaseAll();
  };

  /** Forget every held key and pending press (app backgrounded, window lost focus). */
  releaseAll(): void {
    this.held.clear();
    this.justPressed.clear();
  }

  /** Held and newly pressed actions in `groups`; drains every pending press (any group). */
  poll(groups: ActionGroup | readonly ActionGroup[]): { actions: Set<ActionId>; pressed: Set<ActionId> } {
    const wanted: readonly ActionGroup[] = typeof groups === 'string' ? [groups] : groups;
    const b = this.getBindings();
    const actions = new Set<ActionId>();
    const pressed = new Set<ActionId>();
    for (const id of ACTION_IDS) {
      if (!wanted.includes(ACTION_GROUP[id])) continue;
      for (const code of b[id]) {
        if (code === null) continue;
        if (this.held.has(code)) actions.add(id);
        if (this.justPressed.has(code)) pressed.add(id);
      }
    }
    // Presses are only meaningful for the context that was active when they happened.
    this.justPressed.clear();
    return { actions, pressed };
  }

  dispose(): void {
    this.target.removeEventListener('keydown', this.onDown);
    this.target.removeEventListener('keyup', this.onUp);
    if (typeof window !== 'undefined') window.removeEventListener('blur', this.onBlur);
    this.held.clear();
    this.justPressed.clear();
  }
}
