import { describe, expect, it } from 'vitest';
import config from '../../data/config.json';
import planets from '../../data/planets.json';
import ships from '../../data/ships.json';
import systems from '../../data/systems.json';
import { parseGameData } from '../data/load';
import { contextAction } from './context';
import type { WorldState } from './types';
import { newWorld } from './world';

const data = parseGameData({ ships, systems, planets, config });
const at = (w: WorldState, pos: { x: number; y: number }, fuel = w.ship.fuel): WorldState => ({
  ...w,
  ship: { ...w.ship, pos, fuel },
});

describe('contextAction', () => {
  it('takeControl while autopilot is active (highest priority)', () => {
    const w: WorldState = { ...newWorld(data), assist: { kind: 'autopilot', dest: { type: 'jumpPoint' }, autoLand: false } };
    expect(contextAction(w, data)).toBe('takeControl');
  });

  it('tow when stranded', () => {
    const w = at({ ...newWorld(data), systemId: 'vesk' }, { x: -600, y: -700 }, 0);
    expect(contextAction(w, data)).toBe('tow');
  });

  it('land near halcyon', () => {
    expect(contextAction(newWorld(data), data)).toBe('land');
  });

  it('land at 600 px but not at 601 px', () => {
    const h = data.planets.halcyon;
    expect(contextAction(at(newWorld(data), { x: h.pos.x, y: h.pos.y - 600 }), data)).toBe('land');
    expect(contextAction(at(newWorld(data), { x: h.pos.x, y: h.pos.y - 601 }), data)).toBeNull();
  });

  it('jump when outside the jump distance with fuel', () => {
    expect(contextAction(at(newWorld(data), { x: -2100, y: 0 }), data)).toBe('jump');
  });

  it('null in empty space too close to jump', () => {
    expect(contextAction(at(newWorld(data), { x: -1000, y: -1000 }), data)).toBeNull();
  });

  it('null while jumping', () => {
    const w = { ...at(newWorld(data), { x: 2100, y: 0 }), jump: { toSystemId: 'vesk', t: 0.5 } };
    expect(contextAction(w, data)).toBeNull();
  });
});
