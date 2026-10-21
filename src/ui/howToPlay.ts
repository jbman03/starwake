import { ACTION_GROUP, ACTION_IDS, ACTION_LABEL, type ActionGroup, type ActionId } from '../input/actions';
import type { GameData } from '../data/schemas';
import type { Bindings } from '../input/bindings';
import { keyName } from '../input/keyNames';
import { MAX_MISSIONS } from '../sim/missions';
import type { UiContext } from './context';
import { button, el, hotkeyFor } from './dom';

export type HowToPlayTab = 'flying' | 'trade' | 'missions' | 'travel' | 'controls';

export const HOW_TO_PLAY_TABS: { id: HowToPlayTab; text: string }[] = [
  { id: 'flying', text: 'Flying' },
  { id: 'trade', text: 'Planets & trade' },
  { id: 'missions', text: 'Missions' },
  { id: 'travel', text: 'Travel & fuel' },
  { id: 'controls', text: 'Controls' },
];

/** Same grouping and order as the hotkey editor. */
const GROUPS: { id: ActionGroup; title: string }[] = [
  { id: 'flight', title: 'Flight' },
  { id: 'planet', title: 'Planet screen' },
  { id: 'exchange', title: 'Exchange' },
  { id: 'shop', title: 'Shops' },
  { id: 'menus', title: 'Menus' },
];

/** What the same action is on a phone. Every action needs an entry (the compiler checks). */
export const PHONE_CONTROLS: Record<ActionId, string> = {
  thrust: 'Stick (or THR in classic steering)',
  turnLeft: 'Stick',
  turnRight: 'Stick',
  reverse: 'Stick',
  autoStop: 'STOP',
  firePrimary: 'FIRE',
  fireSecondary: 'MSL',
  nextTarget: 'TGT',
  nearestHostile: 'None on phone',
  faceTarget: 'None on phone',
  land: 'LAND ON (planet) button, or tap the planet',
  jump: 'JUMP TO (system) button',
  autopilot: 'AUTOPILOT TO JUMP POINT button; TAKE CONTROL stops it',
  map: 'Tap Map, or PLOT COURSE',
  flightMissionLog: 'Pause (II), then Mission Log',
  pause: 'II button',
  interact: 'Answer hail or Open site button',
  openExchange: 'Tap the button',
  openMissions: 'Tap the button',
  openShipyard: 'Tap the button',
  openOutfitter: 'Tap the button',
  refuel: 'Tap the button',
  openMap: 'Tap the button',
  missionLog: 'Tap the button',
  howToPlay: 'Tap the button',
  leave: 'Tap the button',
  buyGoods: 'Buy buttons (hold for 1 t)',
  sellGoods: 'Sell buttons (hold for 1 t)',
  shopBuy: 'Buy button',
  shopSell: 'Sell button',
  shopPrevPage: 'Prev button',
  shopNextPage: 'Next button',
  encounterChoice1: 'Tap the choice',
  encounterChoice2: 'Tap the choice',
  encounterChoice3: 'Tap the choice',
  back: 'Back or Close button',
  menuHowToPlay: 'Tap the button',
  toggleSound: 'Settings → General → Mute sound'
};

/** Actions the game accepts and binds but that do nothing yet (no combat in this version). */
export const COMING_SOON: readonly ActionId[] = ['firePrimary', 'fireSecondary', 'nearestHostile'];

export interface ControlRow {
  action: ActionId;
  label: string;
  /** Friendly names of the bound keys (both slots, empty ones left out). */
  keys: string[];
  phone: string;
  /** True when the action does nothing yet. */
  soon: boolean;
}

/** The Controls tab's rows, from the action list and the current bindings. */
export function controlRows(bindings: Bindings): { title: string; rows: ControlRow[] }[] {
  return GROUPS.map((g) => ({
    title: g.title,
    rows: ACTION_IDS.filter((id) => ACTION_GROUP[id] === g.id).map((id) => ({
      action: id,
      label: ACTION_LABEL[id],
      keys: bindings[id].filter((c): c is string => c !== null).map(keyName),
      phone: PHONE_CONTROLS[id],
      soon: COMING_SOON.includes(id),
    })),
  }));
}

type Block = { heading: string; text: string };

