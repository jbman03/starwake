import { ACTION_GROUP, ACTION_IDS, ACTION_LABEL, type ActionGroup, type ActionId } from '../input/actions';
import type { GameData } from '../data/schemas';
import type { Bindings } from '../input/bindings';
import { keyName } from '../input/keyNames';
import { MAX_MISSIONS } from '../sim/missions';
import { jumpFixedSec } from '../sim/world';
import type { UiContext } from './context';
import { button, el, hotkeyFor } from './dom';

export type HowToPlayTab = 'flying' | 'trade' | 'missions' | 'travel' | 'law' | 'controls';

export const HOW_TO_PLAY_TABS: { id: HowToPlayTab; text: string }[] = [
  { id: 'flying', text: 'Flying' },
  { id: 'trade', text: 'Planets & trade' },
  { id: 'missions', text: 'Missions' },
  { id: 'travel', text: 'Travel & fuel' },
  { id: 'law', text: 'Law & ranks' },
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
  cycleSecondary: 'Tap the label under MSL',
  nextTarget: 'TGT',
  nearestHostile: 'Hold TGT',
  faceTarget: 'None on phone',
  board: 'Board button',
  land: 'LAND ON (planet) button, or tap the planet',
  jump: 'JUMP TO (system) button; SKIP during the jump',
  autopilot: 'AUTOPILOT TO JUMP POINT or Fly to (site) button; TAKE CONTROL stops it',
  map: 'Tap Map, or PLOT COURSE',
  flightMissionLog: 'Pause (II), then Mission Log',
  pause: 'II button',
  interact: 'Answer hail, or the Scan, Search or Open site button',
  openExchange: 'Tap the button',
  openMissions: 'Tap the button',
  openShipyard: 'Tap the button',
  openOutfitter: 'Tap the button',
  openBar: 'Tap the button',
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
  encounterChoice4: 'Tap the choice',
  encounterChoice5: 'Tap the choice',
  back: 'Back or Close button',
  menuHowToPlay: 'Tap the button',
  toggleSound: 'Settings → General → Mute sound'
};

/** Actions the game accepts and binds but that do nothing yet (none at the moment). */
export const COMING_SOON: readonly ActionId[] = [];

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

