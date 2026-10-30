import { describe, it, expect } from 'vitest';
import { testData } from './testData';
import { newWorld } from '../sim/world';
import { bestLoopPerJump, jobsToAfford, maxMissionPerJump, medianMissionPay, medianMissionPerJump, SAMPLE_DAYS, tradeProfit } from '../sim/balance';
import { pickTarget } from '../guide/target';
import { BUY_TONS } from '../guide/steps';
import { hopDistance } from '../sim/galaxy';
import { stepSystem } from '../sim/storyMissions';
import { offersAt } from '../sim/missions';
import type { Outcome, StoryMissionDef } from './schemas';
import ships from '../../data/ships.json';

type S = (typeof ships)[number];
const by = (role: string) => ships.find((s) => s.role === role) as S;
const others = (role: string) => ships.filter((s) => s.role !== role);

describe('ship balance', () => {
  it('hold sizes are all distinct', () => {
    expect(new Set(ships.map((s) => s.cargo)).size).toBe(ships.length);
  });
  it('heavy freighter has the largest hold', () => {
    for (const s of others('heavyFreighter')) expect(by('heavyFreighter').cargo).toBeGreaterThan(s.cargo);
  });
  it('liner has the most berths', () => {
    for (const s of others('liner')) expect(by('liner').passengers).toBeGreaterThan(s.passengers);
  });
  it('scout has the largest fuel capacity', () => {
    for (const s of others('scout')) expect(by('scout').fuelCapacity).toBeGreaterThan(s.fuelCapacity);
  });
  it('interceptor is fastest and most agile', () => {
    for (const s of others('interceptor')) {
      expect(by('interceptor').maxSpeed).toBeGreaterThan(s.maxSpeed);
      expect(by('interceptor').turnRate).toBeGreaterThan(s.turnRate);
    }
  });
  it('carrier has the most shields, armor and outfit space', () => {
    for (const s of others('carrier')) {
      expect(by('carrier').shields).toBeGreaterThan(s.shields);
      expect(by('carrier').armor).toBeGreaterThan(s.armor);
      expect(by('carrier').outfitSpace).toBeGreaterThan(s.outfitSpace);
    }
  });
  it('starter has the lowest price', () => {
    for (const s of others('starter')) expect(by('starter').price).toBeLessThan(s.price);
  });
});

describe('earning curve (spec section 7)', () => {
  const data = testData();
  const world = newWorld(data, 1);
  const loop = bestLoopPerJump(world, data, data.config.startShipId);
  const mission = medianMissionPerJump(world, data, SAMPLE_DAYS);
  const jobs = jobsToAfford(world, data, data.ships.courier.price);

  it('best shuttle loop earns at least 40% of the median mission per jump', () => {
    expect(loop, `loop ${loop.toFixed(0)}/jump, median mission ${mission.toFixed(0)}/jump, ratio ${(loop / mission).toFixed(2)}`).toBeGreaterThanOrEqual(0.4 * mission);
  });
  it('no offer the shuttle can carry out-earns the best loop per jump', () => {
    const top = maxMissionPerJump(world, data, SAMPLE_DAYS);
    expect(top, `richest offer ${top.toFixed(0)}/jump, best loop ${loop.toFixed(0)}/jump`).toBeLessThanOrEqual(loop);
  });
  it('the courier is affordable after 8 to 14 median jobs', () => {
    expect(jobs, `${jobs} jobs (median pay ${medianMissionPay(world, data, SAMPLE_DAYS)})`).toBeGreaterThanOrEqual(8);
    expect(jobs).toBeLessThanOrEqual(14);
  });
  it('the guide trade makes at least 300 cr on the guide amount', () => {
    const start = data.config.startPlanetId;
    const t = pickTarget(world, data, start)!;
    expect(t).not.toBeNull();
    const profit = tradeProfit(world, data, start, t.port, t.good, BUY_TONS);
    expect(profit, `${t.good} x${BUY_TONS} ${start} -> ${t.port}`).toBeGreaterThanOrEqual(300);
  });
  it('profit follows the real market: a port that stops being Low or High loses the trade', () => {
    const start = data.config.startPlanetId;
    const t = pickTarget(world, data, start)!;
    const flat = { ...data, planets: { ...data.planets, [t.port]: { ...data.planets[t.port], market: { ...data.planets[t.port].market, [t.good]: 'low' as const } } } };
    expect(tradeProfit(world, flat, start, t.port, t.good, BUY_TONS)).toBeLessThan(300);
  });
  it('Stillwater Pearl sells high at one or two known core ports', () => {
    const buyers = Object.values(data.planets).filter((p) => p.market?.['stillwater-pearl'] === 'high');
    expect(buyers.length).toBeGreaterThanOrEqual(1);
    expect(buyers.length).toBeLessThanOrEqual(2);
    for (const p of buyers) expect(data.config.knownAtStart).toContain(p.systemId);
  });
});

