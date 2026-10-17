import { ACTION_GROUP, ACTION_IDS, ACTION_LABEL, type ActionGroup, type ActionId } from '../input/actions';
import { resetBindings } from '../input/bindings';
import { applyCapture, applyClear, applySwap, type CaptureResult } from '../input/capture';
import { keyName } from '../input/keyNames';
import { saveSettings } from '../save/settings';
import type { UiContext } from './context';
import { button, confirmDialog, el } from './dom';

const GROUPS: { id: ActionGroup; title: string }[] = [
  { id: 'flight', title: 'Flight' },
  { id: 'planet', title: 'Planet screen' },
  { id: 'exchange', title: 'Exchange' },
  { id: 'menus', title: 'Menus' },
];

type State =
  | { kind: 'idle' }
  | { kind: 'capture'; action: ActionId; slot: 0 | 1 }
  | { kind: 'conflict'; action: ActionId; slot: 0 | 1; code: string; other: ActionId };

export interface HotkeyEditor {
  node: HTMLElement;
  dispose(): void;
}

/** Rebindable hotkey list. Changes are saved immediately and apply live (the keyboard reads settings.bindings). */
export function createHotkeyEditor(ctx: UiContext): HotkeyEditor {
  const { controller } = ctx;
  let state: State = { kind: 'idle' };
  let error = '';
  const message = el('p', { class: 'sw-error', attrs: { 'aria-live': 'polite' } });
  const list = el('div', { class: 'sw-hotkeys' });
  const node = el('div', { class: 'sw-hotkey-editor' }, [message, list]);

  const swallowKeyup = (code: string) => {
    const onUp = (e: KeyboardEvent) => {
      if (e.code !== code) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      window.removeEventListener('keyup', onUp, true);
    };
    window.addEventListener('keyup', onUp, true);
    setTimeout(() => window.removeEventListener('keyup', onUp, true), 1500);
  };

  /** Apply a result; returns the inline error text ('' on success or no-op). */
  const commit = (r: CaptureResult): string => {
    if (r.kind === 'ok') {
      controller.settings.bindings = r.bindings;
      saveSettings(controller.settings);
      return '';
    }
    return r.kind === 'error' ? r.message : '';
  };

  /** While capturing (or confirming a swap), Esc cancels and no key reaches the game or closes menus. */
  const onKey = (e: KeyboardEvent) => {
    if (state.kind === 'idle') return;
    if (state.kind === 'conflict') {
      if (e.code !== 'Escape') return;
      e.preventDefault();
      e.stopImmediatePropagation();
      setState({ kind: 'idle' });
      return;
    }
    e.preventDefault();
    e.stopImmediatePropagation();
    if (e.repeat) return;
    const { action, slot } = state;
    if (e.code === 'Escape') {
      setState({ kind: 'idle' });
      swallowKeyup(e.code);
      return;
    }
    swallowKeyup(e.code);
    const r = applyCapture(controller.settings.bindings, action, slot, e.code);
    if (r.kind === 'conflict') {
      setState({ kind: 'conflict', action, slot, code: e.code, other: r.other });
      return;
    }
    setState({ kind: 'idle' }, commit(r));
  };
  window.addEventListener('keydown', onKey, true);

  /** Move to `next`; `err` is the inline message to show after the transition (default none). */
  function setState(next: State, err = ''): void {
    error = err;
    state = next;
    render();
  }

  function slotCell(action: ActionId, slot: 0 | 1): HTMLElement {
    const code = controller.settings.bindings[action][slot];
    const capturing = state.kind === 'capture' && state.action === action && state.slot === slot;
    const name = ACTION_LABEL[action];
    const btn = el(
      'button',
      {
        class: `sw-btn sw-slot${capturing ? ' sw-slot-capturing' : ''}`,
        text: capturing ? 'Press a key… (Esc to cancel)' : code ? keyName(code) : '—',
        attrs: {
          type: 'button',
          'data-testid': `slot-${action}-${slot}`,
          'aria-label': `${name} key ${slot + 1}: ${code ? keyName(code) : 'empty'}. Click to change`,
        },
        onClick: () => setState({ kind: 'capture', action, slot }),
      },
    );
    const clear = el('button', {
      class: 'sw-btn sw-slot-clear',
      text: '×',
      attrs: { type: 'button', 'aria-label': `Clear ${name} key ${slot + 1}`, 'data-testid': `clear-${action}-${slot}` },
      onClick: () => {
        setState({ kind: 'idle' }, commit(applyClear(controller.settings.bindings, action, slot)));
      },
    });
    clear.disabled = code === null;
    return el('div', { class: 'sw-slot-cell' }, [btn, clear]);
  }

  function row(action: ActionId): HTMLElement {
    const conflict = state.kind === 'conflict' && state.action === action ? state : null;
    return el('div', { class: 'sw-hotkey-row' }, [
      el('div', { class: 'sw-hotkey-name', text: ACTION_LABEL[action] }),
      slotCell(action, 0),
      slotCell(action, 1),
      conflict
        ? el('div', { class: 'sw-conflict', attrs: { role: 'alert' } }, [
            el('span', { text: `${keyName(conflict.code)} is already used by ${ACTION_LABEL[conflict.other]}. Swap?` }),
            el('div', { class: 'sw-conflict-actions' }, [
              button('Swap', () => {
                setState({ kind: 'idle' }, commit(applySwap(controller.settings.bindings, conflict.action, conflict.slot, conflict.code)));
              }, { class: 'sw-btn-primary' }),
              button('Cancel', () => setState({ kind: 'idle' })),
            ]),
          ])
        : null,
    ]);
  }

  function render(): void {
    message.textContent = error;
    list.replaceChildren(
      ...GROUPS.map((g) =>
        el('section', { class: 'sw-hotkey-group', attrs: { 'aria-label': g.title } }, [
          el('h3', { class: 'sw-hotkey-group-title', text: g.title }),
          ...ACTION_IDS.filter((id) => ACTION_GROUP[id] === g.id).map(row),
        ]),
      ),
      button(
        'Reset to defaults',
        () =>
          void (async () => {
            const ok = await confirmDialog(ctx.root, {
              title: 'Reset all hotkeys?',
              message: 'Every key goes back to its default.',
              confirm: 'Reset',
              danger: true,
            });
            if (!ok) return;
            controller.settings.bindings = resetBindings();
            saveSettings(controller.settings);
            setState({ kind: 'idle' });
          })(),
        { class: 'sw-btn-danger sw-reset' },
      ),
    );
  }

  render();
  return {
    node,
    dispose: () => window.removeEventListener('keydown', onKey, true),
  };
}
