import { formatDate } from '../sim/calendar';
import { cargoFree } from '../sim/cargo';
import { fuelText, jumpsOf } from '../sim/fuel';
import type { RefuelQuote } from '../sim/rules';
import type { UiContext } from './context';
import { alertDialog, button, el, formatCredits, hotkeyFor } from './dom';
import { showExchange } from './exchange';
import { showHowToPlay } from './howToPlay';
import { worldStats } from '../sim/shipStats';
import { guideCard } from './guideHint';
import { mapCornerButton } from './mapButton';
import { showBar } from './bar';
import { showMissionComputer } from './missionComputer';
import { showMissionLog } from './missionLog';
import { showOutfitter } from './outfitter';
import { showShipyard } from './shipyard';

/** How long the credits value takes to count up to a job's pay (seconds). */
export const COUNT_UP_SEC = 0.8;
const COUNT_TICK_MS = 40;

const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

const REFUEL_REASON: Record<NonNullable<RefuelQuote['reason']>, string> = {
  full: 'Fuel tank is full.',
  noCredits: 'Not enough credits to buy fuel.',
};

/**
 * EV-style planet screen: picture, name, kind and tech tier, description, then credits, fuel
 * and a column of buttons for the port's services (Commodity Exchange, Mission Computer, Refuel) then
 * Mission Log and Leave, with a Map button fixed in the corner. Hotkeys come from the `planet` binding group.
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
      planet.hub ? el('span', { class: 'sw-tier sw-hub', text: 'Tech hub' }) : null,
    ]),
    el('p', { class: 'sw-planet-desc', text: planet.description }),
  ]);

  const stats = el('div', { class: 'sw-stats' });
  const actions = el('div', { class: 'sw-actions' });
  const status = el('p', { class: 'sw-status', attrs: { 'aria-live': 'polite' } });
  // The guide's callout sits above the buttons, inline: dialogs (mission pay) still open on top of it.
  const hint = guideCard(controller, ctx.root);
  // Messages from a tow that brought us here (e.g. failed missions) join any caller's notice.
  const notices = [...(notice ? [notice] : []), ...controller.takeNotices()];
  if (notices.length > 0) status.textContent = notices.join(' ');

  const services = new Set(planet.services);
  const openExchange = () => showExchange(ctx, planetId, () => ctx.go.planet(planetId));
  const openMissions = () => showMissionComputer(ctx, planetId, () => ctx.go.planet(planetId));
  const openShipyard = () => showShipyard(ctx, planetId, () => ctx.go.planet(planetId));
  const openOutfitter = () => showOutfitter(ctx, planetId, () => ctx.go.planet(planetId));
  const openBar = () => showBar(ctx, planetId, () => ctx.go.planet(planetId));
  const openMissionLog = () => showMissionLog(ctx, () => ctx.go.planet(planetId));
  const openHowToPlay = () => showHowToPlay(ctx, { onClose: () => ctx.go.planet(planetId) });

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

  // Pay from a landing counts up on screen: while `countTimer` runs the credits stat shows the tick value.
  let creditsNode: HTMLElement | null = null;
  let countTimer: ReturnType<typeof setInterval> | undefined;
  const stopCount = () => {
    if (countTimer !== undefined) clearInterval(countTimer);
    countTimer = undefined;
  };
  const showCredits = (n: number) => {
    if (creditsNode) creditsNode.textContent = `Credits: ${formatCredits(n)}`;
  };
  const countUp = (from: number, to: number) => {
    if (reducedMotion() || from === to) return;
    const start = Date.now();
    showCredits(from);
    countTimer = setInterval(() => {
      const k = Math.min(1, (Date.now() - start) / (COUNT_UP_SEC * 1000));
      showCredits(k >= 1 ? controller.world.credits : Math.round(from + (to - from) * k));
      if (k >= 1) stopCount();
    }, COUNT_TICK_MS);
  };

  function render(): void {
    const w = controller.world;
    creditsNode = el('div', { class: 'sw-stat', text: `Credits: ${formatCredits(w.credits)}` });
    stats.replaceChildren(
      el('div', { class: 'sw-stat', text: formatDate(w.day, data.config) }),
      creditsNode,
      el('div', { class: 'sw-stat', text: fuelText(jumpsOf(w.ship.fuel, data.config.fuelPerJump)) }),
      el('div', { class: 'sw-stat', text: `Cargo: ${cargoFree(w, data)}/${worldStats(w, data).cargo} t` }),
    );
    const q = controller.refuelQuote();
    const canRefuel = !!q && q.units > 0;
    const exchangeBtn = services.has('exchange')
      ? button('Commodity Exchange', openExchange, { hotkey: hotkeyFor(bindings, 'openExchange') })
      : null;
    const missionsBtn = services.has('missions')
      ? button('Mission Computer', openMissions, { hotkey: hotkeyFor(bindings, 'openMissions') })
      : null;
    const shipyardBtn = services.has('shipyard')
      ? button('Shipyard', openShipyard, { hotkey: hotkeyFor(bindings, 'openShipyard') })
      : null;
    const outfitterBtn = services.has('outfitter')
      ? button('Outfitter', openOutfitter, { hotkey: hotkeyFor(bindings, 'openOutfitter') })
      : null;
    const barBtn = services.has('bar') ? button('Spaceport Bar', openBar, { hotkey: hotkeyFor(bindings, 'openBar') }) : null;
    const refuelBtn = button(canRefuel ? `Refuel — ${formatCredits(q.cost)}` : 'Refuel', refuel, {
      hotkey: hotkeyFor(bindings, 'refuel'),
      disabled: !canRefuel,
    });
    const reason = !canRefuel && q?.reason ? el('p', { class: 'sw-reason', text: REFUEL_REASON[q.reason] }) : null;
    const logBtn = button('Mission Log', openMissionLog, { hotkey: hotkeyFor(bindings, 'missionLog') });
    const helpBtn = button('How to Play', openHowToPlay, { hotkey: hotkeyFor(bindings, 'howToPlay') });
    const leaveBtn = button('Leave', leave, { class: 'sw-btn-primary', hotkey: hotkeyFor(bindings, 'leave') });
    actions.replaceChildren(
      ...[exchangeBtn, missionsBtn, shipyardBtn, outfitterBtn, barBtn, refuelBtn].filter((b) => b !== null),
      ...(reason ? [reason] : []),
      logBtn,
      helpBtn,
      leaveBtn,
    );
  }
  render();

  const screen = el('div', { class: 'sw-screen sw-planet-screen', attrs: { 'data-testid': 'planet-screen' } }, [
    el('div', { class: 'sw-panel sw-planet-frame' }, [
      mapCornerButton(ctx, () => ctx.go.planet(planetId)),
      picture,
      info,
      el('div', { class: 'sw-planet-side' }, [stats, hint.node, actions, status]),
    ]),
  ]);

  const offSaved = controller.on('saved', (e) => {
    if (!e.ok) status.textContent = `Autosave failed: ${e.error ?? 'unknown error'}. Use Export from the pause menu to keep a copy.`;
  });

  // Messages raised while landed (the sound key says "Sound off") go where the screen keeps its notes.
  const offMessage = controller.on('message', (e) => (status.textContent = e.text));

  ctx.mount(screen, {
    groups: ['planet'],
    onPress: (pressed) => {
      if (pressed.has('leave')) leave();
      else if (pressed.has('openExchange') && services.has('exchange')) openExchange();
      else if (pressed.has('openMissions') && services.has('missions')) openMissions();
      else if (pressed.has('openShipyard') && services.has('shipyard')) openShipyard();
      else if (pressed.has('openOutfitter') && services.has('outfitter')) openOutfitter();
      else if (pressed.has('openBar') && services.has('bar')) openBar();
      else if (pressed.has('missionLog')) openMissionLog();
      else if (pressed.has('openMap')) openMap();
      else if (pressed.has('howToPlay')) openHowToPlay();
      else if (pressed.has('refuel') && (controller.refuelQuote()?.units ?? 0) > 0) refuel();
    },
    cleanup: () => {
      stopCount();
      offSaved();
      offMessage();
      hint.dispose();
    },
    guide: 'planet',
  });

  // Jobs finished by the landing that brought us here (the event fired before this screen existed). Opened after
  // mounting so the dialog sits above the screen.
  const done = controller.takeCompletion();
  if (done) {
    countUp(controller.world.credits - done.pay, controller.world.credits);
    const lines = done.missions.map((m) => `Mission complete: ${m.title}`);
    if (done.pay > 0) lines.push(`Paid ${Math.round(done.pay).toLocaleString('en-US')} cr.`);
    void alertDialog(ctx.root, { title: done.missions.length === 1 ? 'Mission complete' : 'Missions complete', message: lines.join('\n') });
  }
}
