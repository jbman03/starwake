import type { GameData } from '../data/schemas';
import type { ActionId } from '../input/actions';
import { dist, type Vec2 } from '../sim/vec';
import type { WorldState } from '../sim/types';
import type { Progress } from './progress';
import type { GuideTarget } from './target';

/** What the guide can see: a snapshot the UI layer builds each time something changes. */
export interface GuideState {
  screen: 'planet' | 'exchange' | 'missions' | 'map' | 'flight' | 'other';
  world: WorldState;
  landedPlanetId: string | null;
  /** Where the ship was when step 6 first saw it flying (the guide fills this in). */
  startPos?: Vec2;
}

export interface TextCtx {
  target: GuideTarget;
  mode: 'keyboard' | 'touch';
  /** Label of the player's key for an action. */
  key: (a: ActionId) => string;
  /** Profit of the guided trade, once known. */
  profit?: number;
  data: GameData;
  /** Name of the planet the player is on, for the welcome line. */
  planetName?: string;
  /** The guide started without a buy-low port, so the player never bought anything. */
  fallback?: boolean;
  /** What the player is looking at now: hints name only controls on this screen. */
  screen: GuideState['screen'];
  landedPlanetId: string | null;
  /** Port the good is bought at (absent in fallback). */
  buyPort?: string;
  /** The plotted route ends in the target system (or the ship is there or jumping there). */
  routeOk: boolean;
}

export interface StepDef {
  id: string;
  text(ctx: TextCtx): string;
  done(s: GuideState, t: GuideTarget, p: Progress, data: GameData): boolean;
}

export const FLY_DISTANCE = 300;
/**
 * Longest touch hint (steps 1–10), in characters, so it wraps to at most 3 lines in the phone
 * rail. Measured once in Chromium: the rail's text column is 98 px of 11 px Trebuchet MS
 * (14 px lines); "To Cinderfall: fly clear, tap Jump. Repeat." (43 chars, the longest system
 * name) fills exactly 3 lines, and 53-char hint sentences need 4. Names in data are mixed-case
 * words, so ordinary text averages ~5.5 px a character; all-caps would need a lower cap.
 * The final card (step 11) is never shown in the rail.
 */
export const TOUCH_HINT_MAX_CHARS = 44;
export const BUY_TONS = 10;

const goodName = (c: TextCtx): string => c.data.commodities[c.target.good]?.name ?? c.target.good;
const systemName = (c: TextCtx): string => c.data.systems[c.target.system]?.name ?? c.target.system;
const portName = (c: TextCtx): string => c.data.planets[c.target.port]?.name ?? c.target.port;
const held = (s: GuideState, t: GuideTarget): number => s.world.cargo[t.good] ?? 0;
const touch = (c: TextCtx): boolean => c.mode === 'touch';
const buyPortName = (c: TextCtx): string => (c.buyPort ? (c.data.planets[c.buyPort]?.name ?? c.buyPort) : '');

/** Step 7's text; step 8 shows it again while no course leads to the target (spec 2.2). */
function plotText(c: TextCtx): string {
  if (c.screen === 'map') {
    return touch(c) ? `Tap ${systemName(c)}, then Set course.` : `Pick ${systemName(c)}, then Set course.`;
  }
  if (touch(c)) {
    return `Tap Map. Set course to ${systemName(c)}.`;
  }
  return `Open the Star Map (${c.key('map')}) and set a course to ${systemName(c)}. ${goodName(c)} pays well there.`;
}

/** Step 2's text: buy on the exchange, open it first, or go back to the buy port. */
function buyText(c: TextCtx): string {
  const good = goodName(c);
  const atBuyPort = !c.buyPort || c.landedPlanetId === c.buyPort;
  if (!atBuyPort) {
    return touch(c) ? `Buy ${good} at ${buyPortName(c)}.` : `Open the exchange and buy ${BUY_TONS} t of ${good} at ${buyPortName(c)}.`;
  }
  if (c.screen !== 'exchange') {
    return touch(c) ? `Exchange: buy ${BUY_TONS} t of ${good}.` : `Open the exchange (${c.key('openExchange')}) and buy ${BUY_TONS} t of ${good}.`;
  }
  return touch(c) ? `${good} is cheap here. Buy ${BUY_TONS} t.` : `${good} is cheap here. Buy ${BUY_TONS} t (${c.key('buyGoods')}).`;
}