/** The four text tabs. Key names follow the player's bindings; numbers come from the data. */
export function tabText(tab: Exclude<HowToPlayTab, 'controls'>, bindings: Bindings, data: GameData): Block[] {
  const k = (a: ActionId) => hotkeyFor(bindings, a) ?? 'unbound';
  const ship = data.ships[data.config.startShipId];
  const perJump = data.config.fuelPerJump;
  const tank = Math.floor(ship.fuelCapacity / perJump);
  switch (tab) {
    case 'flying':
      return [
        { heading: 'Steer and brake', text: `${k('thrust')} thrusts, ${k('turnLeft')} and ${k('turnRight')} turn, ${k('reverse')} reverses. ${k('autoStop')} turns you around and brakes to a stop. On a phone, push the stick to fly and tap STOP to brake.` },
        { heading: 'Targets', text: `${k('nextTarget')} cycles through the ships in the system, then the planets and stations; ${k('faceTarget')} turns you to face the target. Click or tap a ship or planet to target it. A targeted ship's name, faction, hull and role show on the target line. ${k('autopilot')} flies to the targeted planet, or out to the jump point when nothing is targeted; press it again, or any steering key, to take over.` },
        { heading: 'Other ships', text: 'The galaxy is busy. Ships jump in, land, take off and pass through, and the busy core sees more of them than the quiet fringe. For now they are all just going about their business.' },
        { heading: 'Hails and sites', text: `Now and then a ship hails you on the radio, or a white diamond appears in space, on the view and the radar. ${k('interact')} answers a hail. To open a site, fly close and slow, then press ${k('interact')}. On a phone, the bottom button changes to Answer hail or Open site. An encounter is a short card: press ${k('encounterChoice1')}, ${k('encounterChoice2')} or ${k('encounterChoice3')} to choose, then Done (or Esc) to carry on.` },
        { heading: 'Weapons', text: 'Weapons and combat arrive in a later update. The fire keys are bindable already but do nothing yet.' },
        { heading: 'Landing', text: `Target a planet or station, fly close, slow right down, then press ${k('land')}. On a phone, tap the planet or the LAND ON button.` },
        { heading: 'Sound', text: `${k('toggleSound')} turns sound on or off. Volume and mute are also in Settings → General.` },
        { heading: 'Pause', text: `${k('pause')} pauses the game and opens the pause menu, where you can save, change settings or quit.` },
      ];
    case 'trade':
      return [
        { heading: 'Buy low, sell high', text: 'Each exchange shows a price level for every good: Low, Med or High. Buy where a good is Low, fly to a port where it is High, and sell.' },
        { heading: 'Buying and selling', text: `Select a good, then ${k('buyGoods')} buys and ${k('sellGoods')} sells 10 t at a time; hold Shift or long-press the button for 1 t. Buy max and Sell all fill or empty the line. The starter shuttle's hold fits ${ship.cargo} t; the Shipyard and Outfitter sell bigger holds.` },
        { heading: 'Price spreads', text: 'Prices differ more from port to port now, so a good run pays better. The first-flight guide shows one: it follows the route you actually fly and has you carry a 20 t trade.' },
        { heading: 'Prices move', text: 'Prices drift from day to day. News events cause a surplus or shortage at one port. Your own trading counts too: heavy buying pushes a price up, heavy selling pushes it down, and both ease back over a few days.' },
        { heading: 'Credits', text: 'Trading never takes your credits below zero. A pilot in debt (after a tow) can sell but not buy.' },
      ];
    case 'missions':
      return [
        { heading: 'Taking a job', text: `The Mission Computer (${k('openMissions')}) lists jobs posted at the port: deliveries, rush deliveries, passenger trips and garbage runs. Each shows its destination, pay and any deadline. You can hold up to ${MAX_MISSIONS} jobs; cargo and passengers use your hold and berths.` },
        { heading: 'Getting paid', text: 'Land at the destination port before the deadline. Rush jobs pay less than they used to, so take one when you are headed that way anyway. Most jobs pay on landing; some pay an advance up front. A job that runs past its deadline fails.' },
        { heading: 'Mission Log', text: `The Mission Log (${k('missionLog')} on a planet, ${k('flightMissionLog')} in flight) lists your active jobs. Show on map marks a job's destination on the star map. Its Notes section keeps the rumours and leads you pick up; some of them lead somewhere worth going. Some shipyards also tease ships you can't buy yet.` },
        { heading: 'Abandoning', text: 'You can give up a job from the log. Nothing is paid and the cargo is freed. If it paid an advance, the advance is taken back, so you need enough credits to return it.' },
      ];
    case 'travel':
      return [
        { heading: 'Jumping', text: `Fly clear of the star, then press ${k('jump')}. Each jump uses ${perJump} fuel and takes one day. The starter shuttle's tank holds ${tank} jumps' worth; the Outfitter sells bigger tanks. With nothing targeted, ${k('autopilot')} flies you out to the jump point.` },
        { heading: 'The star map', text: `Press ${k('map')} in flight (${k('openMap')} on a planet) to open the map; N is the map key everywhere, and M still works in flight. Pick a system you know, then Set course. Autopilot and jump along the route. On a phone, tap PLOT COURSE, or the Map button (always shown, on every planet screen too).` },
        { heading: 'Refuelling', text: `Every port sells fuel; press ${k('refuel')} to refuel. Fuel is charged per unit, and fringe ports charge more, so top up in the core worlds when you can.` },
        { heading: 'Stranded?', text: `With less than one jump of fuel and no port in the system, you can call a tow from the pause menu or the CALL TOW button. It costs ${data.config.towFee} cr, which can leave you in debt. The tow takes you to the nearest port, uses days on the way, and jobs that pass their deadline fail.` },
      ];
  }
}

