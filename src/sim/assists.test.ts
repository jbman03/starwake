import { describe, expect, it } from 'vitest';
import type { ShipDef } from '../data/schemas';
import { autopilotInput, autoStopInput, faceInput, reverseInput } from './assists';
import { stepShip, wrap } from './flight';
import type { ShipState } from './types';
import { angleOf, dist, fromAngle, len, scale } from './vec';

const def = { turnRate: 180, acceleration: 150, maxSpeed: 300 } as unknown as ShipDef;
const DT = 1 / 60;
const mk = (p: Partial<ShipState>): ShipState => ({
  pos: { x: 0, y: 0 }, vel: { x: 0, y: 0 }, heading: 0, fuel: 100, ...p,
});

describe('assists', () => {
  it('auto-stop brings 300 px/s to rest within 6 s', () => {
    let s = mk({ vel: scale(fromAngle(1), 300), heading: -2 });
    let done = false;
    for (let i = 0; i < 360 && !done; i++) {
      const r = autoStopInput(s, def);
      done = r.done;
      s = stepShip(s, def, r.input, DT);
    }
    expect(done).toBe(true);
    expect(len(s.vel)).toBeLessThan(1);
  });

  it('reverse points opposite velocity within 1.1 s', () => {
    let s = mk({ vel: { x: 200, y: 100 }, heading: 0.3 });
    for (let i = 0; i < 66; i++) s = stepShip(s, def, reverseInput(s), DT);
    const want = angleOf({ x: -200, y: -100 });
    expect(Math.abs(wrap(s.heading - want))).toBeLessThan(0.02);
  });

  it('face target ends within 1 degree', () => {
    let s = mk({ heading: 2.5 });
    const t = { x: 100, y: -300 };
    for (let i = 0; i < 120; i++) s = stepShip(s, def, faceInput(s, t), DT);
    expect(Math.abs(wrap(s.heading - angleOf(t)))).toBeLessThan(Math.PI / 180);
  });

  const dest = { x: 1500, y: 0 };
  const cases: [string, ShipState][] = [
    ['at rest', mk({})],
    ['moving directly away', mk({ vel: { x: -300, y: 0 }, heading: Math.PI })],
    ['moving perpendicular', mk({ vel: { x: 0, y: 300 }, heading: Math.PI / 2 })],
  ];
  for (const [name, start] of cases) {
    it(`autopilot arrives from ${name}`, () => {
      let s = start;
      let arrived = false;
      for (let i = 0; i < 1800 && !arrived; i++) {
        const r = autopilotInput(s, def, dest, 25, 20);
        arrived = r.arrived;
        s = stepShip(s, def, r.input, DT);
      }
      expect(arrived).toBe(true);
      expect(dist(s.pos, dest)).toBeLessThan(30);
      expect(len(s.vel)).toBeLessThan(25);
    });
  }
});
