import { ACTION_GROUP, ACTION_IDS, type ActionGroup, type ActionId } from './actions';
import type { Bindings } from './bindings';

type TargetLike = { tagName?: string; type?: string; isContentEditable?: boolean };

/** Input types nobody types into: a focused slider or checkbox still lets the game's keys through (V after a volume drag). */
const NON_TEXT_INPUTS: ReadonlySet<string> = new Set(['range', 'checkbox', 'radio', 'button', 'submit', 'reset', 'color']);

/** Text-entry targets: keys typed there belong to the field, not the game. */
function isTextEntry(t: EventTarget | null): boolean {
  const el = t as TargetLike | null;
  if (!el || typeof el.tagName !== 'string') return false;
  if (el.tagName === 'INPUT') return !NON_TEXT_INPUTS.has(String(el.type ?? 'text').toLowerCase());
  return el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable === true;
}

/** Focused buttons keep their default key behaviour (Space/Enter activate them). */
const isButton = (t: EventTarget | null) => (t as TargetLike | null)?.tagName === 'BUTTON';

/** Controls with their own keyboard behaviour: buttons, form fields (sliders and checkboxes too) and links. */
function isInteractive(t: EventTarget | null): boolean {
  if (isTextEntry(t) || isButton(t)) return true;
  const el = t as (TargetLike & { hasAttribute?: (n: string) => boolean }) | null;
  if (el?.tagName === 'INPUT') return true; // sliders and checkboxes keep their own keys (arrows, Space)
  return el?.tagName === 'A' && typeof el.hasAttribute === 'function' && el.hasAttribute('href');
}

/** What the game is doing, which decides which keys the browser must not act on. */
export interface KeyContext {
  /** True while the ship is flying (no menu or planet screen open). */
  flying: boolean;
  /** Action groups the open screen listens to (ignored while flying). */
  groups: readonly ActionGroup[];
}

const FLYING: KeyContext = { flying: true, groups: ['flight'] };

export class KeyboardSource {
  private held = new Set<string>();
  private justPressed = new Set<string>();

  constructor(
    private target: EventTarget,
    private getBindings: () => Bindings,
    private getContext: () => KeyContext = () => FLYING,
  ) {
    target.addEventListener('keydown', this.onDown);
    target.addEventListener('keyup', this.onUp);
    if (typeof window !== 'undefined') window.addEventListener('blur', this.onBlur);
  }

  private boundIn(code: string, groups: readonly ActionGroup[]): boolean {
    const b = this.getBindings();
    return ACTION_IDS.some((id) => groups.includes(ACTION_GROUP[id]) && b[id].includes(code));
  }

  /**
   * Whether to stop the browser's default for this key. Flying: keys bound in the flight group
   * (Tab, Space, arrows...) so the page doesn't scroll or move focus. In menus and on the planet
   * screen: only the open screen's own keys, only when focus isn't on a control, and never Tab,
   * so keyboard navigation of buttons always works.
   */
  private shouldBlock(e: KeyboardEvent): boolean {
    if (isTextEntry(e.target)) return false;
    const ctx = this.getContext();
    if (ctx.flying) return !isButton(e.target) && this.boundIn(e.code, ['flight']);
    if (e.code === 'Tab' || isInteractive(e.target)) return false;
    return this.boundIn(e.code, ctx.groups);
  }

  private onDown = (ev: Event): void => {
    const e = ev as KeyboardEvent;
    if (isTextEntry(e.target)) return;
    if (this.shouldBlock(e)) e.preventDefault();
    if (e.repeat) return;
    if (!this.held.has(e.code)) this.justPressed.add(e.code);
    this.held.add(e.code);
  };

  private onUp = (ev: Event): void => {
    const e = ev as KeyboardEvent;
    // Always release, even from a text field, so a key can't stick down.
    if (this.shouldBlock(e)) e.preventDefault();
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
