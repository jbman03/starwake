import { describe, expect, it } from 'vitest';
import { testData, withoutPorts } from '../data/testData';
import type { GameData } from '../data/schemas';
import {
  addHeat,
  bribeCost,
  commitCrime,
  decayHeat,
  fineFor,
  heatOf,
  landingRefused,
  legalStatus,
  payFines,
  tryBribe,
  type Crime,
} from './law';
import { mulberry32, hashString } from './random';
import { canLand, landingRefusedText, towBlockedByLaw, towDestination } from './rules';
import { standingMet, standingOf } from './standing';
import type { WorldState } from './types';
import { advanceDays, applyTow, newWorld, stepWorld } from './world';

const data = testData();
const base = newWorld(data, 1);
const withHeat = (law: Record<string, number>, p: Partial<WorldState> = {}): WorldState => ({
  ...base,
  ...p,
  law: Object.fromEntries(Object.entries(law).map(([g, heat]) => [g, { heat }])),
});

describe('heat and legal status', () => {
  it('reads absent heat as 0 (Clean)', () => {
    expect(heatOf(base, 'concord')).toBe(0);
    expect(legalStatus(base, data, 'concord')).toBe('clean');
  });
  it('status at heat 9, 10, 29, 30, 59, 60 and 100', () => {
    const at = (h: number) => legalStatus(withHeat({ concord: h }), data, 'concord');
    expect(at(9)).toBe('clean');
    expect(at(10)).toBe('suspect');
    expect(at(29)).toBe('suspect');
    expect(at(30)).toBe('wanted');
    expect(at(59)).toBe('wanted');
    expect(at(60)).toBe('hunted');
    expect(at(100)).toBe('hunted');
  });
});

describe('crimes', () => {
  it('each crime adds its data heat, capped at 100', () => {
    for (const crime of Object.keys(data.law.crimes) as Crime[]) {
      const w = commitCrime(base, data, 'concord', crime);
      expect(heatOf(w, 'concord')).toBe(data.law.crimes[crime]);
      expect(heatOf(w, 'free-reach')).toBe(0);
      const near = commitCrime(withHeat({ concord: 95 }), data, 'concord', crime);
      expect(heatOf(near, 'concord')).toBe(Math.min(100, 95 + data.law.crimes[crime]));
    }
    expect(heatOf(commitCrime(withHeat({ concord: 90 }), data, 'concord', 'destroy'), 'concord')).toBe(100);
  });
  it('addHeat clamps to 0-100', () => {
    expect(heatOf(addHeat(withHeat({ concord: 5 }), data, 'concord', -20), 'concord')).toBe(0);
    expect(heatOf(addHeat(base, data, 'concord', 250), 'concord')).toBe(100);
  });
  it('raiders heat stays 0', () => {
    const w = commitCrime(addHeat(base, data, 'raiders', 50), data, 'raiders', 'destroy');
    expect(heatOf(w, 'raiders')).toBe(0);
    expect(w).toBe(base);
  });
});

describe('decay', () => {
  it('one day of decay takes 2 heat off every government, never below 0', () => {
    const w = decayHeat(withHeat({ concord: 30, 'free-reach': 1, independent: 0 }), data, 1);
    expect(heatOf(w, 'concord')).toBe(28);
    expect(heatOf(w, 'free-reach')).toBe(0);
    expect(heatOf(w, 'independent')).toBe(0);
    expect(heatOf(decayHeat(withHeat({ concord: 30 }), data, 5), 'concord')).toBe(20);
  });
  it('advanceDays decays heat a day at a time', () => {
    const r = advanceDays(withHeat({ concord: 30, unlit: 3 }), data, 1);
    expect(heatOf(r.world, 'concord')).toBe(28);
    expect(heatOf(r.world, 'unlit')).toBe(1);
    expect(heatOf(advanceDays(withHeat({ concord: 30 }), data, 3).world, 'concord')).toBe(24);
  });
});

describe('fines', () => {
  it('fineFor is heat x fineRate, rounded', () => {
    expect(fineFor(withHeat({ concord: 25 }), data, 'concord')).toBe(25 * 40);
    expect(fineFor(withHeat({ concord: 12.4 }), data, 'concord')).toBe(Math.round(12.4 * 40));
  });
  it('payFines charges heat x 40 and zeroes heat', () => {
    const w = withHeat({ concord: 25, unlit: 40 }, { credits: 5000 });
    const r = payFines(w, data, 'concord');
    if (!('world' in r)) throw new Error('expected a world');
    expect(r.world.credits).toBe(5000 - 1000);
    expect(heatOf(r.world, 'concord')).toBe(0);
    expect(heatOf(r.world, 'unlit')).toBe(40);
  });
  it('refuses when short, with no change', () => {
    const w = withHeat({ concord: 25 }, { credits: 999 });
    expect(payFines(w, data, 'concord')).toEqual({ error: 'short' });
    expect(heatOf(w, 'concord')).toBe(25);
    expect(w.credits).toBe(999);
  });
  it('refuses with none when Clean', () => {
    expect(payFines(withHeat({ concord: 9 }, { credits: 5000 }), data, 'concord')).toEqual({ error: 'none' });
    expect(payFines(withHeat({}, { credits: 5000 }), data, 'concord')).toEqual({ error: 'none' });
  });
});

