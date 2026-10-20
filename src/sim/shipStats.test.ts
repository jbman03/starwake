import { describe, expect, it } from 'vitest';
import { testData } from '../data/testData';
import { cargoFree } from './cargo';
import { shipStats, worldStats } from './shipStats';
import { newWorld } from './world';

const data = testData();
const hull = data.ships.shuttle;

describe('shipStats', () => {
  it('gives the bare hull values for an unequipped shuttle', () => {
    const s = shipStats('shuttle', {}, data);
    expect(s).toEqual({
      cargo: hull.cargo,
      passengers: hull.passengers,
      fuelCapacity: hull.fuelCapacity,
      shields: hull.shields,
      armor: hull.armor,
      outfitSpace: hull.outfitSpace,
      spaceUsed: 0,
      spaceFree: hull.outfitSpace,
      fuelPerMin: 0,
    });
  });

  it('adds cargo pods and fuel tanks (spaceFree is unclamped and may go negative)', () => {
    const s = shipStats('shuttle', { 'cargo-pod': 2, 'fuel-tank': 1 }, data);
    expect(s.cargo).toBe(30);
    expect(s.fuelCapacity).toBe(400);
    expect(s.spaceUsed).toBe(13);
    expect(s.spaceFree).toBe(hull.outfitSpace - 13);
  });

  it('reports fuel scoop income', () => {
    expect(shipStats('shuttle', { 'fuel-scoop': 1 }, data).fuelPerMin).toBe(25);
  });

  it('ignores unknown outfit ids', () => {
    expect(shipStats('shuttle', { nonsense: 3 }, data)).toEqual(shipStats('shuttle', {}, data));
  });

  it('worldStats uses the world ship and outfits; cargoFree reflects the larger hold', () => {
    const w = { ...newWorld(data), outfits: { 'cargo-pod': 2 } };
    expect(worldStats(w, data).cargo).toBe(30);
    expect(cargoFree(w, data)).toBe(30);
  });
});
