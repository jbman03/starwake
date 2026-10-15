import { describe, expect, it } from 'vitest';
import type { PilotSave } from './pilot';
import { exportFileName, exportPilot, importPilot } from './transfer';

const p: PilotSave = {
  version: 1, id: 'p1', name: 'A/B:c', credits: 100, shipId: 's', fuel: 5, systemId: 'x',
  planetId: 'y', gameTimeSec: 1, savedAt: '2026-01-01T00:00:00.000Z',
};

describe('transfer', () => {
  it('export -> import keeps fields, new id', async () => {
    const blob = exportPilot(p);
    expect(blob.type).toBe('application/json');
    const q = importPilot(await blob.text());
    expect(q).toEqual({ ...p, id: q.id });
    expect(q.id).not.toBe('p1');
    expect(q.id.length).toBeGreaterThan(0);
  });
  it('import {} -> invalid; non-JSON -> invalid', () => {
    expect(() => importPilot('{}')).toThrowError(expect.objectContaining({ code: 'invalid' }));
    expect(() => importPilot('{nope')).toThrowError(expect.objectContaining({ code: 'invalid' }));
  });
  it('file name sanitised', () => {
    expect(exportFileName(p)).toBe('A_B_c.starwake.json');
  });
});
