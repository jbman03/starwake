import { formatDate } from '../sim/calendar';
import { cargoFree } from '../sim/cargo';
import { fuelText, jumpsOf } from '../sim/fuel';
import type { RefuelQuote } from '../sim/rules';
import type { UiContext } from './context';
import { button, el, formatCredits, hotkeyFor } from './dom';
import { showExchange } from './exchange';

const REFUEL_REASON: Record<NonNullable<RefuelQuote['reason']>, string> = {
  full: 'Fuel tank is full.',
  noFuelSold: 'No fuel is sold here.',
  noCredits: 'Not enough credits to buy fuel.',
};

/**
 * EV-style planet screen: picture, name, kind and tech tier, description, then credits, fuel
 * and a column of buttons for the port's services (Commodity Exchange, Mission Computer, Refuel) then
 * Star Map, Mission Log and Leave. Hotkeys come from the `planet` binding group.
 */
export function showPlanetScreen(ctx: UiContext, planetId: string, notice?: string): void {
  const { controller } = ctx;
  const { data } = controller;
  const planet = data.planets[planetId];
  const bindings = controller.settings.bindings;

  const img = ctx.planetImage(planetId);
  const picture = el('div', { class: 'sw-planet-picture' }, [
    img
      ? el('img', { attrs: { src: img, alt: planet.name, draggable: 'false' } })
      : el('div', { class: 'sw-planet-placeholder', attrs: { role: 'img', 'aria-label': planet.name } }),
  ]);

  const kind = planet.kind === 'station' ? 'Station' : 'Planet';
  const system = data.systems[planet.systemId]?.name ?? planet.systemId;
  const info = el('div', { class: 'sw-planet-info' }, [
    el('h1', { class: 'sw-planet-name', text: planet.name }),
    el('div', { class: 'sw-planet-sub' }, [
      el('span', { text: `${kind} · ${system} system` }),
      el('span', { class: 'sw-tier', text: `Tech tier ${planet.techTier}` }),
    ]),
    el('p', { class: 'sw-planet-desc', text: planet.description }),
  ]);

  const stats = el('div', { class: 'sw-stats' });
  const actions = el('div', { class: 'sw-actions' });
  const status = el('p', { class: 'sw-status', attrs: { 'aria-live': 'polite' } });
  if (notice) status.textContent = notice;

  const services = new Set(planet.services);
  const comingSoon = () => {
    status.textContent = 'Coming in the next update';
  };
  const openExchange = () => showExchange(ctx, planetId, () => ctx.go.planet(planetId));
  // Placeholders until the mission computer and log exist; only these two handlers change then.
  const openMissions = comingSoon;
  const openMissionLog = comingSoon;

  const refuel = () => {
    const q = controller.refuel();
    if (q && q.units > 0) status.textContent = `Bought ${q.units} fuel for ${formatCredits(q.cost)}.`;
    render();
  };
  // The map returns here (a fresh planet screen) when it closes.
  const openMap = () => ctx.go.map({ onClose: () => ctx.go.planet(planetId) });
  const leave = () => {
    controller.leavePlanet();
    ctx.unmount();
  };

  function render(): void {
    const w = controller.world;
    stats.replaceChildren(
      el('div', { class: 'sw-stat', text: formatDate(w.day, data.config) }),
      el('div', { class: 'sw-stat', text: `Credits: ${formatCredits(w.credits)}` }),
      el('div', { class: 'sw-stat', text: fuelText(jumpsOf(w.ship.fuel, data.config.fuelPerJump)) }),
      el('div', { class: 'sw-stat', text: `Cargo: ${cargoFree(w, data)}/${data.ships[w.shipId].cargo} t` }),
    );
    const q = controller.refuelQuote();
    const canRefuel = !!q && q.units > 0;
    const exchangeBtn = services.has('exchange')
      ? button('Commodity Exchange', openExchange, { hotkey: hotkeyFor(bindings, 'openExchange') })
      : null;
    const missionsBtn = services.has('missions')
      ? button('Mission Computer', openMissions, { hotkey: hotkeyFor(bindings, 'openMissions') })
      : null;
    const refuelBtn = !services.has('refuel') ? null : button(canRefuel ? `Refuel — ${formatCredits(q.cost)}` : 'Refuel', refuel, {
      hotkey: hotkeyFor(bindings, 'refuel'),
      disabled: !canRefuel,
    });
    const reason = refuelBtn && !canRefuel && q?.reason ? el('p', { class: 'sw-reason', text: REFUEL_REASON[q.reason] }) : null;
    const mapBtn = button('Star Map', openMap, { hotkey: hotkeyFor(bindings, 'openMap') });
    const logBtn = button('Mission Log', openMissionLog, { hotkey: hotkeyFor(bindings, 'missionLog') });
    const leaveBtn = button('Leave', leave, { class: 'sw-btn-primary', hotkey: hotkeyFor(bindings, 'leave') });
    actions.replaceChildren(
      ...[exchangeBtn, missionsBtn, refuelBtn].filter((b) => b !== null),
      ...(reason ? [reason] : []),
      mapBtn,
      logBtn,
      leaveBtn,
    );
  }
  render();

  const screen = el('div', { class: 'sw-screen sw-planet-screen', attrs: { 'data-testid': 'planet-screen' } }, [
    el('div', { class: 'sw-panel sw-planet-frame' }, [
      picture,
      info,
      el('div', { class: 'sw-planet-side' }, [stats, actions, status]),
    ]),
  ]);

  const offSaved = controller.on('saved', (e) => {
    if (!e.ok) status.textContent = `Autosave failed: ${e.error ?? 'unknown error'}. Use Export from the pause menu to keep a copy.`;
  });

  ctx.mount(screen, {
    groups: ['planet'],
    onPress: (pressed) => {
      if (pressed.has('leave')) leave();
      else if (pressed.has('openExchange') && services.has('exchange')) openExchange();
      else if (pressed.has('openMissions') && services.has('missions')) openMissions();
      else if (pressed.has('missionLog')) openMissionLog();
      else if (pressed.has('openMap')) openMap();
      else if (pressed.has('refuel') && services.has('refuel') && (controller.refuelQuote()?.units ?? 0) > 0) refuel();
    },
    cleanup: offSaved,
  });
}