function controlsPanel(bindings: Bindings): HTMLElement {
  return el(
    'div',
    { class: 'sw-htp-controls' },
    controlRows(bindings).map((g) =>
      el('section', { class: 'sw-hotkey-group', attrs: { 'aria-label': g.title } }, [
        el('h3', { class: 'sw-hotkey-group-title', text: g.title }),
        el('div', { class: 'sw-htp-row sw-htp-head', attrs: { 'aria-hidden': 'true' } }, [
          el('span', { text: 'Action' }),
          el('span', { text: 'Keyboard' }),
          el('span', { text: 'Phone' }),
        ]),
        ...g.rows.map((r) =>
          el('div', { class: 'sw-htp-row', attrs: { 'data-action': r.action } }, [
            el('span', { class: 'sw-htp-action', text: r.soon ? `${r.label} (coming soon)` : r.label }),
            el('span', { class: 'sw-htp-keys', attrs: { 'data-testid': `keys-${r.action}` }, text: r.keys.length ? r.keys.join(' / ') : 'Unbound' }),
            el('span', { class: 'sw-htp-phone', text: r.phone }),
          ]),
        ),
      ]),
    ),
  );
}

function textPanel(blocks: Block[]): HTMLElement {
  return el(
    'div',
    { class: 'sw-htp-text' },
    blocks.map((b) => el('section', {}, [el('h3', { class: 'sw-hotkey-group-title', text: b.heading }), el('p', { class: 'sw-htp-p', text: b.text })])),
  );
}

/** Replay first flight: restarts the guide for the loaded pilot (step 1 here if landed, else the flight steps). */
function replay(ctx: UiContext, seeIt: string): { button: HTMLButtonElement; note: HTMLElement } {
  const note = el('p', { class: 'sw-reason', attrs: { 'aria-live': 'polite' } });
  const enabled = !!ctx.controller.guide;
  const btn = button(
    'Replay first flight',
    () => {
      const g = ctx.controller.guide;
      note.textContent = g?.restart()
        ? `The guide starts again at step ${g.current()?.step ?? 1}. ${seeIt}`
        : 'The guide has no trade to show from here.';
    },
    { disabled: !enabled },
  );
  btn.setAttribute('data-testid', 'htp-replay');
  if (!enabled) note.textContent = 'Load a pilot first';
  return { button: btn, note };
}

/** How to Play: a short reference with tabs. Closing (Back or Esc) runs `onClose`, which reopens whatever opened it. */
export function showHowToPlay(ctx: UiContext, opts: { onClose: () => void; tab?: HowToPlayTab }): void {
  const bindings = () => ctx.controller.settings.bindings;
  let active: HowToPlayTab = opts.tab ?? 'flying';

  const tabBar = el('div', { class: 'sw-tabs', attrs: { role: 'tablist' } });
  const body = el('div', { class: 'sw-tab-panel sw-htp-body', attrs: { role: 'tabpanel' } });
  const paint = () => {
    tabBar.replaceChildren(
      ...HOW_TO_PLAY_TABS.map((t) =>
        el('button', {
          class: `sw-btn sw-tab${t.id === active ? ' sw-tab-active' : ''}`,
          text: t.text,
          attrs: { type: 'button', role: 'tab', 'aria-selected': String(t.id === active) },
          onClick: () => {
            active = t.id;
            paint();
          },
        }),
      ),
    );
    body.replaceChildren(active === 'controls' ? controlsPanel(bindings()) : textPanel(tabText(active, bindings(), ctx.controller.data)));
    body.scrollTop = 0;
  };
  paint();

  // Where Back leads: a planet screen when landed, the pause menu or main menu otherwise.
  const r = replay(ctx, ctx.controller.landedPlanetId ? 'Go back to the planet to see it.' : 'Resume flight to see it.');
  const screen = el('div', { class: 'sw-screen sw-overlay', attrs: { 'data-testid': 'how-to-play' } }, [
    el('div', { class: 'sw-panel sw-menu sw-menu-wide sw-settings sw-htp' }, [
      el('h1', { class: 'sw-title', text: 'How to Play' }),
      tabBar,
      body,
      r.note,
      el('div', { class: 'sw-actions sw-actions-row' }, [r.button, button('Back', opts.onClose, { class: 'sw-btn-primary', hotkey: hotkeyFor(bindings(), 'back') })]),
    ]),
  ]);

  ctx.mount(screen, {
    groups: ['menus'],
    onPress: (pressed) => {
      if (pressed.has('back')) opts.onClose();
    },
  });
}