describe('bribes', () => {
  it('cost 1.5x the fine', () => {
    const w = withHeat({ concord: 35 });
    expect(bribeCost(w, data, 'concord')).toBe(Math.round(1.5 * fineFor(w, data, 'concord')));
    expect(bribeCost(w, data, 'concord')).toBe(2100);
  });
  it('refuse when short, with no change', () => {
    const w = withHeat({ concord: 35 }, { credits: 2099 });
    expect(tryBribe(w, data, 'concord', 'seed')).toEqual({ error: 'short' });
  });
  it('the seed fixes the outcome: success leaves heat and takes the cost, failure adds bribeFailHeat', () => {
    const w = withHeat({ concord: 35 }, { credits: 10000 });
    let oks = 0;
    let fails = 0;
    for (let i = 0; i < 40; i++) {
      const seed = `bribe-${i}`;
      const r = tryBribe(w, data, 'concord', seed);
      if ('error' in r) throw new Error('unexpected error');
      expect(r.ok).toBe(mulberry32(hashString(seed))() < data.law.bribeChance);
      expect(tryBribe(w, data, 'concord', seed)).toEqual(r); // same seed, same outcome
      if (r.ok) {
        oks++;
        expect(heatOf(r.world, 'concord')).toBe(35);
        expect(r.world.credits).toBe(10000 - 2100);
      } else {
        fails++;
        expect(heatOf(r.world, 'concord')).toBe(35 + data.law.bribeFailHeat);
        expect(r.world.credits).toBe(10000);
      }
    }
    expect(oks).toBeGreaterThan(0);
    expect(fails).toBeGreaterThan(0);
  });
  it('bribeChance 1 always works and 0 never does', () => {
    const w = withHeat({ concord: 35 }, { credits: 10000 });
    const sure: GameData = { ...data, law: { ...data.law, bribeChance: 1 } };
    const never: GameData = { ...data, law: { ...data.law, bribeChance: 0 } };
    for (let i = 0; i < 10; i++) {
      expect(tryBribe(w, sure, 'concord', `s${i}`)).toMatchObject({ ok: true });
      expect(tryBribe(w, never, 'concord', `s${i}`)).toMatchObject({ ok: false });
    }
  });
});

describe('landing refusal', () => {
  const hunted = withHeat({ concord: 60, independent: 59 });
  it('a Hunted port refuses landing, and other ports do not', () => {
    expect(landingRefused(hunted, data, 'halcyon')).toBe(true); // concord
    expect(landingRefused(hunted, data, 'tallow-rock')).toBe(false); // independent, only Wanted
    expect(landingRefused(hunted, data, 'brannock-deeps')).toBe(false); // free-reach, Clean
    expect(landingRefused(hunted, data, 'no-such-planet')).toBe(false);
    expect(landingRefused(base, data, 'halcyon')).toBe(false);
  });
  it('canLand is false at a refusing port, close and slow', () => {
    const h = data.planets.halcyon;
    const w = { ...hunted, systemId: 'calder', ship: { ...hunted.ship, pos: { ...h.pos }, vel: { x: 0, y: 0 } } };
    expect(canLand({ ...w, law: {} }, data, 'halcyon')).toBe(true);
    expect(canLand(w, data, 'halcyon')).toBe(false);
  });
  it('the refusal message names the government', () => {
    expect(landingRefusedText(data, 'halcyon')).toBe('Landing refused: you are hunted by the Concord.');
    expect(landingRefusedText(data, 'tallow-rock')).toBe('Landing refused: you are hunted by the Independent.');
  });

  const frame = (pressed: string[] = []) => ({ actions: new Set<never>(), pressed: new Set(pressed as never[]) });
  it('pressing land at a refusing port says so and neither lands nor autopilots there', () => {
    const h = data.planets.halcyon;
    const w = { ...hunted, systemId: 'calder', targetPlanetId: 'halcyon', ship: { ...hunted.ship, pos: { ...h.pos }, vel: { x: 0, y: 0 } } };
    const r = stepWorld(w, data, frame(['land']), 1 / 60, { autoLandOnArrival: true });
    expect(r.events).toEqual([{ type: 'message', text: 'Landing refused: you are hunted by the Concord.' }]);
    expect(r.world.assist.kind).toBe('none');
    // Far away, the same press refuses at once instead of flying there.
    const far = { ...w, ship: { ...w.ship, pos: { x: h.pos.x + 2000, y: h.pos.y } } };
    const f = stepWorld(far, data, frame(['land']), 1 / 60, { autoLandOnArrival: true });
    expect(f.events).toEqual([{ type: 'message', text: 'Landing refused: you are hunted by the Concord.' }]);
    expect(f.world.assist.kind).toBe('none');
  });
  it('a landing autopilot that arrives at a refusing port stops without landing', () => {
    const h = data.planets.halcyon;
    const w: WorldState = {
      ...hunted,
      systemId: 'calder',
      targetPlanetId: 'halcyon',
      assist: { kind: 'autopilot', dest: { type: 'planet', id: 'halcyon' }, autoLand: true },
      ship: { ...hunted.ship, pos: { ...h.pos }, vel: { x: 0, y: 0 } },
    };
    const r = stepWorld(w, data, frame(), 1 / 60, { autoLandOnArrival: true });
    expect(r.events).toEqual([{ type: 'message', text: 'Landing refused: you are hunted by the Concord.' }]);
    expect(r.world.assist.kind).toBe('none');
  });
});

