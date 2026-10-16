import { describe, expect, it } from 'vitest';
import config from '../../data/config.json';
import governments from '../../data/governments.json';
import commodities from '../../data/commodities.json';
import events from '../../data/events.json';
import missionTypes from '../../data/missionTypes.json';
import planets from '../../data/planets.json';
import ships from '../../data/ships.json';
import systems from '../../data/systems.json';
import { parseGameData } from '../data/load';
import type { PilotSave } from './pilot';
import { exportFileName, exportPilot, importPilot } from './transfer';

const data = parseGameData({ ships, systems, planets, config, governments, commodities, events, missionTypes });
const p: PilotSave = {
  version: 1, id: 'p1', name: 'A/B:c', credits: 100, shipId: 'shuttle', fuel: 5, systemId: 'calder',
  planetId: 'halcyon', gameTimeSec: 1, savedAt: '2026-01-01T00:00:00.000Z',
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
