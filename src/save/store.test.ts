import 'fake-indexeddb/auto';
import { createStore, get, set } from 'idb-keyval';
import { describe, expect, it } from 'vitest';
import type { PilotSave } from './pilot';
import { PILOT_DB, PILOT_OBJECT_STORE, PilotStore } from './store';

let n = 0;
const mkStore = () => createStore(`db-${n++}`, 'kv');
const mk = (over: Partial<PilotSave> = {}): PilotSave => ({
  version: 2, id: 'p1', name: 'Ann', credits: 100, shipId: 's', fuel: 5, systemId: 'x',
  planetId: 'y', gameTimeSec: 1, savedAt: '2026-01-01T00:00:00.000Z',
  day: 0, seed: 1, cargo: {}, missions: [], route: [], known: ['x'], seen: [], pressure: {}, events: [], takenOffers: [], ...over,
});

describe('PilotStore', () => {
  it('round-trips and lists', async () => {
    const s = new PilotStore(mkStore());
    await s.save(mk());
    const r = await s.load('p1');
    expect(r.usedBackup).toBe(false);
    expect(r.pilot.credits).toBe(100);
    expect(await s.list()).toEqual([{ id: 'p1', name: 'Ann', savedAt: '2026-01-01T00:00:00.000Z' }]);
  });

  it('second save keeps first as backup, used on corrupt current', async () => {
    const store = mkStore();
    const s = new PilotStore(store);
    await s.save(mk({ credits: 1 }));
    await s.save(mk({ credits: 2 }));
    expect((await s.load('p1')).pilot.credits).toBe(2);
    await set('pilot:p1', { current: { junk: true }, backup: mk({ credits: 1 }) }, store);
    const r = await s.load('p1');
    expect(r.usedBackup).toBe(true);
    expect(r.pilot.credits).toBe(1);
  });

  it('throws when both fail or missing', async () => {
    const store = mkStore();
    const s = new PilotStore(store);
    await set('pilot:p1', { current: {}, backup: { version: 99 } }, store);
    await expect(s.load('p1')).rejects.toThrow();
    await expect(s.load('zzz')).rejects.toThrow();
  });

  it('rename and remove', async () => {
    const s = new PilotStore(mkStore());
    await s.save(mk());
    await s.save(mk({ credits: 3 }));
    await s.rename('p1', 'Bob');
    const r = await s.load('p1');
    expect(r.pilot.name).toBe('Bob');
    await s.remove('p1');
    expect(await s.list()).toEqual([]);
  });

  it('list skips unreadable entries', async () => {
    const store = mkStore();
    const s = new PilotStore(store);
    await s.save(mk());
    await set('pilot:bad', { current: 1 }, store);
    await set('other', 1, store);
    expect((await s.list()).map((x) => x.id)).toEqual(['p1']);
  });

  it('round-trips a pilot in debt (negative credits)', async () => {
    const s = new PilotStore(mkStore());
    await s.save(mk({ credits: -350 }));
    const r = await s.load('p1');
    expect(r.usedBackup).toBe(false);
    expect(r.pilot.credits).toBe(-350);
  });

  it('rejects an invalid pilot before writing, leaving the store untouched', async () => {
    const store = mkStore();
    const s = new PilotStore(store);
    await s.save(mk({ credits: 5 }));
    await expect(s.save(mk({ credits: Number.NaN }))).rejects.toMatchObject({ code: 'invalid' });
    await expect(s.save({ ...mk(), shipId: '' })).rejects.toMatchObject({ code: 'invalid' });
    const r = await s.load('p1');
    expect(r).toEqual({ pilot: mk({ credits: 5 }), usedBackup: false });
    expect(await get('pilot:p1', store)).toEqual({ current: mk({ credits: 5 }) });
  });

  it('defaults to its own starwake/pilots database, not the shared keyval-store', async () => {
    expect([PILOT_DB, PILOT_OBJECT_STORE]).toEqual(['starwake', 'pilots']);
    const s = new PilotStore();
    await s.save(mk({ id: 'dflt' }));
    const raw = await get('pilot:dflt', createStore('starwake', 'pilots'));
    expect(raw?.current?.id).toBe('dflt');
    expect(await get('pilot:dflt')).toBeUndefined();
    await s.remove('dflt');
  });
});
