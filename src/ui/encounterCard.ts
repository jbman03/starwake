import type { EncounterView } from '../app/controller';
import type { ActionId } from '../input/actions';
import type { UiContext } from './context';
import { button, el, hotkeyFor } from './dom';

const CHOICE_ACTIONS: readonly ActionId[] = ['encounterChoice1', 'encounterChoice2', 'encounterChoice3'];

/**
 * The card for a hail or a site: the situation, then one button per choice (hotkeys 1-3). A blocked
 * choice is disabled and says why. `onChoose` takes the choice and returns the outcome lines, or
 * null if it was refused. Afterwards the outcome shows with a Done button. "Not now" (or Esc)
 * closes the card without using the encounter. A card with `noDecline` shows Done instead of "Not now";
 * one with `mustAnswer` shows nothing to close it, and Esc does nothing, until it is answered. Closing
 * resumes flight.
 */
export function showEncounterCard(ctx: UiContext, view: EncounterView, onChoose: (index: number) => string[] | null): void {
  const { controller } = ctx;
  const { bindings } = controller.settings;
  let done = false;

  const close = () => {
    ctx.unmount();
    controller.startFlight();
  };

  const choiceBtns = view.choices.map((c, i) => {
    const b = button(c.label, () => choose(i), { hotkey: hotkeyFor(bindings, CHOICE_ACTIONS[i]), disabled: c.blocked !== null });
    b.dataset.testid = 'encounter-choice';
    return el('div', { class: 'sw-enc-choice' }, [
      b,
      c.blocked ? el('span', { class: 'sw-enc-why sw-ex-bad', text: c.blocked, attrs: { 'data-testid': 'encounter-blocked' } }) : null,
    ]);
  });
  const choices = el('div', { class: 'sw-enc-choices' }, choiceBtns);
  const outcome = el('div', { class: 'sw-enc-outcome', attrs: { 'data-testid': 'encounter-outcome', 'aria-live': 'polite' } });
  const decline = () => {
    if (view.kind === 'hail') controller.declineEncounter();
    close();
  };
  const notNow = button('Not now', decline, { hotkey: hotkeyFor(bindings, 'back') });
  const doneBtn = button('Done', close, { class: 'sw-btn-primary', hotkey: hotkeyFor(bindings, 'back') });
  const actions = el('div', { class: 'sw-ex-actions' }, view.mustAnswer ? [] : view.noDecline ? [doneBtn] : [notNow]);

  function choose(i: number): void {
    const c = view.choices[i];
    if (done || !c || c.blocked !== null) return;
    const lines = onChoose(i);
    if (!lines) return;
    done = true;
    choices.remove();
    outcome.replaceChildren(...(lines.length > 0 ? lines : ['Done.']).map((t) => el('p', { text: t })));
    actions.replaceChildren(doneBtn);
    doneBtn.focus();
  }

  const screen = el('div', { class: 'sw-screen sw-overlay', attrs: { 'data-testid': 'encounter-card' } }, [
    el('div', { class: 'sw-panel sw-enc' }, [
      el('h1', { class: 'sw-title', text: view.title }),
      el('div', { class: 'sw-enc-body' }, [el('p', { class: 'sw-enc-text', text: view.text }), outcome]),
      choices,
      actions,
    ]),
  ]);

  ctx.mount(screen, {
    groups: ['menus'],
    onPress: (pressed) => {
      if (pressed.has('back')) return done ? close() : view.mustAnswer ? undefined : decline();
      CHOICE_ACTIONS.forEach((a, i) => {
        if (pressed.has(a)) choose(i);
      });
    },
  });
}