describe('tow when hunted', () => {
  const noVesk = withoutPorts(data, 'vesk');
  const stranded = (law: Record<string, number>, systemId = 'vesk') => withHeat(law, { systemId, ship: { ...base.ship, pos: { x: 0, y: 0 }, fuel: 0 } });
  it('tow when hunted everywhere nearby picks the nearest non-hunting port, or returns null with a message', () => {
    // From vesk the lanes run calder (concord), mirren, lastlight: Hunted by the Concord, the tow skips calder.
    expect(towDestination(stranded({}), noVesk)).toBe('halcyon');
    expect(towDestination(stranded({ concord: 60 }), noVesk)).toBe('mirren-hollow');
    expect(towBlockedByLaw(stranded({ concord: 60 }), noVesk)).toBe(false);
    // Hunted by every government in reach: no tow, and the law is why.
    const everywhere = stranded({ concord: 100, 'free-reach': 100, independent: 100 });
    expect(towDestination(everywhere, noVesk)).toBeNull();
    expect(towDestination(everywhere, noVesk, { disabled: true })).toBeNull();
    expect(towBlockedByLaw(everywhere, noVesk)).toBe(true);
    expect(towBlockedByLaw(everywhere, noVesk, { disabled: true })).toBe(true);
    expect(applyTow(everywhere, noVesk).world).toBe(everywhere);
  });
  it('stranded beside refusing ports only: towed on to a port that will take the ship', () => {
    expect(towDestination(stranded({}, 'calder'), data)).toBeNull(); // fuel is sold here
    const id = towDestination(stranded({ concord: 60 }, 'calder'), data);
    expect(id).toBe('vesk-outpost'); // vesk, the first lane from calder; the port nearest its center
  });
  it('disabled beside a refusing port: the tow skips it', () => {
    const near = (law: Record<string, number>) => withHeat(law, { systemId: 'calder', ship: { ...base.ship, pos: { x: -800, y: 400 }, fuel: 300 } });
    expect(towDestination(near({}), data, { disabled: true })).toBe('merrow');
    expect(data.systems[data.planets[towDestination(near({ concord: 60 }), data, { disabled: true })!].systemId].government).not.toBe('concord');
  });
  it('not blocked when no tow is needed, or when only distance stops it', () => {
    expect(towBlockedByLaw(stranded({ concord: 100, 'free-reach': 100, independent: 100 }, 'calder'), data)).toBe(true);
    expect(towBlockedByLaw(withHeat({ concord: 100 }, { systemId: 'calder' }), data)).toBe(false); // fuelled, not disabled
    expect(towBlockedByLaw(stranded({}), noVesk)).toBe(false);
  });
});

describe('standing cap', () => {
  const friend = (heat: number) => withHeat({ concord: heat }, { standing: { concord: 'friend' } });
  it('standing is capped at cool while Wanted or Hunted', () => {
    expect(standingOf(friend(29), 'concord', data)).toBe('friend');
    expect(standingOf(friend(30), 'concord', data)).toBe('cool');
    expect(standingOf(friend(60), 'concord', data)).toBe('cool');
    expect(standingOf(withHeat({ concord: 30 }), 'concord', data)).toBe('cool'); // neutral too
    expect(standingOf(friend(30), 'free-reach', data)).toBe('neutral');
  });
  it('the stored standing is untouched, and returns once heat falls', () => {
    const w = friend(30);
    expect(w.standing.concord).toBe('friend');
    expect(standingOf(decayHeat(w, data, 1), 'concord', data)).toBe('friend');
  });
  it('standingMet sees the cap', () => {
    expect(standingMet(friend(0), { government: 'concord', level: 'friend' }, data)).toBe(true);
    expect(standingMet(friend(30), { government: 'concord', level: 'friend' }, data)).toBe(false);
  });
});
