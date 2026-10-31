// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { testData } from '../data/testData';
import { pilotFromWorld } from '../save/pilot';
import { formatDate } from '../sim/calendar';
import { visibleSystemCount } from '../sim/galaxy';
import { netWorth, tradeInValue } from '../sim/shipyard';
import { newWorld } from '../sim/world';
import { pilotCard } from './mainMenu';

const data = testData();
const save = (over: Record<string, unknown> = {}) => ({
  ...pilotFromWorld({ ...newWorld(data, 5), credits: 1234, day: 9 }, data.config.startPlanetId, { id: 'a', name: 'Ann' }),
  ...over,
});

describe('pilotCard', () => {
  it('shows combat rating', () => {
    expect(pilotCard(save(), data).rating).toBe('Harmless');
    expect(pilotCard(save({ stats: { jobsDone: 0, kills: 4, captures: 3 } }), data).rating).toBe('Steady');
  });

  it('formats each line', () => {
    const w = newWorld(data, 5);
    const hull = data.ships[w.shipId].name;
    const s = save({ shipName: 'Dawn Kettle', stats: { jobsDone: 3, kills: 0, captures: 0 } });
    const c = pilotCard(s, data);
    expect(c.name).toBe('Ann');
    expect(c.shipLine).toBe(`Dawn Kettle — ${hull}`);
    expect(c.credits).toBe('1,234 cr');
    expect(c.netWorth).toBe(`${(1234 + tradeInValue(w, data)).toLocaleString('en-US')} cr`);
    expect(netWorth(s, data)).toBe(1234 + tradeInValue(w, data));
    expect(c.date).toBe(formatDate(9, data.config));
    expect(c.explored).toBe(`${s.known.length}/${visibleSystemCount(data, [])} systems`);
    expect(c.jobs).toBe('3 jobs');
  });

  it('a save with a hull this version lacks still gets a card; net worth is its credits', () => {
    const c = pilotCard(save({ shipId: 'gone-hull', shipName: '' }), data);
    expect(c.netWorth).toBe('1,234 cr');
  });

  it('an empty ship name shows the hull name', () => {
    const hull = data.ships[newWorld(data, 5).shipId].name;
    expect(pilotCard(save({ shipName: '' }), data).shipLine).toBe(`${hull} — ${hull}`);
  });

  it('hidden systems are excluded from the total until the lane flag is set', () => {
    const closed = pilotCard(save(), data).explored.split('/')[1];
    expect(closed).toBe(`${visibleSystemCount(data, [])} systems`);
    const open = pilotCard(save({ flags: ['hushwater-lane'] }), data).explored.split('/')[1];
    expect(open).toBe(`${visibleSystemCount(data, ['hushwater-lane'])} systems`);
    expect(visibleSystemCount(data, ['hushwater-lane'])).toBeGreaterThan(visibleSystemCount(data, []));
  });

  it('a hidden system in known is not counted before the flag', () => {
    const s = save({ known: [...save().known, 'hushwater'] });
    expect(pilotCard(s, data).explored).toBe(pilotCard(save(), data).explored);
  });

  it('a ship name over 24 characters is trimmed', () => {
    expect(pilotCard(save({ shipName: 'x'.repeat(40) }), data).shipLine.startsWith(`${'x'.repeat(24)} — `)).toBe(true);
  });
});

describe('pilotCard standing', () => {
  it('lists the non-neutral governments in data order', () => {
    const c = pilotCard(save({ standing: { 'free-reach': 'cool', concord: 'friend' } }), data);
    expect(c.standing).toBe('Concord: friend · Free Reach: cool');
  });

  it('omits neutral governments; all neutral reads "Standing: neutral everywhere"', () => {
    expect(pilotCard(save({ standing: { concord: 'neutral', unlit: 'cool' } }), data).standing).toBe('Unlit: cool');
    expect(pilotCard(save({ standing: { concord: 'neutral' } }), data).standing).toBe('Standing: neutral everywhere');
    expect(pilotCard(save(), data).standing).toBe('Standing: neutral everywhere');
  });

  it('shows the standing capped at cool while Wanted or Hunted', () => {
    expect(pilotCard(save({ standing: { concord: 'friend' }, law: { concord: { heat: 30 } } }), data).standing).toBe('Concord: cool');
    expect(pilotCard(save({ standing: { concord: 'friend' }, law: { concord: { heat: 29 } } }), data).standing).toBe('Concord: friend');
  });

  it('ignores a government this version lacks', () => {
    expect(pilotCard(save({ standing: { nowhere: 'friend' } }), data).standing).toBe('Standing: neutral everywhere');
  });
});
