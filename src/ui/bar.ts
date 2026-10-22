import type { StoryMissionDef } from '../data/schemas';
import { formatDate } from '../sim/calendar';
import { berthsFree, cargoFree } from '../sim/cargo';
import { rumor, SURVEY_RUMOUR } from '../sim/economy';
import { worldStats } from '../sim/shipStats';
import type { StoryAccept } from '../sim/storyMissions';
import type { UiContext } from './context';
import { button, dialogOpen, el, hotkeyFor } from './dom';
import { mapCornerButton, mapCornerKey } from './mapButton';

/** Why Accept is disabled, in the words shown to the pilot. */
export const STORY_BLOCK_REASON = {
  cargo: 'Not enough free hold',
  berths: 'No free passenger berths',
  active: 'You have already taken this on',
  unknown: 'No longer available',
} as const satisfies Record<Extract<StoryAccept, { ok: false }>['reason'], string>;

/**
 * The spaceport bar: contacts with story and side offers (left) and the selected offer's words
 * (right), then gossip and the next lead. Up/Down or a click selects, Enter or Accept takes the
 * mission (its acceptText replaces the offer), Decline puts it off until tomorrow, Esc or Done closes.
 */
export function showBar(ctx: UiContext, portId: string, onClose: () => void): void {
  const { controller } = ctx;
  const { data } = controller;
  const port = data.planets[portId];
  const bindings = controller.settings.bindings;
  let offers: StoryMissionDef[] = controller.storyOffers();
  let index = 0;
  /** The mission just taken, shown in place of an offer until another row is picked. */
  let taken: StoryMissionDef | null = null;

  const close = () => {
    ctx.unmount();
    onClose();
  };

  const stats = el('div', { class: 'sw-ex-stats', attrs: { 'data-testid': 'bar-stats' } });
  const list = el('div', { class: 'sw-mc-list', attrs: { role: 'listbox', 'aria-label': 'Contacts', 'data-testid': 'bar-list' } });
  const detail = el('div', { class: 'sw-mc-detail', attrs: { 'data-testid': 'bar-detail' } });
  const reason = el('p', { class: 'sw-ex-message sw-ex-bad', attrs: { 'data-testid': 'bar-reason', 'aria-live': 'polite' } });
  const message = el('p', { class: 'sw-ex-message', attrs: { 'data-testid': 'bar-message', 'aria-live': 'polite' } });
  const gossip = el('div', { class: 'sw-bar-gossip', attrs: { 'data-testid': 'bar-gossip' } });
  const lead = el('p', { class: 'sw-ex-news', attrs: { 'data-testid': 'bar-lead' } });

  const acceptBtn = button('Accept', () => accept(), { class: 'sw-btn-primary', hotkey: 'Enter' });
  const declineBtn = button('Decline', () => decline());
  const doneBtn = button('Done', close, { hotkey: hotkeyFor(bindings, 'back') });

  const reopen = () => showBar(ctx, portId, onClose);

  const select = (i: number) => {
    taken = null;
    message.textContent = '';
    index = i;
    render();
  };
  const move = (delta: number) => {
    if (offers.length > 0) select(Math.min(offers.length - 1, Math.max(0, index + delta)));
  };

  function accept(): void {
    const def = offers[index];
    if (!def || taken) return;
    const r = controller.acceptStory(def.id);
    if (r.ok) {
      taken = def;
      message.textContent = `Accepted: ${def.title}`;
    } else {
      message.textContent = '';
    }
    render();
  }

  function decline(): void {
    const def = offers[index];
    if (!def || taken) return;
    controller.declineStory(def.id);
    message.textContent = `${def.giver.name} will keep the offer open for another day.`;
    render();
  }

  let heardSurvey = false;

  function render(): void {
    const w = controller.world;
    offers = controller.storyOffers();
    index = Math.min(index, Math.max(0, offers.length - 1));
    stats.replaceChildren(
      el('span', { text: formatDate(w.day, data.config) }),
      el('span', { text: `Cargo: ${cargoFree(w, data)}/${worldStats(w, data).cargo} t` }),
      el('span', { text: `Berths: ${berthsFree(w, data)}/${worldStats(w, data).passengers}` }),
    );

    list.replaceChildren(
      ...(offers.length === 0
        ? [el('p', { class: 'sw-empty', text: 'Nobody here is looking for a pilot today.' })]
        : offers.map((o, i) =>
            el(
              'div',
              {
                class: i === index && !taken ? 'sw-mc-row sw-mc-selected' : 'sw-mc-row',
                attrs: { role: 'option', 'aria-selected': String(i === index && !taken), 'data-story': o.id },
                onClick: () => select(i),
              },
              [
                el('span', { class: 'sw-mc-rowtitle', text: `${o.giver.name}, ${o.giver.title}` }),
                el('span', { class: 'sw-mc-rowpay', text: o.title }),
              ],
            ),
          )),
    );

    const o = offers[index];
    const check = o && !taken ? controller.storyAccept(o.id) : null;
    if (taken) {
      detail.replaceChildren(el('h2', { class: 'sw-mc-title', text: taken.title }), el('p', { class: 'sw-mc-desc', text: taken.acceptText }));
    } else if (!o) {
      detail.replaceChildren(el('p', { class: 'sw-empty', text: 'Nothing selected.' }));
    } else {
      detail.replaceChildren(
        el('h2', { class: 'sw-mc-title', text: o.title }),
        el('p', { class: 'sw-mc-desc', text: `${o.giver.name}, ${o.giver.title}` }),
        el('p', { class: 'sw-mc-desc', text: o.text }),
      );
    }
    acceptBtn.disabled = !o || !!taken || !check?.ok;
    declineBtn.disabled = !o || !!taken;
    reason.textContent = check && !check.ok ? STORY_BLOCK_REASON[check.reason] : '';

    const heard = rumor(w, data, portId);
    if (heard === SURVEY_RUMOUR) {
      controller.noteRumour(SURVEY_RUMOUR); // the flag stops it recurring; keep showing it on this visit
      heardSurvey = true;
    }
    const talk = heard ?? (heardSurvey ? SURVEY_RUMOUR : '');
    gossip.replaceChildren(
      el('h2', { class: 'sw-bar-head', text: 'Gossip' }),
      ...(talk ? [el('p', { class: 'sw-bar-line', text: talk })] : []),
      el('p', { class: 'sw-bar-line', text: port.description }),
    );
    const next = controller.storyLead();
    lead.textContent = next && next.portId !== portId ? next.text : '';
    list.querySelector('.sw-mc-selected')?.scrollIntoView?.({ block: 'nearest' });
  }

  const screen = el('div', { class: 'sw-screen sw-planet-screen sw-mc-screen sw-bar-screen', attrs: { 'data-testid': 'bar' } }, [
    el('div', { class: 'sw-panel sw-mc sw-bar' }, [
      mapCornerButton(ctx, reopen),
      el('h1', { class: 'sw-title', text: `${port.name} · Spaceport Bar` }),
      stats,
      el('div', { class: 'sw-mc-body' }, [list, el('div', { class: 'sw-mc-side' }, [detail, reason, message])]),
      gossip,
      lead,
      el('div', { class: 'sw-ex-actions' }, [acceptBtn, declineBtn, doneBtn]),
    ]),
  ]);

  // Arrows belong to the flight group, which the UI poll does not read: handle them here. Enter on
  // a focused button belongs to that button (it also fires a click).
  const onKey = (e: KeyboardEvent) => {
    if (dialogOpen()) return;
    if (e.code === 'ArrowUp' || e.code === 'ArrowDown') {
      e.preventDefault();
      move(e.code === 'ArrowUp' ? -1 : 1);
    } else if (e.code === 'Enter' && !(e.target instanceof HTMLButtonElement)) {
      e.preventDefault();
      accept();
    }
  };
  window.addEventListener('keydown', onKey);
  const offMapKey = mapCornerKey(ctx, reopen);

  ctx.mount(screen, {
    groups: ['menus'],
    onPress: (pressed) => {
      if (pressed.has('back')) close();
    },
    cleanup: () => {
      window.removeEventListener('keydown', onKey);
      offMapKey();
    },
  });
  render();
}
