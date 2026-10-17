import { ACTION_GROUP, ACTION_IDS, ACTION_LABEL, type ActionGroup, type ActionId } from '../input/actions';
import type { Bindings } from '../input/bindings';
import { keyName } from '../input/keyNames';
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
  { id: 'menus', title: 'Menus' },
];

/** What the same action is on a phone. Every action needs an entry (the compiler checks). */
export const PHONE_CONTROLS: Record<ActionId, string> = {
  thrust: 'Stick',
  turnLeft: 'Stick',
  turnRight: 'Stick',
  reverse: 'Stick',
  autoStop: 'STOP',
  firePrimary: 'FIRE',
  fireSecondary: 'MSL',
  nextTarget: 'TGT',
  nearestHostile: 'TGT',
  faceTarget: 'Stick (point to steer)',
  land: 'Bottom button, or tap the planet',
  jump: 'Bottom button',
  autopilot: 'Bottom button',
  map: 'Tap the radar, or PLOT COURSE',
  flightMissionLog: 'Pause (II), then Mission Log',
  pause: 'II button',
  openExchange: 'Tap the button',
  openMissions: 'Tap the button',
  refuel: 'Tap the button',
  openMap: 'Tap the button',
  missionLog: 'Tap the button',
  howToPlay: 'Tap the button',
  leave: 'Tap the button',
  buyGoods: 'Buy buttons (hold for 1 t)',
  sellGoods: 'Sell buttons (hold for 1 t)',
  back: 'Back or Close button',
  menuHowToPlay: 'Tap the button',
};

export interface ControlRow {
  action: ActionId;
  label: string;
  /** Friendly names of the bound keys (both slots, empty ones left out). */
  keys: string[];
  phone: string;
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
    })),
  }));
}

type Block = { heading: string; text: string };

/** The four text tabs. Key names follow the player's bindings. */
export function tabText(tab: Exclude<HowToPlayTab, 'controls'>, bindings: Bindings): Block[] {
  const k = (a: ActionId) => hotkeyFor(bindings, a) ?? 'unbound';
  switch (tab) {
    case 'flying':
      return [
        { heading: 'Steer and brake', text: `Up thrusts, Left and Right turn, Down reverses. ${k('autoStop')} turns you around and brakes to a stop. On a phone, push the stick to fly and tap STOP to brake.` },
        { heading: 'Weapons and targets', text: `${k('firePrimary')} fires your main weapon and ${k('fireSecondary')} your missile. ${k('nextTarget')} picks the next target, ${k('nearestHostile')} the nearest hostile, ${k('faceTarget')} turns you to face it.` },
        { heading: 'Landing', text: `Target a planet or station, fly close, slow right down, then press ${k('land')}. On a phone, tap the planet or the bottom button.` },
        { heading: 'Pause', text: `${k('pause')} pauses the game and opens the pause menu, where you can save, change settings or quit.` },
      ];
    case 'trade':
      return [
        { heading: 'Buy low, sell high', text: 'Each exchange shows a price level for every good: Low, Med or High. Buy where a good is Low, fly to a port where it is High, and sell.' },
        { heading: 'Buying and selling', text: `Select a good, then ${k('buyGoods')} buys and ${k('sellGoods')} sells 10 t at a time; hold Shift or long-press the button for 1 t. Buy max and Sell all fill or empty the line. Your hold fits 20 t.` },
        { heading: 'Prices move', text: 'Prices drift from day to day. News events cause a surplus or shortage at one port. Your own trading counts too: heavy buying pushes a price up, heavy selling pushes it down, and both ease back over a few days.' },
        { heading: 'Credits', text: 'Trading never takes your credits below zero. A pilot in debt (after a tow) can sell but not buy.' },
      ];
    case 'missions':
      return [
        { heading: 'Taking a job', text: `The Mission Computer (${k('openMissions')}) lists jobs posted at the port: deliveries, rush deliveries, passenger trips and garbage runs. Each shows its destination, pay and any deadline. You can hold up to 8 jobs; cargo and passengers use your hold and berths.` },
        { heading: 'Getting paid', text: 'Land at the destination port before the deadline. Most jobs pay on landing; some pay an advance up front. A job that runs past its deadline fails.' },
        { heading: 'Mission Log', text: `The Mission Log (${k('missionLog')} on a planet, ${k('flightMissionLog')} in flight) lists your active jobs and shows them on the star map.` },
        { heading: 'Abandoning', text: 'You can give up a job from the log. Nothing is paid and the cargo is freed. If it paid an advance, the advance is taken back, so you need enough credits to return it.' },
      ];
    case 'travel':
      return [
        { heading: 'Jumping', text: `Fly clear of the star, then press ${k('jump')}. Each jump uses 100 fuel and takes one day. The shuttle's tank holds three jumps' worth. ${k('autopilot')} flies you out to the jump point.` },
        { heading: 'The star map', text: `Press ${k('map')} in flight (${k('openMap')} on a planet) to open the map. Pick a system you know, then Set course. Autopilot and jump along the route. On a phone, tap PLOT COURSE or the radar.` },
        { heading: 'Refuelling', text: `Ports with a fuel pump let you refuel (${k('refuel')}); fuel is charged per unit. Check your fuel before you leave, since not every port sells it.` },
        { heading: 'Stranded?', text: 'With less than one jump of fuel and no fuel for sale in the system, you can call a tow from the pause menu or the bottom button. It costs 500 cr, which can leave you in debt. The tow takes you to the nearest port with fuel, uses days on the way, and jobs that pass their deadline fail.' },
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
            el('span', { class: 'sw-htp-action', text: r.label }),
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
function replay(ctx: UiContext): { button: HTMLButtonElement; note: HTMLElement } {
  const note = el('p', { class: 'sw-reason', attrs: { 'aria-live': 'polite' } });
  const enabled = !!ctx.controller.guide;
  const btn = button(
    'Replay first flight',
    () => {
      const g = ctx.controller.guide;
      note.textContent = g?.restart()
        ? `The guide starts again at step ${g.current()?.step ?? 1}. Close this screen to see it.`
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
    body.replaceChildren(active === 'controls' ? controlsPanel(bindings()) : textPanel(tabText(active, bindings())));
    body.scrollTop = 0;
  };
  paint();

  const r = replay(ctx);
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
