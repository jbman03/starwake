import type { ActionId } from '../input/actions';
import type { Bindings } from '../input/bindings';

export type Child = Node | string | null | undefined | false;

export interface ElOpts {
  class?: string;
  text?: string;
  attrs?: Record<string, string>;
  onClick?: (e: MouseEvent) => void;
}

/** Create an element with optional class, text, attributes, click handler and children. */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  opts: ElOpts = {},
  children: Child[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (opts.class) node.className = opts.class;
  if (opts.text !== undefined) node.textContent = opts.text;
  for (const [k, v] of Object.entries(opts.attrs ?? {})) node.setAttribute(k, v);
  if (opts.onClick) node.addEventListener('click', opts.onClick as EventListener);
  for (const c of children) if (c !== null && c !== undefined && c !== false) node.append(c);
  return node;
}

/** A menu button (≥44px tall via CSS). `hotkey` shows a key chip after the label. */
export function button(
  label: string,
  onClick: () => void,
  opts: { class?: string; hotkey?: string; disabled?: boolean } = {},
): HTMLButtonElement {
  const b = el('button', { class: `sw-btn ${opts.class ?? ''}`.trim(), attrs: { type: 'button' }, onClick }, [
    el('span', { class: 'sw-btn-label', text: label }),
    opts.hotkey ? el('span', { class: 'sw-key', text: opts.hotkey, attrs: { 'aria-hidden': 'true' } }) : null,
  ]);
  b.disabled = !!opts.disabled;
  return b;
}

const KEY_NAMES: Record<string, string> = {
  Escape: 'Esc',
  Space: 'Space',
  Enter: 'Enter',
  Tab: 'Tab',
  Backspace: 'Bksp',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  ShiftLeft: 'Shift',
  ShiftRight: 'R-Shift',
  ControlLeft: 'Ctrl',
  ControlRight: 'R-Ctrl',
  AltLeft: 'Alt',
  AltRight: 'R-Alt',
};

/** Short human label for a KeyboardEvent.code ('KeyL' → 'L', 'Escape' → 'Esc'). */
export function keyLabel(code: string): string {
  if (KEY_NAMES[code]) return KEY_NAMES[code];
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit\d$/.test(code)) return code.slice(5);
  if (/^Numpad\d$/.test(code)) return `Num ${code.slice(6)}`;
  return code;
}

/** Label of the first key bound to `action`, or undefined if unbound. */
export function hotkeyFor(bindings: Bindings, action: ActionId): string | undefined {
  const code = bindings[action].find((c) => c !== null);
  return code ? keyLabel(code) : undefined;
}

export function formatCredits(n: number): string {
  return `${Math.round(n).toLocaleString('en-US')} cr`;
}

// ---- in-page dialogs (never window.confirm/prompt/alert) -------------------------------------

let openDialogs = 0;

/** True while an in-page dialog is open; screens ignore their hotkeys meanwhile. */
export const dialogOpen = (): boolean => openDialogs > 0;

let dialogSeq = 0;

function openDialog(
  parent: HTMLElement,
  title: string,
  body: Child[],
  actions: HTMLButtonElement[],
  onCancel: () => void,
): { close: () => void; panel: HTMLElement } {
  const titleId = `sw-dialog-title-${++dialogSeq}`;
  const panel = el('div', { class: 'sw-panel sw-dialog', attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId } }, [
    el('h2', { class: 'sw-dialog-title', text: title, attrs: { id: titleId } }),
    ...body,
    el('div', { class: 'sw-dialog-actions' }, actions),
  ]);
  const backdrop = el('div', { class: 'sw-dialog-backdrop' }, [panel]);
  // Capture phase on window: Escape cancels the dialog and never reaches the game's key handler.
  const onKey = (e: KeyboardEvent) => {
    if (e.code !== 'Escape') return;
    e.preventDefault();
    e.stopImmediatePropagation();
    onCancel();
  };
  window.addEventListener('keydown', onKey, true);
  openDialogs++;
  parent.append(backdrop);
  let closed = false;
  return {
    panel,
    close: () => {
      if (closed) return;
      closed = true;
      openDialogs--;
      window.removeEventListener('keydown', onKey, true);
      backdrop.remove();
    },
  };
}

export function confirmDialog(
  parent: HTMLElement,
  opts: { title: string; message?: string; confirm: string; cancel?: string; danger?: boolean },
): Promise<boolean> {
  return new Promise((resolve) => {
    const finish = (v: boolean) => {
      d.close();
      resolve(v);
    };
    const ok = button(opts.confirm, () => finish(true), { class: opts.danger ? 'sw-btn-danger' : 'sw-btn-primary' });
    const cancel = button(opts.cancel ?? 'Cancel', () => finish(false));
    const d = openDialog(parent, opts.title, [opts.message ? el('p', { text: opts.message }) : null], [cancel, ok], () =>
      finish(false),
    );
    cancel.focus();
  });
}

export function alertDialog(parent: HTMLElement, opts: { title: string; message: string }): Promise<void> {
  return new Promise((resolve) => {
    const finish = () => {
      d.close();
      resolve();
    };
    const ok = button('OK', finish, { class: 'sw-btn-primary' });
    const d = openDialog(parent, opts.title, [el('p', { text: opts.message })], [ok], finish);
    ok.focus();
  });
}

/** Text prompt. Resolves with the trimmed text (≥1 char, ≤maxLength), or null if cancelled. */
export function promptDialog(
  parent: HTMLElement,
  opts: { title: string; label: string; value?: string; maxLength: number; confirm: string },
): Promise<string | null> {
  return new Promise((resolve) => {
    const inputId = `sw-prompt-${dialogSeq + 1}`;
    const input = el('input', {
      class: 'sw-input',
      attrs: { id: inputId, type: 'text', maxlength: String(opts.maxLength), autocomplete: 'off', spellcheck: 'false' },
    });
    input.value = opts.value ?? '';
    const error = el('p', { class: 'sw-error', attrs: { 'aria-live': 'polite' } });
    const finish = (v: string | null) => {
      d.close();
      resolve(v);
    };
    const submit = () => {
      const v = input.value.trim().slice(0, opts.maxLength);
      if (!v) {
        error.textContent = 'Please enter a name.';
        input.focus();
        return;
      }
      finish(v);
    };
    const ok = button(opts.confirm, submit, { class: 'sw-btn-primary' });
    const cancel = button('Cancel', () => finish(null));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        submit();
      }
    });
    const d = openDialog(
      parent,
      opts.title,
      [el('label', { class: 'sw-label', text: opts.label, attrs: { for: inputId } }), input, error],
      [cancel, ok],
      () => finish(null),
    );
    input.focus();
    input.select();
  });
}
