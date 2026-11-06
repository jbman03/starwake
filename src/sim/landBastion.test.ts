import { describe, expect, it } from 'vitest';
import { testData } from '../data/testData';
import { stepWorld, newWorld } from './world';
import type { FrameInput, WorldState } from './types';

const data = testData();
const press = (a: string[]): FrameInput => ({ actions: new Set(), pressed: new Set(a as never[]) });

function landTime(shipId: string, from: { x: number; y: number }, vel = { x: 0, y: 0 }): number {
  const base = newWorld(data, 3);
  const planet = data.planets.vanterre;
  let w: WorldState = { ...base, systemId: planet.systemId, shipId, outfits: {}, ship: { ...base.ship, pos: { x: planet.pos.x + from.x, y: planet.pos.y + from.y }, vel, fuel: 500 }, targetPlanetId: 'vanterre', assist: { kind: 'none' } };
  for (let i = 0; i < 90 * 60; i++) {
    const r = stepWorld(w, data, i === 0 ? press(['land']) : press([]), 1 / 60, { autoLandOnArrival: false } as never);
    w = r.world;
    if (r.events.some((e) => e.type === 'landed')) return i / 60;
  }
  return Infinity;
}

describe('pressing L flies a slow carrier in and lands (playtest bug 3)', () => {
  for (const shipId of ['bastion', 'ironback', 'shuttle', 'kestrel'])
    it(shipId, () => {
      for (const [from, vel] of [[{ x: 1200, y: 0 }, { x: 0, y: 0 }], [{ x: 600, y: 600 }, { x: 0, y: -200 }], [{ x: -300, y: 50 }, { x: 150, y: 0 }]] as const)
        expect(landTime(shipId, from, vel), `${shipId} from ${JSON.stringify(from)}`).toBeLessThan(45);
    });
});
