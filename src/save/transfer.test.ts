import { describe, expect, it } from 'vitest';
import { testData } from '../data/testData';
import type { PilotSave } from './pilot';
import { exportFileName, exportPilot, importPilot } from './transfer';

const data = testData();
const p: PilotSave = {
  version: 7, id: 'p1', name: 'A/B:c', credits: 100, shipId: 'shuttle', fuel: 5, systemId: 'calder',
  planetId: 'halcyon', gameTimeSec: 1, savedAt: '2026-01-01T00:00:00.000Z',
  day: 0, seed: 1, cargo: {}, missions: [], route: [], known: ['calder'], seen: [], pressure: {}, events: [], takenOffers: [], outfits: {}, flags: [], notes: [], shipName: 'Shuttle', stats: { jobsDone: 0, kills: 0, captures: 0 }, lastEncounterDay: null, story: { active: [], done: [], failed: [], declined: [] }, standing: {}, law: {}, ranks: {},
};

describe('transfer', () => {
  it('export -> import keeps fields, new id', async () => {
    const blob = exportPilot(p);
    expect(blob.type).toBe('application/json');
    const q = importPilot(await blob.text(), data);
    expect(q).toEqual({ ...p, id: q.id });
    expect(q.id).not.toBe('p1');
    expect(q.id.length).toBeGreaterThan(0);
  });
  it('a pilot in debt exports and imports', async () => {
    const q = importPilot(await exportPilot({ ...p, credits: -400 }).text(), data);
    expect(q.credits).toBe(-400);
  });
  it('import {} -> invalid; non-JSON -> invalid', () => {
    expect(() => importPilot('{}', data)).toThrowError(expect.objectContaining({ code: 'invalid' }));
    expect(() => importPilot('{nope', data)).toThrowError(expect.objectContaining({ code: 'invalid' }));
  });
  it('a valid save naming an unknown ship, system or planet is rejected at import', () => {
    for (const bad of [{ shipId: 'zeppelin' }, { systemId: 'nowhere' }, { planetId: 'atlantis' }]) {
      expect(() => importPilot(JSON.stringify({ ...p, ...bad }), data)).toThrowError(
        expect.objectContaining({ code: 'unknownContent' }),
      );
    }
  });
  it('file name sanitised', () => {
    expect(exportFileName(p)).toBe('A_B_c.starwake.json');
  });
});
