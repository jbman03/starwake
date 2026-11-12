import { PORT_KIND_LABEL } from '../data/schemas';
import type { ActionId } from '../input/actions';
import { formatDate } from '../sim/calendar';
import { cargoFree, cargoLabel } from '../sim/cargo';
import { fineFor, legalStatus } from '../sim/law';
import { escortMaxArmor, hireRefusal, prizeValueOf } from '../sim/escorts';
import { crewCap } from '../sim/crew';
import { wingmanDef, wingmanRank } from '../sim/wingmen';
import { governmentShortName } from '../sim/standing';
import { fuelText, jumpsOf } from '../sim/fuel';
import type { RefuelQuote } from '../sim/rules';
import type { Escort } from '../sim/types';
import type { UiContext } from './context';
import { alertDialog, button, confirmDialog, el, formatCredits, hotkeyFor } from './dom';
import { showExchange } from './exchange';
import { showHowToPlay } from './howToPlay';
import { worldStats } from '../sim/shipStats';
import { guideCard } from './guideHint';
import { mapCornerButton } from './mapButton';
import { formatMessage } from './messageText';
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

  const kind = PORT_KIND_LABEL[planet.kind];
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
  const keyOf = (a: ActionId) => hotkeyFor(controller.settings.bindings, a) ?? null;
  const notices = [
    ...(notice ? [notice] : []),
    ...controller.takeNotices().map((n) => formatMessage(n, keyOf, ctx.inputMode.mode === 'touch')),
  ];
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
  const payFine = (gov: string) => {
    const r = controller.payFines(gov);
    status.classList.remove('sw-status-bad');
    if (r.ok) status.textContent = `Paid ${formatCredits(r.paid)} to ${governmentShortName(gov, data)}.`;
    else if (r.error === 'short') {
      status.textContent = 'Not enough credits.';
      status.classList.add('sw-status-bad'); // a refusal is not the success green
    }
    render();
  };
  const setStatus = (text: string, bad = false) => {
    status.textContent = text;
    status.classList.toggle('sw-status-bad', bad); // a refusal is not the success green
  };
  const hire = (offerId: string) => {
    const r = controller.hireEscort(offerId);
    if (r.ok) setStatus(`${r.escort.name} joins your escort.`);
    else setStatus(hireRefusal(data, r.error), true);
    render();
  };
  // Dismiss can't be undone (and sits beside Sell as prize), so it asks first.
  const dismiss = async (e: Escort) => {
    const ok = await confirmDialog(ctx.root, {
      title: `Dismiss ${e.name}?`,
      message: wingmanDef(data, e)
        ? `${e.name} goes home to ${data.planets[wingmanDef(data, e)!.homePort]?.name ?? 'their bar'}. You can recruit them again there, but their takedowns start over and the fee is not refunded.`
        : e.hired
        ? `${e.name} leaves your service for good. The hiring fee is not refunded.`
        : `The ship is lost for good. Sell as prize pays ${formatCredits(prizeValueOf(data, e.shipId))} instead.`,
      confirm: 'Dismiss',
      danger: true,
    });
    if (!ok) return;
    controller.dismissEscort(e.id);
    status.classList.remove('sw-status-bad');
    render();
  };
  const sell = (id: string) => {
    const r = controller.sellEscort(id);
    if (r.ok) setStatus(`Sold the prize for ${formatCredits(r.paid)}.`);
    render();
  };
  const recruit = (wingmanId: string) => {
    const r = controller.recruitWingman(wingmanId);
    if (r.ok) setStatus(r.line);
    else setStatus(hireRefusal(data, r.error), true);
    render();
  };
  const hireCrew = () => {
    const r = controller.hireCrew();
    if (r.ok) setStatus(`Hired ${r.count} crew for ${formatCredits(r.paid)}.`);
    else if (r.error === 'short') setStatus('Not enough credits.', true);
    render();
  };
  const repairAll = () => {
    const r = controller.repairEscorts();
    if (r.ok) setStatus(`Repaired your escorts for ${formatCredits(r.paid)}.`);
    else if (r.error === 'short') setStatus('Not enough credits.', true);
    render();
  };
  // The map returns here (a fresh planet screen) when it closes.
  const openMap = () => ctx.go.map({ onClose: () => ctx.go.planet(planetId) });
  const leave = () => {
    // Hand the keyboard back to the game: no focused button survives into flight.
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
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
      el('div', { class: 'sw-stat', text: `Cargo: ${cargoLabel(w, data)}` }),
      el('div', { class: 'sw-stat', text: `Crew: ${w.crew}/${crewCap(w, data)}`, attrs: { 'data-testid': 'crew-stat' } }),
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
    // The price per jump too, so a dear fringe port shows it (phone playtest bug 6).
    const perJump = formatCredits(Math.round(planet.fuelPrice * data.config.fuelPerJump));
    const refuelBtn = button(canRefuel ? `Refuel — ${formatCredits(q.cost)} (${perJump}/jump)` : 'Refuel', refuel, {
      hotkey: hotkeyFor(bindings, 'refuel'),
      disabled: !canRefuel,
    });
    const reason = !canRefuel && q?.reason ? el('p', { class: 'sw-reason', text: REFUEL_REASON[q.reason] }) : null;
    // One row per government the pilot owes fines to (spec §7).
    const fineRows = Object.keys(w.law)
      .filter((gov) => legalStatus(w, data, gov) !== 'clean')
      .map((gov) =>
        el('div', { class: 'sw-fine-row', attrs: { 'data-fine': gov } }, [
          el('span', { text: `Fines owed to ${governmentShortName(gov, data)}: ${formatCredits(fineFor(w, data, gov))}` }),
          button('Pay', () => payFine(gov)),
        ]),
      );
    const offers = controller.escortOffers();
    const hireList =
      offers.length > 0
        ? el('section', { class: 'sw-escort-list', attrs: { 'data-testid': 'hire-escorts', 'aria-label': 'Hire escorts' } }, [
            el('h3', { class: 'sw-hotkey-group-title', text: 'Hire escorts' }),
            ...offers.map((o) =>
              el('div', { class: 'sw-escort-row', attrs: { 'data-offer': o.offerId } }, [
                el('span', { text: `${o.name} — ${data.ships[o.shipId]?.name ?? o.shipId} · fee ${formatCredits(o.fee)} · ${formatCredits(o.wage)}/day` }),
                button('Hire', () => hire(o.offerId)),
              ]),
            ),
          ])
        : null;
    const crewOffer = controller.crewForHire();
    const crewRow =
      crewOffer.count > 0
        ? el('div', { class: 'sw-escort-row', attrs: { 'data-testid': 'hire-crew' } }, [
            el('span', { text: `Crew ${w.crew}/${crewCap(w, data)} · ${formatCredits(data.fleet.crew.hireCost)} each` }),
            button(`Hire ${crewOffer.count} (${formatCredits(crewOffer.cost)})`, hireCrew),
          ])
        : null;
    const wing = controller.wingmanOffer();
    const wingList = wing
      ? el('section', { class: 'sw-escort-list', attrs: { 'data-testid': 'wingman-offer', 'aria-label': 'Wingman' } }, [
          el('h3', { class: 'sw-hotkey-group-title', text: 'Wingman' }),
          el('div', { class: 'sw-escort-row', attrs: { 'data-wingman': wing.id } }, [
            el('span', { text: `${wing.name} — ${data.ships[wing.shipId]?.name ?? wing.shipId} · fee ${formatCredits(wing.fee)} · ${formatCredits(wing.wage)}/day` }),
            el('span', { class: 'sw-reason', text: wing.bio }),
            button('Recruit', () => recruit(wing.id)),
          ]),
        ])
      : null;
    /** "Wingman · Seasoned (4)", "ejected, back from 12 Mar 3207", or the wage / kept capture. */
    const escortNote = (e: Escort): string => {
      const pay = e.hired ? (e.wage > 0 ? `${formatCredits(e.wage)}/day` : 'on loan, no wage') : 'kept capture';
      if (!wingmanDef(data, e)) return pay;
      const rank = `Wingman · ${wingmanRank(data, e.takedowns ?? 0).name} (${e.takedowns ?? 0})`;
      return e.downUntilDay !== undefined ? `${rank} · ejected, back from ${formatDate(e.downUntilDay, data.config)}` : `${rank} · ${pay}`;
    };
    const repair = controller.escortRepairCost();
    const escortList =
      w.escorts.length > 0
        ? el('section', { class: 'sw-escort-list', attrs: { 'data-testid': 'your-escorts', 'aria-label': 'Your escorts' } }, [
            el('h3', { class: 'sw-hotkey-group-title', text: 'Your escorts' }),
            ...w.escorts.map((e) =>
              el('div', { class: 'sw-escort-row', attrs: { 'data-escort': e.id } }, [
                el('span', {
                  text: `${e.name} — ${data.ships[e.shipId]?.name ?? e.shipId} · armor ${Math.round(e.armor)}/${Math.round(escortMaxArmor(data, e))} · ${escortNote(e)}`,
                }),
                button('Dismiss', () => void dismiss(e)),
                e.hired ? null : button(`Sell as prize (${formatCredits(prizeValueOf(data, e.shipId))})`, () => sell(e.id)),
              ]),
            ),
            repair > 0
              ? el('div', { class: 'sw-escort-row', attrs: { 'data-testid': 'repair-escorts' } }, [
                  el('span', { text: `Repair all — ${formatCredits(repair)}` }),
                  button('Repair', repairAll),
                ])
              : null,
          ])
        : null;
    const logBtn = button('Mission Log', openMissionLog, { hotkey: hotkeyFor(bindings, 'missionLog') });
    const helpBtn = button('How to Play', openHowToPlay, { hotkey: hotkeyFor(bindings, 'howToPlay') });
    const leaveBtn = button('Leave', leave, { class: 'sw-btn-primary sw-leave', hotkey: hotkeyFor(bindings, 'leave') });
    // Leave sits under the list, not in it: on a short screen the list scrolls in its own box above Leave,
    // so Leave never covers a row (Nov 12 playtest, 812×375: a sticky Leave hid Refuel and the rows below).
    const list = el('div', { class: 'sw-actions-list', attrs: { 'data-testid': 'planet-actions-list' } });
    actions.replaceChildren(list, leaveBtn);
    list.replaceChildren(
      ...[exchangeBtn, missionsBtn, shipyardBtn, outfitterBtn, barBtn, refuelBtn].filter((b) => b !== null),
      ...(reason ? [reason] : []),
      ...fineRows,
      // Crew, wingman and escort lists scroll in their own box, so Leave is never pushed off screen (playtest bug 22).
      ...(() => {
        const lists = [crewRow, wingList, hireList, escortList].filter((x) => x !== null);
        return lists.length ? [el('div', { class: 'sw-planet-lists', attrs: { 'data-testid': 'planet-lists' } }, lists)] : [];
      })(),
      logBtn,
      helpBtn,
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
