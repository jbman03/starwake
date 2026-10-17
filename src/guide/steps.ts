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
}

export interface StepDef {
  id: string;
  text(ctx: TextCtx): string;
  done(s: GuideState, t: GuideTarget, p: Progress): boolean;
}

export const FLY_DISTANCE = 300;
export const BUY_TONS = 10;

const goodName = (c: TextCtx): string => c.data.commodities[c.target.good]?.name ?? c.target.good;
const systemName = (c: TextCtx): string => c.data.systems[c.target.system]?.name ?? c.target.system;
const portName = (c: TextCtx): string => c.data.planets[c.target.port]?.name ?? c.target.port;
const held = (s: GuideState, t: GuideTarget): number => s.world.cargo[t.good] ?? 0;
const touch = (c: TextCtx): boolean => c.mode === 'touch';

/** The 11 First Flight steps (spec 2.2). Each completes by itself when the player does the thing. */
export const STEPS: readonly StepDef[] = [
  {
    id: 'open-exchange',
    text: (c) =>
      `Welcome to ${c.planetName ?? 'Starwake'}. Open the Commodity Exchange${touch(c) ? '.' : ` (${c.key('openExchange')}).`}`,
    done: (s) => s.screen === 'exchange',
  },
  {
    id: 'buy',
    text: (c) =>
      touch(c)
        ? `${goodName(c)} is Low here. Tap Buy to load ${BUY_TONS} t.`
        : `${goodName(c)} is Low here. Buy ${BUY_TONS} t (${c.key('buyGoods')}).`,
    done: (s, t) => held(s, t) >= BUY_TONS,
  },
  {
    id: 'open-missions',
    text: (c) =>
      touch(c)
        ? 'Close the exchange and open the Mission Computer.'
        : `Close the exchange (${c.key('back')}) and open the Mission Computer (${c.key('openMissions')}).`,
    done: (s) => s.screen === 'missions',
  },
  {
    id: 'close-missions',
    text: (c) =>
      `Jobs pay when you land at their destination. Accept one if you like, then close${touch(c) ? '.' : ` (${c.key('back')}).`}`,
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
    text: (c) =>
      `${
        touch(c) ? 'Tap the radar or PLOT COURSE' : `Open the Star Map (${c.key('map')})`
      } and set a course to ${systemName(c)} — ${goodName(c)} sells High there.`,
    // Already in the system counts: a course is moot once you are there.
    done: (s, t) =>
      s.world.route[s.world.route.length - 1] === t.system || (s.world.systemId === t.system && !s.world.jump),
  },
  {
    id: 'jump',
    text: (c) =>
      touch(c)
        ? `Fly clear of the star, then use the bottom button to Jump. Repeat until you arrive in ${systemName(c)}.`
        : `Fly clear of the star (${c.key('autopilot')} autopilot) and Jump (${c.key('jump')}). Repeat until you arrive in ${systemName(c)}.`,
    done: (s, t) => s.world.systemId === t.system && !s.world.jump,
  },
  {
    id: 'land',
    text: (c) =>
      touch(c)
        ? `Tap ${portName(c)} to land.`
        : `Land at ${portName(c)} (${c.key('nextTarget')} to target, ${c.key('land')} to land).`,
    done: (s, t) => s.landedPlanetId === t.port,
  },
  {
    id: 'sell',
    text: (c) =>
      c.fallback
        ? `Open the exchange at ${portName(c)} and check the prices: ${goodName(c)} sells High here.`
        : touch(c)
        ? `Open the exchange and Sell all your ${goodName(c)}.`
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
