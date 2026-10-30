import type { BoardingChoice, BoardingView } from '../app/controller';
import type { Controller } from '../app/controller';
import type { ActionId } from '../input/actions';
import type { UiContext } from './context';
import { button, el, hotkeyFor } from './dom';

const CHOICE_ACTIONS: readonly ActionId[] = ['encounterChoice1', 'encounterChoice2', 'encounterChoice3', 'encounterChoice4', 'encounterChoice5'];

interface Entry {
  choice: BoardingChoice;
  label: string;
  blocked: string | null;
  used: boolean;
}

/** The buttons for the current stage, in hotkey order: the loot rows then Leave, or Take command, Sell as prize, Leave. */
function entriesOf(v: BoardingView): Entry[] {
  const leave: Entry = { choice: 'leave', label: 'Leave', blocked: null, used: false };
  if (v.stage === 'captured') {
    return [
      { choice: 'command', label: 'Take command', blocked: v.commandBlocked, used: false },
      { choice: 'prize', label: `Sell as prize (${v.prize} cr)`, blocked: null, used: false },
      leave,
    ];
  }
  return [...v.rows.map((r): Entry => ({ choice: r.id, label: r.label, blocked: r.blocked, used: r.used })), leave];
}

/**
 * The card for boarding a disabled ship (hotkeys 1-5, Esc leaves). Each take is used once and stays
 * marked done; the card stays up until Leave or the capture is settled. A failed capture shows what
 * happened and leaves only Leave (closing then scuttles the ship). Flight is paused while it is open.
 */
export function showBoardingCard(ctx: UiContext, controller: Controller): void {
  const { bindings } = controller.settings;
  let ended = false;

  const close = () => {
    ctx.unmount();
    controller.startFlight();
  };
  const leave = () => {
    if (!ended) controller.leaveBoarding();
    close();
  };

  const title = el('h1', { class: 'sw-title', text: 'Boarding' });
  const text = el('p', { class: 'sw-enc-text' });
  const outcome = el('div', { class: 'sw-enc-outcome', attrs: { 'data-testid': 'boarding-outcome', 'aria-live': 'polite' } });
  const choices = el('div', { class: 'sw-enc-choices' });
  const actions = el('div', { class: 'sw-ex-actions' });

  function choose(i: number): void {
    const view = controller.boardingView();
    const e = view && entriesOf(view)[i];
    if (ended || !e || e.used || e.blocked !== null) return;
    if (e.choice === 'leave') return leave();
    const lines = controller.boardChoose(e.choice);
    if (!lines) return;
    outcome.append(...lines.map((t) => el('p', { text: t })));
    if (e.choice === 'command' || e.choice === 'prize') {
      ended = true;
      choices.remove();
      actions.replaceChildren(button('Done', close, { class: 'sw-btn-primary', hotkey: hotkeyFor(bindings, 'back') }));
      actions.querySelector('button')?.focus();
      return;
    }
    render();
  }

  function render(): void {
    const view = controller.boardingView();
    if (!view) return close();
    title.textContent = 'Boarding';
    text.textContent = view.shipLabel;
    choices.replaceChildren(
      ...entriesOf(view).map((e, i) => {
        const b = button(e.used ? `${e.label} — done` : e.label, () => choose(i), { hotkey: hotkeyFor(bindings, CHOICE_ACTIONS[i]), disabled: e.used || e.blocked !== null });
        b.dataset.testid = 'boarding-choice';
        return el('div', { class: 'sw-enc-choice' }, [
          b,
          e.blocked && !e.used ? el('span', { class: 'sw-enc-why sw-ex-bad', text: e.blocked, attrs: { 'data-testid': 'boarding-blocked' } }) : null,
        ]);
      }),
    );
  }

  render();
  const screen = el('div', { class: 'sw-screen sw-overlay', attrs: { 'data-testid': 'boarding-card' } }, [
    el('div', { class: 'sw-panel sw-enc' }, [title, el('div', { class: 'sw-enc-body' }, [text, outcome]), choices, actions]),
  ]);
  ctx.mount(screen, {
    groups: ['menus'],
    onPress: (pressed) => {
      if (pressed.has('back')) return ended ? close() : leave();
      if (ended) return;
      CHOICE_ACTIONS.forEach((a, i) => {
        if (pressed.has(a)) choose(i);
      });
    },
  });
}
