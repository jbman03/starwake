import { describe, expect, it } from 'vitest';
import { testData } from '../data/testData';
import { answerLaw, confiscate, illegalHeld, lawBribeCost, scanCatches } from './contraband';
import { heatOf } from './law';
import type { WorldState } from './types';
import { newWorld } from './world';

const data = testData();
const base = newWorld(data, 1);
const w = (p: Partial<WorldState>): WorldState => ({ ...base, ...p });

describe('illegal cargo', () => {
  it('lists only the goods the government outlaws', () => {
    const world = w({ cargo: { stims: 4, relics: 2, food: 10 } });
    expect(illegalHeld(world, data, 'concord')).toEqual({ stims: 4, relics: 2 });
    expect(illegalHeld(world, data, 'free-reach')).toEqual({ stims: 4 });
    expect(illegalHeld(world, data, 'unlit')).toEqual({ relics: 2 });
    expect(illegalHeld(w({ cargo: { food: 10 } }), data, 'concord')).toEqual({});
  });
});

describe('scans', () => {
  const rate = (world: WorldState) => {
    let caught = 0;
    for (let i = 0; i < 2000; i++) if (scanCatches(world, data, 'concord', `scan-${i}`)) caught++;
    return caught / 2000;
  };
  it('catch about 0.8 of the time without a scrambler and about 0.4 with one', () => {
    const hold = { stims: 5 };
    expect(rate(w({ cargo: hold }))).toBeCloseTo(0.8, 1);
    expect(rate(w({ cargo: hold, outfits: { ...base.outfits, scrambler: 1 } }))).toBeCloseTo(0.4, 1);
  });
  it('are fixed by the seed, and never catch a legal hold', () => {
    const world = w({ cargo: { stims: 5 } });
    expect(scanCatches(world, data, 'concord', 'x')).toBe(scanCatches(world, data, 'concord', 'x'));
    expect(rate(w({ cargo: { food: 5 } }))).toBe(0);
  });
});

describe('confiscation', () => {
  it('removes only the outlawed goods and charges 100 cr/t, plus contraband heat', () => {
    const r = confiscate(w({ credits: 5000, cargo: { stims: 4, food: 10, relics: 1 } }), data, 'free-reach');
    expect(r.tons).toBe(4);
    expect(r.fine).toBe(400);
    expect(r.world.cargo).toEqual({ food: 10, relics: 1 });
    expect(r.world.credits).toBe(4600);
    expect(heatOf(r.world, 'free-reach')).toBe(15);
  });
  it('takes what the credits cover; the shortfall goes on the record at fineRate', () => {
    const r = confiscate(w({ credits: 100, cargo: { stims: 5 } }), data, 'concord');
    expect(r.fine).toBe(500);
    expect(r.paid).toBe(100);
    expect(r.world.credits).toBe(0);
    expect(heatOf(r.world, 'concord')).toBe(15 + 10); // 400 cr short at 40 cr per point
  });
});

describe('answering a law hail', () => {
  it('scan Comply: cargo gone, fine paid, heat +15, the patrol stays', () => {
    const r = answerLaw(w({ credits: 2000, cargo: { stims: 3 } }), data, { gov: 'concord', reason: 'scan', npcName: 'Grey Lance' }, 'comply', 's')!;
    expect(r.world.cargo).toEqual({});
    expect(r.world.credits).toBe(1700);
    expect(heatOf(r.world, 'concord')).toBe(15);
    expect(r.patrol).toBe('stays');
  });
  it('scan Run: heat +20, the government turns on the pilot', () => {
    const r = answerLaw(w({ cargo: { stims: 3 } }), data, { gov: 'concord', reason: 'scan', npcName: 'Grey Lance' }, 'refuse', 's')!;
    expect(heatOf(r.world, 'concord')).toBe(20);
    expect(r.world.cargo).toEqual({ stims: 3 });
    expect(r.patrol).toBe('angry');
  });
  it('a scan bribe costs bribeMul x contrabandFine x tons (Ruling 4); success keeps heat, failure costs nothing but heat', () => {
    const world = w({ credits: 5000, cargo: { stims: 2 } });
    expect(lawBribeCost(world, data, 'concord', 'scan')).toBe(300);
    let ok: ReturnType<typeof answerLaw> = null;
    let bad: ReturnType<typeof answerLaw> = null;
    for (let i = 0; (!ok || !bad) && i < 50; i++) {
      const r = answerLaw(world, data, { gov: 'concord', reason: 'scan', npcName: 'G' }, 'bribe', `b${i}`)!;
      if (r.patrol === 'leaves') ok ??= r;
      else bad ??= r;
    }
    expect(ok!.world.credits).toBe(4700);
    expect(heatOf(ok!.world, 'concord')).toBe(0);
    expect(ok!.world.cargo).toEqual({ stims: 2 });
    expect(bad!.patrol).toBe('attacks');
    expect(bad!.world.credits).toBe(5000);
    expect(heatOf(bad!.world, 'concord')).toBe(data.law.bribeFailHeat);
  });
  it('a bribe the credits do not cover is refused', () => {
    const r = answerLaw(w({ credits: 10, cargo: { stims: 2 } }), data, { gov: 'concord', reason: 'scan', npcName: 'G' }, 'bribe', 'b');
    expect(r).toBeNull();
  });
  it('fine Pay clears the record; short of credits it is refused', () => {
    const law = { concord: { heat: 20 } };
    const r = answerLaw(w({ credits: 2000, law }), data, { gov: 'concord', reason: 'fine', npcName: 'G' }, 'comply', 's')!;
    expect(r.world.credits).toBe(1200);
    expect(heatOf(r.world, 'concord')).toBe(0);
    expect(r.patrol).toBe('stays');
    expect(answerLaw(w({ credits: 100, law }), data, { gov: 'concord', reason: 'fine', npcName: 'G' }, 'comply', 's')).toBeNull();
  });
  it('fine Refuse: +5 heat and peace while Suspect; Run while Wanted', () => {
    const suspect = answerLaw(w({ law: { concord: { heat: 12 } } }), data, { gov: 'concord', reason: 'fine', npcName: 'G' }, 'refuse', 's')!;
    expect(heatOf(suspect.world, 'concord')).toBe(17);
    expect(suspect.patrol).toBe('stays');
    const wanted = answerLaw(w({ law: { concord: { heat: 35 } } }), data, { gov: 'concord', reason: 'fine', npcName: 'G' }, 'refuse', 's')!;
    expect(heatOf(wanted.world, 'concord')).toBe(55);
    expect(wanted.patrol).toBe('angry');
  });
});
