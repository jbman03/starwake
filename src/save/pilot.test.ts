import { describe, expect, it } from 'vitest';
import config from '../../data/config.json';
import planets from '../../data/planets.json';
import ships from '../../data/ships.json';
import systems from '../../data/systems.json';
import { parseGameData } from '../data/load';
import { newWorld } from '../sim/world';
import { CURRENT_SAVE_VERSION, pilotFromWorld, SaveError, upgradeSave, worldFromPilot } from './pilot';

const data = parseGameData({ ships, systems, planets, config });
const start = data.config.startPlanetId;

describe('pilot', () => {
  it('round-trips world -> pilot -> world', () => {
    const w = { ...newWorld(data), credits: 777, timeSec: 123 };
    const p = pilotFromWorld(w, start, { id: 'a', name: 'Ann' });
    expect(p.version).toBe(CURRENT_SAVE_VERSION);
    expect(p.credits).toBe(777);
    const back = worldFromPilot(upgradeSave(JSON.parse(JSON.stringify(p))), data);
    expect(back.credits).toBe(777);
    expect(back.timeSec).toBe(123);
    expect(back.systemId).toBe(w.systemId);
    expect(back.shipId).toBe(w.shipId);
    expect(back.assist).toEqual({ kind: 'none' });
    expect(back.jump).toBeNull();
    expect(back.targetPlanetId).toBeNull();
  });

  it('future version -> futureVersion', () => {
    const p = pilotFromWorld(newWorld(data), start, { id: 'a', name: 'A' });
    expect(() => upgradeSave({ ...p, version: 99 })).toThrowError(expect.objectContaining({ code: 'futureVersion' }));
  });

  it('garbage -> invalid', () => {
    for (const bad of [{}, null, 'x', 5, { version: 1 }]) {
      expect(() => upgradeSave(bad)).toThrowError(expect.objectContaining({ code: 'invalid' }));
    }
    expect(new SaveError('invalid')).toBeInstanceOf(Error);
  });

  it('unknown ids -> invalid in worldFromPilot', () => {
    const p = pilotFromWorld(newWorld(data), start, { id: 'a', name: 'A' });
    expect(() => worldFromPilot({ ...p, shipId: 'nope' }, data)).toThrowError(expect.objectContaining({ code: 'invalid' }));
    expect(() => worldFromPilot({ ...p, planetId: 'nope' }, data)).toThrowError(expect.objectContaining({ code: 'invalid' }));
  });
});
