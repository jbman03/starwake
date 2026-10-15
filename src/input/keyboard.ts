import { ACTION_GROUP, ACTION_IDS, type ActionGroup, type ActionId } from './actions';
import type { Bindings } from './bindings';

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
    if (this.isBound(e.code)) e.preventDefault();
    if (e.repeat) return;
    if (!this.held.has(e.code)) this.justPressed.add(e.code);
    this.held.add(e.code);
  };

  private onUp = (ev: Event): void => {
    const e = ev as KeyboardEvent;
    if (this.isBound(e.code)) e.preventDefault();
    this.held.delete(e.code);
  };

  private onBlur = (): void => {
    this.held.clear();
  };

  poll(group: ActionGroup): { actions: Set<ActionId>; pressed: Set<ActionId> } {
    const b = this.getBindings();
    const actions = new Set<ActionId>();
    const pressed = new Set<ActionId>();
    for (const id of ACTION_IDS) {
      if (ACTION_GROUP[id] !== group) continue;
      for (const code of b[id]) {
        if (code === null) continue;
        if (this.held.has(code)) actions.add(id);
        if (this.justPressed.has(code)) pressed.add(id);
      }
    }
    // Only keys of this group's actions are consumed; others stay pending for their own poll.
    for (const id of ACTION_IDS) {
      if (ACTION_GROUP[id] !== group) continue;
      for (const code of b[id]) if (code !== null) this.justPressed.delete(code);
    }
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
