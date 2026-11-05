import { describe, expect, it } from 'vitest';
import { testData } from '../data/testData';
import { defeatNemesis, NEMESIS_ID, nemesisDue, nemesisNpc, nemesisPresent, nemesisWins, spawnNemesis } from './nemesis';
import type { Traffic } from './traffic';
import type { WorldState } from './types';
import { newWorld } from './world';

const data = testData();
const cfg = data.fleet.nemesis;
const veteran = (over: Partial<WorldState> = {}): WorldState => {
  const w = newWorld(data, 21);
  return { ...w, systemId: 'tessaly', stats: { ...w.stats, kills: cfg.requiresKills }, ...over };
};
const empty = (w: WorldState): Traffic => ({ systemId: w.systemId, npcs: [], spawnCount: 0, nextSpawnSec: 0, targetId: null });
const opts = { guideActive: false, calm: false };

/** A day on which the seeded roll says yes in this system. */
function dueDay(w: WorldState): number {
  for (let d = 0; d < 500; d++) if (nemesisDue({ ...w, day: d }, data, opts)) return d;
  throw new Error('no due day');
}

describe('when the rival appears', () => {
  it('only with the kills, away from the start system, not between duels, not with the guide or calm', () => {
    const w = veteran();
    const day = dueDay(w);
    expect(nemesisDue({ ...w, day }, data, opts)).toBe(true);
    expect(nemesisDue({ ...w, day, stats: { ...w.stats, kills: cfg.requiresKills - 1 } }, data, opts)).toBe(false);
    expect(nemesisDue({ ...w, day, systemId: data.config.startSystemId }, data, opts)).toBe(false);
    expect(nemesisDue({ ...w, day, nemesis: { defeats: 0, nextDay: day + 1, done: false } }, data, opts)).toBe(false);
    expect(nemesisDue({ ...w, day, nemesis: { defeats: 0, nextDay: 0, done: true } }, data, opts)).toBe(false);
    expect(nemesisDue({ ...w, day }, data, { guideActive: true, calm: false })).toBe(false);
    expect(nemesisDue({ ...w, day }, data, { guideActive: false, calm: true })).toBe(false);
  });

  it('comes in roughly `chance` of arrivals', () => {
    const w = veteran();
    let n = 0;
    for (let d = 0; d < 2000; d++) if (nemesisDue({ ...w, day: d }, data, opts)) n++;
    expect(n / 2000).toBeGreaterThan(cfg.chance - 0.05);
    expect(n / 2000).toBeLessThan(cfg.chance + 0.05);
  });

  it('flies the hull for his level, hostile, at spawnDistance, and hails', () => {
    const w = veteran({ nemesis: { defeats: 1, nextDay: 0, done: false } });
    const r = spawnNemesis(w, data, empty(w), { x: 0, y: 0 });
    const n = r.traffic.npcs.find((x) => x.id === NEMESIS_ID)!;
    expect(n).toMatchObject({ shipId: cfg.levels[1].shipId, role: 'raider', government: 'raiders', nemesis: true, demand: false, peaceful: false });
    expect(Math.hypot(n.ship.pos.x, n.ship.pos.y)).toBeCloseTo(cfg.spawnDistance);
    expect(r.line.startsWith(`${cfg.name}: `)).toBe(true);
    expect(nemesisPresent(r.traffic)).toBe(true);
    const lv = nemesisNpc(veteran({ nemesis: { defeats: 2, nextDay: 0, done: false } }), data, { x: 0, y: 0 }, 0);
    for (const [id, k] of Object.entries(cfg.levels[2].outfits)) expect(lv.outfits[id]).toBeGreaterThanOrEqual(k);
  });
});

describe('duels', () => {
  it('a defeat pays the level reward, counts, and keeps him away for cooldownDays', () => {
    const w = veteran({ day: 7, credits: 100 });
    const t = spawnNemesis(w, data, empty(w), { x: 0, y: 0 }).traffic;
    const r = defeatNemesis(w, data, { ...t, targetId: NEMESIS_ID }, true);
    expect(r.world.credits).toBe(100 + cfg.levels[0].reward);
    expect(r.world.nemesis).toEqual({ defeats: 1, nextDay: 7 + cfg.cooldownDays, done: false });
    expect(r.traffic.npcs).toEqual([]);
    expect(r.traffic.targetId).toBeNull();
    expect(r.messages[0].startsWith(`${cfg.name}: `)).toBe(true);
  });

  it('the last duel is final: bonus, flag, log note, done', () => {
    const last = cfg.levels.length - 1;
    const w = veteran({ credits: 0, nemesis: { defeats: last, nextDay: 0, done: false } });
    const r = defeatNemesis(w, data, empty(w), true);
    expect(r.world.nemesis.done).toBe(true);
    expect(r.world.credits).toBe(cfg.levels[last].reward + cfg.finalReward);
    expect(r.world.flags).toContain(cfg.finalFlag);
    expect(r.world.notes[0].text).toContain(cfg.name);
    expect(r.messages[0]).toBe(cfg.lines.final);
  });

  it('disabled by someone else, he just leaves: no reward, no defeat', () => {
    const w = veteran({ day: 3, credits: 0 });
    const r = defeatNemesis(w, data, empty(w), false);
    expect(r.world.credits).toBe(0);
    expect(r.world.nemesis).toEqual({ defeats: 0, nextDay: 3 + cfg.cooldownDays, done: false });
  });

  it('when he wins, he gloats and stays away', () => {
    const r = nemesisWins(veteran({ day: 5 }), data);
    expect(r.world.nemesis.nextDay).toBe(5 + cfg.cooldownDays);
    expect(r.message).toBe(cfg.lines.gloat);
  });
});
