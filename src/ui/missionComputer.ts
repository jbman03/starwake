import { formatDate } from '../sim/calendar';
import { berthsFree, cargoFree } from '../sim/cargo';
import { rumor, SURVEY_RUMOUR } from '../sim/economy';
import { canAccept, jobMissions, MAX_MISSIONS, type MissionOffer } from '../sim/missions';
import type { UiContext } from './context';
import { worldStats } from '../sim/shipStats';
import { button, dialogOpen, el, formatCredits, hotkeyFor } from './dom';
import { mapCornerButton, mapCornerKey } from './mapButton';
import { guideCard } from './guideHint';
import { ACCEPT_REASON, deadlineText, destinationText, loadText, payText } from './missionText';

/**
 * EV-style mission computer: today's jobs at this port as a list (left) and the selected job's
 * text, pay, deadline and load (right). Up/Down or a click selects, Enter or Accept takes the
 * job (it leaves the list; the selection stays on the next one), Esc or Done closes. A job you
 * can't take yet stays listed with the reason shown and Accept disabled.
 */
export function showMissionComputer(ctx: UiContext, portId: string, onClose: () => void, opts: { selectId?: string } = {}): void {
  const { controller } = ctx;
  const { data } = controller;
  const port = data.planets[portId];
  let offers: MissionOffer[] = controller.offers();
  let index = Math.max(0, offers.findIndex((o) => o.offerId === opts.selectId));

  const close = () => {
    ctx.unmount();
    onClose();
  };

  const stats = el('div', { class: 'sw-ex-stats', attrs: { 'data-testid': 'mc-stats' } });
  const rumorLine = el('p', { class: 'sw-ex-news', attrs: { 'data-testid': 'mc-rumor' } });
  const list = el('div', { class: 'sw-mc-list', attrs: { role: 'listbox', 'aria-label': 'Available jobs', 'data-testid': 'mc-list' } });
  const detail = el('div', { class: 'sw-mc-detail', attrs: { 'data-testid': 'mc-detail' } });
  const reason = el('p', { class: 'sw-ex-message sw-ex-bad', attrs: { 'data-testid': 'mc-reason', 'aria-live': 'polite' } });
  const message = el('p', { class: 'sw-ex-message', attrs: { 'data-testid': 'mc-message', 'aria-live': 'polite' } });
  const say = (text: string, bad = false) => {
    message.textContent = text;
    message.classList.toggle('sw-ex-bad', bad);
  };

  const acceptBtn = button('Accept Mission', () => accept(), { class: 'sw-btn-primary', hotkey: 'Enter' });
  const mapBtn = button('Show on map', () => showOnMap(), { hotkey: hotkeyFor(controller.settings.bindings, 'openMap') });
  const doneBtn = button('Done', close, { hotkey: hotkeyFor(controller.settings.bindings, 'back') });

  const select = (i: number) => {
    if (i !== index) say('');
    index = i;
    render();
  };
  const move = (delta: number) => {
    if (offers.length > 0) select(Math.min(offers.length - 1, Math.max(0, index + delta)));
  };

  /** Preview the selected job's destination on the map; closing it returns here with the job still selected. */
  function showOnMap(): void {
    const o = offers[index];
    const systemId = o ? data.planets[o.destId]?.systemId : undefined;
    if (!o || !systemId) return;
    ctx.go.map({ preview: { systemId, label: `Mission: ${o.title}` }, onClose: () => reopen(o.offerId) });
  }
  const reopen = (selectId = offers[index]?.offerId) => showMissionComputer(ctx, portId, onClose, { selectId });

  function accept(): void {
    const offer = offers[index];
    if (!offer) return;
    const r = controller.acceptMission(offer.offerId);
    if (r.ok) say(`Accepted: ${offer.title}`);
    else say(ACCEPT_REASON[r.reason], true);
    render(); // the taken job drops out; the same index is now the next job
  }

  let heardSurvey = false;

  function render(): void {
    const w = controller.world;
    offers = controller.offers();
    index = Math.min(index, Math.max(0, offers.length - 1));
    stats.replaceChildren(
      el('span', { text: formatDate(w.day, data.config) }),
      el('span', { text: `Credits: ${formatCredits(w.credits)}` }),
      el('span', { text: `Cargo: ${cargoFree(w, data)}/${worldStats(w, data).cargo} t` }),
      el('span', { text: `Berths: ${berthsFree(w, data)}/${worldStats(w, data).passengers}` }),
      el('span', { text: `Missions: ${jobMissions(w).length}/${MAX_MISSIONS}` }),
    );
    const heard = rumor(w, data, portId);
    if (heard === SURVEY_RUMOUR) {
      controller.noteRumour(SURVEY_RUMOUR); // the flag stops it recurring; keep showing it on this visit
      heardSurvey = true;
    }
    rumorLine.textContent = heard ?? (heardSurvey ? SURVEY_RUMOUR : '');

    list.replaceChildren(
      ...(offers.length === 0
        ? [el('p', { class: 'sw-empty', text: 'No jobs are posted right now.' })]
        : offers.map((o, i) =>
            el(
              'div',
              {
                class: i === index ? 'sw-mc-row sw-mc-selected' : 'sw-mc-row',
                attrs: { role: 'option', 'aria-selected': String(i === index), 'data-offer': o.offerId },
                onClick: () => select(i),
              },
              [el('span', { class: 'sw-mc-rowtitle', text: o.title }), el('span', { class: 'sw-mc-rowpay', text: formatCredits(o.pay) })],
            ),
          )),
    );

    const o = offers[index];
    const check = o ? canAccept(w, data, o) : null;
    if (!o) {
      detail.replaceChildren(el('p', { class: 'sw-empty', text: 'Nothing selected.' }));
    } else {
      const pays = o.deadlineDay === null ? payText(o) : `${payText(o)} · Deadline ${deadlineText(o, w.day, data)}`;
      detail.replaceChildren(
        el('h2', { class: 'sw-mc-title', text: o.title }),
        el('p', { class: 'sw-mc-desc', text: o.description }),
        el('dl', { class: 'sw-map-rows sw-mc-rows' }, [
          el('dt', { text: 'Destination' }),
          el('dd', { text: destinationText(o, data) }),
          el('dt', { text: 'Pays' }),
          el('dd', { text: o.deadlineDay === null ? `${pays} · No deadline` : pays }),
          el('dt', { text: 'Carries' }),
          el('dd', { text: loadText(o) }),
        ]),
      );
    }
    acceptBtn.disabled = !o || !check?.ok;
    mapBtn.disabled = !o;
    reason.textContent = check && !check.ok ? ACCEPT_REASON[check.reason] : '';
    list.querySelector('.sw-mc-selected')?.scrollIntoView?.({ block: 'nearest' });
  }

  const hint = guideCard(controller, ctx.root);
  const screen = el('div', { class: 'sw-screen sw-planet-screen sw-mc-screen', attrs: { 'data-testid': 'mission-computer' } }, [
    el('div', { class: 'sw-panel sw-mc' }, [
      mapCornerButton(ctx, () => reopen()),
      el('h1', { class: 'sw-title', text: `${port.name} · Mission Computer` }),
      stats,
      rumorLine,
      el('div', { class: 'sw-mc-body' }, [list, el('div', { class: 'sw-mc-side' }, [detail, reason, message])]),
      hint.node,
      el('div', { class: 'sw-ex-actions' }, [acceptBtn, mapBtn, doneBtn]),
    ]),
  ]);

  // Arrows belong to the flight group, which the UI poll doesn't read: handle them here. Enter on
  // a focused button belongs to that button (it also fires a click).
  const onKey = (e: KeyboardEvent) => {
    if (dialogOpen()) return; // keys belong to the dialog
    if (e.code === 'ArrowUp' || e.code === 'ArrowDown') {
      e.preventDefault();
      move(e.code === 'ArrowUp' ? -1 : 1);
    } else if (e.code === 'Enter' && !(e.target instanceof HTMLButtonElement)) {
      e.preventDefault();
      accept();
    }
  };
  window.addEventListener('keydown', onKey);
  const offMapKey = mapCornerKey(
    ctx,
    () => reopen(),
    () => {
      if (offers[index]) showOnMap();
      else ctx.go.map({ onClose: () => reopen() });
    },
  );

  ctx.mount(screen, {
    groups: ['menus'],
    onPress: (pressed) => {
      if (pressed.has('back')) close();
    },
    cleanup: () => {
      window.removeEventListener('keydown', onKey);
      offMapKey();
      hint.dispose();
    },
    guide: 'missions',
  });
  render();
}