/** The text tabs. Key names follow the player's bindings; numbers come from the data. */
export function tabText(tab: Exclude<HowToPlayTab, 'controls'>, bindings: Bindings, data: GameData): Block[] {
  const k = (a: ActionId) => hotkeyFor(bindings, a) ?? 'unbound';
  const ship = data.ships[data.config.startShipId];
  const perJump = data.config.fuelPerJump;
  const tank = Math.floor(ship.fuelCapacity / perJump);
  const jumpSec = Math.max(1, Math.round(jumpFixedSec(data)));
  switch (tab) {
    case 'flying':
      return [
        { heading: 'Steer and brake', text: `${k('thrust')} thrusts, ${k('turnLeft')} and ${k('turnRight')} turn, ${k('reverse')} reverses. ${k('autoStop')} turns you around and brakes to a stop. On a phone, push the stick to fly and tap STOP to brake.` },
        { heading: 'Targets', text: `${k('nextTarget')} cycles through the ships in the system, then the planets and stations; ${k('faceTarget')} turns you to face the target. Click or tap a ship or planet to target it. A targeted ship's name, faction, hull and role show on the target line. ${k('autopilot')} flies to the targeted planet, or out to the jump point when nothing is targeted; press it again, or any steering key, to take over.` },
        { heading: 'Other ships', text: 'The galaxy is busy. Ships jump in, land, take off and pass through, and the busy core sees more of them than the quiet fringe. Most are traders going about their business. Raiders, mostly out on the fringe, attack or demand a toll; patrols fight raiders, and anyone who angers them.' },
        { heading: 'Hails and sites', text: `Now and then a ship hails you on the radio, or a white diamond appears in space, on the view and the radar. ${k('interact')} answers a hail. To open a site, fly close and slow, then press ${k('interact')}. On a phone, the bottom button changes to Answer hail or Open site. An encounter is a short card: press ${k('encounterChoice1')}, ${k('encounterChoice2')} or ${k('encounterChoice3')} to choose, then Done (or Esc) to carry on.` },
        { heading: 'Weapons', text: `${k('firePrimary')} fires your guns and ${k('fireSecondary')} fires the selected launcher; ${k('cycleSecondary')} picks the next launcher. ${k('nearestHostile')} targets the nearest hostile ship. On a phone, hold FIRE or MSL.` },
        { heading: 'Combat and boarding', text: 'Every ship has shields and armor. Hits take the shields first, then the armor; shields come back after a few seconds without a hit. A ship whose armor drops below a tenth is disabled: it drifts to a stop and can no longer fight. Hit a disabled ship again and it may blow up.' },
        { heading: 'Boarding', text: `Fly beside a disabled ship and slow to her speed, then press ${k('board')} (on a phone, the BOARD button). Take her credits, cargo or ammo, or try to capture her: the odds show on the button and depend on your crew against hers. A failed try sends your party back and her crew scuttles her. A captured ship is yours to take command of (your old ship is traded in, and she flies patched up until you land) or to sell as a prize.` },
        { heading: 'Raider demands', text: `A raider may hail and demand credits or cargo. Answer with ${k('interact')}, then pay, dump the cargo or refuse. Refuse, or wait ${data.combat.demand.lapseSec} seconds, and it attacks.` },
        { heading: 'Losing your ship', text: `If you are disabled, wait until no enemy is near (a message says when). Then call a tow: press ${k('pause')} and choose Call for tow in the pause menu, or on a phone tap CALL TOW. The tow takes you to a port for ${data.config.towFee} cr. If your ship is destroyed, an escape pod (sold at the Outfitter) gets you to a nearby port in a starter ship, with any job cargo and passengers lost. Without a pod, your last save loads.` },
        { heading: 'Combat jobs', text: 'Concord and Free Reach ports post bounties (find a named ship, disable or destroy her) and clear-the-lanes jobs (disable or destroy a number of raiders in a system), but only for a pilot with a gun. Come back to the port to be paid.' },
        { heading: 'Landing', text: `Target a planet or station, fly close, slow right down, then press ${k('land')}. On a phone, tap the planet or the LAND ON button.` },
        { heading: 'Sound and music', text: `Quiet ambient music follows what you are doing: docked, flying the core or the fringe, jumping or fighting. Settings → General has separate Music and Effects sliders. ${k('toggleSound')} mutes everything, music included, and turns it back on; the Mute sound box in Settings → General does the same.` },
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
        { heading: 'Taking a job', text: `The Mission Computer (${k('openMissions')}) lists jobs posted at the port: deliveries, rush deliveries, passenger trips, garbage runs and, for an armed pilot, bounties and clear-the-lanes jobs. Each shows its destination, pay and any deadline. You can hold up to ${MAX_MISSIONS} jobs; cargo and passengers use your hold and berths.` },
        { heading: 'Getting paid', text: 'Land at the destination port before the deadline. Rush jobs pay less than they used to, so take one when you are headed that way anyway. Most jobs pay on landing; some pay an advance up front. A job that runs past its deadline fails.' },
        { heading: 'Mission Log', text: `The Mission Log (${k('missionLog')} on a planet, ${k('flightMissionLog')} in flight) lists your active jobs. Show on map marks a job's destination on the star map. Its Notes section keeps the rumours and leads you pick up; some of them lead somewhere worth going. Some shipyards also tease ships you can't buy yet.` },
        { heading: 'The spaceport bar', text: `Press ${k('openBar')} on a planet screen to visit the bar. Contacts there offer story jobs and side jobs, and the regulars trade local gossip. The first story job waits in the Halcyon bar. A bar with nothing new shows a lead line that points you somewhere worth a visit.` },
        { heading: 'Story jobs', text: `A story job runs in steps: go somewhere, land, deliver or ferry something, scan or search a site in space, or meet a ship that hails you. In flight, ${k('interact')} (or the Scan or Search button on a phone) works a site when you are close and slow.` },
        { heading: 'Story log', text: `The Story section of the Mission Log (${k('missionLog')}) shows the current step and where it is. Show on map marks the place, Next lead suggests where to look when you are stuck, and Done closes the log. A side job can be abandoned and goes back to the giver's bar; a main-story job cannot. A main-story job that misses its deadline returns to its giver's bar the next day.` },
        { heading: 'Story arcs', text: 'Choosing a side in the main story opens a longer story arc for that faction, which ends in a rare ship. Side jobs in bars across the galaxy can earn unique gear.' },
        { heading: 'Standing', text: 'Each faction rates you cool, neutral or friend, shown on your pilot card. Friends are offered things others are not: some ships and gear are locked behind friendship.' },
        { heading: 'Abandoning', text: 'You can give up a job from the log. Nothing is paid and the cargo is freed. If it paid an advance, the advance is taken back, so you need enough credits to return it.' },
      ];
    case 'travel':
      return [
        { heading: 'Jumping', text: `Fly clear of the star, then press ${k('jump')}. Each jump uses ${perJump} fuel and takes one day. The starter shuttle's tank holds ${tank} jumps' worth; the Outfitter sells bigger tanks. With nothing targeted, ${k('autopilot')} flies you out to the jump point.` },
        { heading: 'The jump sequence', text: `A jump takes about ${jumpSec} seconds, plus a moment to turn: your ship turns toward the next system, the engines charge, it burns hard as the stars stretch, a flash, and you streak into the new system and slow down. The controls wait until you arrive. In a hurry? Press ${k('jump')} again while turning, charging or burning to skip straight to the flash; on a phone, tap the SKIP button.` },
        { heading: 'The star map', text: `Press ${k('map')} in flight (${k('openMap')} on a planet) to open the map. Pick a system you know, then Set course. Autopilot and jump along the route. On a phone, tap PLOT COURSE, or the Map button (always shown, on every planet screen too).` },
        { heading: 'Refuelling', text: `Every port sells fuel; press ${k('refuel')} to refuel. Fuel is charged per unit, and fringe ports charge more, so top up in the core worlds when you can.` },
        { heading: 'Stranded?', text: `With less than one jump of fuel and no port in the system, you can call a tow from the pause menu or the CALL TOW button. It costs ${data.config.towFee} cr, which can leave you in debt. The tow takes you to the nearest port, uses days on the way, and jobs that pass their deadline fail.` },
      ];
    case 'law': {
      const t = data.law.thresholds;
      const pct = (n: number) => `${Math.round(n * 100)}%`;
      const points = data.factions.concord?.ranks.map((r) => r.points).join(', ') ?? '';
      return [
        { heading: 'Your record', text: `Every government keeps a record of you, and crimes against its ships add heat to it: hitting, disabling or destroying a ship, boarding one, carrying contraband, and running from a patrol. The status follows the heat: Clean, then Suspect from ${t.suspect}, Wanted from ${t.wanted} and Hunted from ${t.hunted}. The sidebar shows the status with the government of the system you are in, and your pilot card lists every government that is not Clean. Heat fades by ${data.law.decayPerDay} a day.` },
        { heading: 'Patrols and fines', text: `A Suspect or Wanted pilot is hailed by a patrol once per visit and asked for the fine: pay it, bribe them, or refuse (a Wanted pilot who refuses is running, and its ships attack). Both can still dock. A Hunted pilot is attacked on sight and the government's ports refuse landing. Fines owed show as a row on the planet screen with a Pay button: the fine is ${data.law.fineRate} cr for each point of heat, and paying clears the record. If you are towed or rescued to a port of a government that hunts you, you are taken into custody and the fine is taken from your credits.` },
        { heading: 'Bribes', text: `A bribe costs ${data.law.bribeMul} times the fine and works ${pct(data.law.bribeChance)} of the time. If it fails, you keep your credits but the patrol is angrier (${data.law.bribeFailHeat} more heat).` },
        { heading: 'Cargo scans', text: `Some goods are contraband in some governments' space. A patrol that comes close may scan your hold, and catches contraband ${pct(data.law.catchChance)} of the time. You can comply (the goods are confiscated and fined), bribe or run. Press ${k('encounterChoice1')}, ${k('encounterChoice2')} or ${k('encounterChoice3')} to answer, as with a hail.` },
        { heading: 'The scrambler', text: `The Scan Scrambler is an outfit sold by independent and unlit ports; no Concord port stocks one. It cuts a patrol scan's catch chance by ${pct(data.law.scramblerCut)}.` },
        { heading: 'Ranks', text: `Doing honest work for a faction earns it rank points: missions, combat jobs, story jobs and killing raiders. Ranks run from 1 to 5 (Concord: ${points} points) and each has a title shown on your pilot card. Helping one faction costs you with its rivals. While a government has you Wanted or Hunted you earn no points with it.` },
        { heading: 'Perks', text: 'Rank 1 is a title. Rank 2 takes a share off prices at that faction\'s ports, rank 3 pays a salary each day you land there, rank 4 raises mission pay and opens its best ships and gear at its hub, and rank 5 gives a bigger discount and salary. Locked items name the rank they need.' },
      ];
    }
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
