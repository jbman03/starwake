import { formatDate } from '../sim/calendar';
import { MAX_MISSIONS } from '../sim/missions';
import type { UiContext } from './context';
import { button, confirmDialog, dialogOpen, el, formatCredits, hotkeyFor } from './dom';
import { mapCornerButton, mapCornerKey } from './mapButton';
import { deadlineText, destinationText, loadText, payText } from './missionText';

/**
 * The pilot's active jobs: a list (left) and the selected one's destination, deadline with days
 * left, load and pay (right). "Show on map" opens the star map on the destination's system;
 * "Abandon" asks first (cargo and berths are freed, no pay; an up-front advance is handed back, so
 * Abandon is disabled with the reason when the pilot can't refund it). Opened from the planet screen, the
 * pause menu or in flight; Esc, the log key or Done runs `onClose`.
 */
export function showMissionLog(ctx: UiContext, onClose: () => void, opts: { selectId?: string } = {}): void {
  const { controller } = ctx;
  const { data } = controller;
  const landed = controller.landedPlanetId !== null;
  const closeAction = landed ? 'missionLog' : 'flightMissionLog';
  let index = Math.max(0, controller.world.missions.findIndex((m) => m.id === opts.selectId));

  const close = () => {
    ctx.unmount();
    onClose();
  };

  const stats = el('div', { class: 'sw-ex-stats', attrs: { 'data-testid': 'log-stats' } });
  const list = el('div', { class: 'sw-mc-list', attrs: { role: 'listbox', 'aria-label': 'Active missions', 'data-testid': 'log-list' } });
  const detail = el('div', { class: 'sw-mc-detail', attrs: { 'data-testid': 'log-detail' } });
  const notes = el('section', { class: 'sw-notes', attrs: { 'data-testid': 'log-notes' } });
  const reason = el('p', { class: 'sw-ex-message sw-ex-bad', attrs: { 'data-testid': 'log-reason', 'aria-live': 'polite' } });

  const mapHotkey = hotkeyFor(controller.settings.bindings, closeAction === 'missionLog' ? 'openMap' : 'map');
  const mapBtn = button('Show on map', () => showOnMap(), { hotkey: mapHotkey });
  const abandonBtn = button('Abandon', () => void abandon(), { class: 'sw-btn-danger' });
  const doneBtn = button('Done', close, { class: 'sw-btn-primary', hotkey: hotkeyFor(controller.settings.bindings, closeAction) });

  const select = (i: number) => {
    index = i;
    render();
  };
  const move = (delta: number) => {
    const n = controller.world.missions.length;
    if (n > 0) select(Math.min(n - 1, Math.max(0, index + delta)));
  };

  function showOnMap(): void {
    const m = controller.world.missions[index];
    const systemId = m ? data.planets[m.destId]?.systemId : undefined;
    if (!m || !systemId) return;
    // The map replaces this screen; closing it brings the log back with the same mission selected.
    ctx.go.map({ preview: { systemId, label: `Mission: ${m.title}` }, onClose: () => showMissionLog(ctx, onClose, { selectId: m.id }) });
  }

  /** The current selection survives a trip to the map. */
  const reopen = () => showMissionLog(ctx, onClose, { selectId: controller.world.missions[index]?.id });

  async function abandon(): Promise<void> {
    const m = controller.world.missions[index];
    if (!m || !controller.canAbandonMission(m.id).ok) return;
    const money = m.paidUpfront ? `The advance of ${formatCredits(m.pay)} will be returned.` : 'You will not be paid.';
    const ok = await confirmDialog(ctx.root, {
      title: 'Abandon this mission?',
      message: `${m.title} — its cargo and berths are freed. ${money}`,
      confirm: 'Abandon',
      danger: true,
    });
    if (!ok) return;
    controller.abandonMission(m.id);
    render();
  }

  function render(): void {
    const w = controller.world;
    const missions = w.missions;
    index = Math.min(index, Math.max(0, missions.length - 1));
    stats.replaceChildren(
      el('span', { text: formatDate(w.day, data.config) }),
      el('span', { text: `Missions: ${missions.length}/${MAX_MISSIONS}` }),
    );
    list.replaceChildren(
      ...(missions.length === 0
        ? [el('p', { class: 'sw-empty', text: 'No active missions.' })]
        : missions.map((m, i) =>
            el(
              'div',
              {
                class: i === index ? 'sw-mc-row sw-mc-selected' : 'sw-mc-row',
                attrs: { role: 'option', 'aria-selected': String(i === index), 'data-mission': m.id },
                onClick: () => select(i),
              },
              [el('span', { class: 'sw-mc-rowtitle', text: m.title }), el('span', { class: 'sw-mc-rowpay', text: data.planets[m.destId]?.name ?? m.destId })],
            ),
          )),
    );
    const m = missions[index];
    if (!m) {
      detail.replaceChildren(el('p', { class: 'sw-empty', text: 'Take jobs from a Mission Computer.' }));
    } else {
      detail.replaceChildren(
        el('h2', { class: 'sw-mc-title', text: m.title }),
        el('p', { class: 'sw-mc-desc', text: m.description }),
        el('dl', { class: 'sw-map-rows sw-mc-rows' }, [
          el('dt', { text: 'Destination' }),
          el('dd', { text: destinationText(m, data) }),
          el('dt', { text: 'Deadline' }),
          el('dd', { text: deadlineText(m, w.day, data) }),
          el('dt', { text: 'Carries' }),
          el('dd', { text: loadText(m) }),
          el('dt', { text: 'Pay' }),
          el('dd', { text: payText(m) }),
        ]),
      );
    }
    mapBtn.disabled = !m;
    const refundable = !m || controller.canAbandonMission(m.id).ok;
    abandonBtn.disabled = !m || !refundable;
    reason.textContent = m && !refundable ? `Can't refund the advance (${formatCredits(m.pay)})` : '';
    notes.replaceChildren(
      ...(w.notes.length === 0
        ? []
        : [
            el('h2', { text: 'Notes' }),
            el('ul', {}, w.notes.map((n) => el('li', { text: `${formatDate(n.day, data.config)}: ${n.text}` }))),
          ]),
    );
    list.querySelector('.sw-mc-selected')?.scrollIntoView?.({ block: 'nearest' });
  }

  const screen = el('div', { class: 'sw-screen sw-planet-screen sw-mc-screen', attrs: { 'data-testid': 'mission-log' } }, [
    el('div', { class: 'sw-panel sw-mc' }, [
      mapCornerButton(ctx, () => reopen()),
      el('h1', { class: 'sw-title', text: 'Mission Log' }),
      stats,
      el('div', { class: 'sw-mc-body' }, [list, el('div', { class: 'sw-mc-side' }, [detail, reason, notes])]),
      el('div', { class: 'sw-ex-actions' }, [mapBtn, abandonBtn, doneBtn]),
    ]),
  ]);

  const onKey = (e: KeyboardEvent) => {
    if (dialogOpen()) return; // keys belong to the dialog
    if (e.code !== 'ArrowUp' && e.code !== 'ArrowDown') return;
    e.preventDefault();
    move(e.code === 'ArrowUp' ? -1 : 1);
  };
  window.addEventListener('keydown', onKey);
  const offMapKey = mapCornerKey(
    ctx,
    () => reopen(),
    () => {
      if (controller.world.missions[index]) showOnMap();
      else ctx.go.map({ onClose: () => reopen() });
    },
  );

  ctx.mount(screen, {
    groups: landed ? ['planet', 'menus'] : ['flight', 'menus'],
    onPress: (pressed) => {
      if (pressed.has('back') || pressed.has(closeAction)) close();
    },
    cleanup: () => {
      window.removeEventListener('keydown', onKey);
      offMapKey();
    },
  });
  render();
}