/** The 11 First Flight steps (spec 2.2). Each completes by itself when the player does the thing. */
export const STEPS: readonly StepDef[] = [
  {
    id: 'open-exchange',
    text: (c) =>
      touch(c)
        ? 'Welcome! Tap Commodity Exchange.'
        : `Welcome to ${c.planetName ?? 'Starwake'}. Open the Commodity Exchange (${c.key('openExchange')}).`,
    done: (s) => s.screen === 'exchange',
  },
  {
    id: 'buy',
    text: buyText,
    done: (s, t) => held(s, t) >= BUY_TONS,
  },
  {
    id: 'open-missions',
    // Only the exchange is closed with Back; on the planet screen Esc is Leave.
    text: (c) =>
      c.screen === 'exchange'
        ? touch(c)
          ? 'Tap Done, then Mission Computer.'
          : `Close the exchange (${c.key('back')}) and open the Mission Computer (${c.key('openMissions')}).`
        : touch(c)
        ? 'Tap Mission Computer.'
        : `Open the Mission Computer (${c.key('openMissions')}).`,
    // Optional (spec 2.2): taking off, or a port with no Mission Computer, skips the job steps.
    done: (s, _t, _p, data) =>
      s.screen === 'missions' ||
      s.screen === 'flight' ||
      !(s.landedPlanetId && data.planets[s.landedPlanetId]?.services.includes('missions')),
  },
  {
    id: 'close-missions',
    text: (c) =>
      touch(c)
        ? 'Jobs pay on arrival. Take one, or tap Done.'
        : `Jobs pay when you land at their destination. Accept one if you like, then close (${c.key('back')}).`,
    done: (s) => s.screen !== 'missions',
  },
  {
    id: 'leave',
    text: (c) => (touch(c) ? 'Tap Leave to take off.' : `Leave the planet (${c.key('leave')}).`),
    done: (s) => s.screen === 'flight',
  },
  {
    id: 'fly',
    text: (c) =>
      touch(c)
        ? 'Push the stick to fly, STOP to brake.'
        : `Fly: ${c.key('thrust')} thrust, ${c.key('turnLeft')} ${c.key('turnRight')} turn, ${c.key('autoStop')} stop.`,
    done: (s) => s.screen === 'flight' && !!s.startPos && dist(s.startPos, s.world.ship.pos) >= FLY_DISTANCE,
  },
  {
    id: 'plot-course',
    text: plotText,
    // Already in the system counts: a course is moot once you are there.
    done: (s, t) =>
      s.world.route[s.world.route.length - 1] === t.system || (s.world.systemId === t.system && !s.world.jump),
  },
  {
    id: 'jump',
    // No course to the target (cleared, or plotted elsewhere): plot it again first.
    text: (c) =>
      !c.routeOk
        ? plotText(c)
        : touch(c)
        ? `To ${systemName(c)}: fly clear, tap Jump. Repeat.`
        : `Fly clear of the star (${c.key('autopilot')} autopilot) and Jump (${c.key('jump')}). Repeat until you arrive in ${systemName(c)}.`,
    done: (s, t) => s.world.systemId === t.system && !s.world.jump,
  },
  {
    id: 'land',
    text: (c) =>
      touch(c)
        ? `Tap TGT until ${portName(c)}, then LAND.`
        : `Land at ${portName(c)} (${c.key('nextTarget')} to target, ${c.key('land')} to land).`,
    done: (s, t) => s.landedPlanetId === t.port,
  },
  {
    id: 'sell',
    text: (c) =>
      touch(c)
        ? c.fallback
          ? `Exchange: ${goodName(c)} pays well.`
          : `Exchange: Sell all ${goodName(c)}.`
        : c.fallback
        ? `Open the exchange at ${portName(c)} and check the prices: ${goodName(c)} pays well here.`
        : `Open the exchange (${c.key('openExchange')}) and Sell all your ${goodName(c)}.`,
    // Without a purchase there is nothing to sell: opening the exchange here is the lesson.
    done: (s, t, p) => (p.fallback ? s.screen === 'exchange' && s.landedPlanetId === t.port : held(s, t) === 0),
  },
  {
    id: 'finish',
    text: (c) => {
      const log = touch(c) ? '' : ` (${c.key('missionLog')})`;
      const tips = `Tips: refuel before long trips, check the Mission Log${log}, and watch for market news.`;
      const lead =
        c.profit !== undefined && c.profit > 0
          ? `Nice trade! You made ${Math.round(c.profit).toLocaleString('en-US')} cr.`
          : "You're set up to trade.";
      return `${lead} ${tips}`;
    },
    // Ends only when the player dismisses it (Guide.skip()).
    done: () => false,
  },
];