describe('story hulls', () => {
  it('Freewind has the most fuel jumps of any hull', () => {
    const jumps = (s: S) => Math.floor(s.fuelCapacity / 100);
    const freewind = ships.find((s) => s.id === 'freewind') as S;
    expect(freewind).toBeDefined();
    for (const s of ships.filter((x) => x.id !== 'freewind')) expect(jumps(freewind)).toBeGreaterThan(jumps(s));
  });
});

describe('story pay', () => {
  const data = testData();
  const world = newWorld(data, 1);
  const missions = Object.values(data.story);
  const credits = (os: Outcome[]) => os.reduce((n, o) => n + (o.type === 'credits' ? o.n : 0), 0);
  /** Credits a mission can pay, net: its completion plus the best credit outcome of each card it plays (a spent advance counts against it). */
  const pay = (d: StoryMissionDef) =>
    credits(d.onComplete) +
    d.steps.reduce((n, s) => n + (s.kind === 'meet' ? Math.max(0, ...s.card.choices.map((c) => credits(c.outcomes))) : 0), 0);
  const MAIN = missions.filter((d) => d.arc === 'main');
  const arcOf = (side: 'concord' | 'reach') => missions.filter((d) => d.arc === side);

  it('M1 through either arc end pays 70,000 to 110,000 cr in all', () => {
    for (const side of ['concord', 'reach'] as const) {
      expect(arcOf(side)).toHaveLength(7);
      const total = [...MAIN, ...arcOf(side)].reduce((n, d) => n + pay(d), 0);
      expect(total, `${side}: ${total} cr`).toBeGreaterThanOrEqual(70000);
      expect(total).toBeLessThanOrEqual(110000);
    }
  });

  it('no story mission pays more than 12,000 cr', () => {
    for (const d of missions) expect(pay(d), d.id).toBeLessThanOrEqual(12000);
  });

  it('every story mission pays within 2x the best trade loop per jump', () => {
    const loop = bestLoopPerJump(world, data, data.config.startShipId);
    const flags = ['dimming-lane', 'hushwater-lane']; // every lane open
    const over: string[] = [];
    const left = new Map<string, string>(); // where the last mission of each arc or chain left the pilot
    for (const d of missions) {
      const group = d.arc === 'side' ? `side:${d.chain}` : d.arc;
      let at = left.get(group) ?? data.planets[d.offer.ports?.[0] ?? '']?.systemId ?? d.offer.systems?.[0] ?? '';
      let jumps = 0;
      for (const s of d.steps) {
        const to = stepSystem(s, data) ?? at;
        jumps += hopDistance(data, at, to, flags);
        at = to;
      }
      left.set(group, at);
      expect(Number.isFinite(jumps), `${d.id} is reachable`).toBe(true);
      jumps = Math.max(1, jumps);
      if (pay(d) / jumps > 2 * loop) over.push(`${d.id}: ${pay(d)} cr over ${jumps} jumps = ${(pay(d) / jumps).toFixed(0)}/jump`);
    }
    expect(over, `best loop ${loop.toFixed(0)}/jump, limit ${(2 * loop).toFixed(0)}/jump`).toEqual([]);
  });

  it('each arc finale pays at least as much as any earlier mission in its arc', () => {
    for (const side of ['concord', 'reach'] as const) {
      const arc = arcOf(side);
      const finale = arc[arc.length - 1];
      for (const d of arc) expect(pay(finale), `${finale.id} vs ${d.id}`).toBeGreaterThanOrEqual(pay(d));
    }
  });
});

describe('combat job pay', () => {
  const data = testData();
  const ports = Object.values(data.planets).filter((p) => p.services.includes('missions'));
  const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
  const pays = (typeId: string): number[] => {
    const out: number[] = [];
    for (let day = 0; day < 60; day++) {
      const w = { ...newWorld(data, 1), day };
      for (const p of ports) for (const o of offersAt(w, data, p.id)) if (o.typeId === typeId) out.push(o.pay);
    }
    return out;
  };
  const rush = median(pays('rush'));
  const shipment = median(pays('shipment'));

  it('bounty pays between rush and shipment medians', () => {
    const b = median(pays('bounty'));
    expect(b, `rush ${rush}, bounty ${b}, shipment ${shipment}`).toBeGreaterThan(rush);
    expect(b).toBeLessThan(shipment);
  });
  it('clear pays above the shipment median', () => {
    const c = median(pays('clear'));
    expect(c, `clear ${c}, shipment ${shipment}`).toBeGreaterThan(shipment);
  });
});
