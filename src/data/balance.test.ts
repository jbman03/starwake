import { describe, it, expect } from 'vitest';
import ships from '../../data/ships.json';

type S = (typeof ships)[number];
const by = (role: string) => ships.find((s) => s.role === role) as S;
const others = (role: string) => ships.filter((s) => s.role !== role);

describe('ship balance', () => {
  it('hold sizes are all distinct', () => {
    expect(new Set(ships.map((s) => s.cargo)).size).toBe(ships.length);
  });
  it('heavy freighter has the largest hold', () => {
    for (const s of others('heavyFreighter')) expect(by('heavyFreighter').cargo).toBeGreaterThan(s.cargo);
  });
  it('liner has the most berths', () => {
    for (const s of others('liner')) expect(by('liner').passengers).toBeGreaterThan(s.passengers);
  });
  it('scout has the largest fuel capacity', () => {
    for (const s of others('scout')) expect(by('scout').fuelCapacity).toBeGreaterThan(s.fuelCapacity);
  });
  it('interceptor is fastest and most agile', () => {
    for (const s of others('interceptor')) {
      expect(by('interceptor').maxSpeed).toBeGreaterThan(s.maxSpeed);
      expect(by('interceptor').turnRate).toBeGreaterThan(s.turnRate);
    }
  });
  it('carrier has the most shields, armor and outfit space', () => {
    for (const s of others('carrier')) {
      expect(by('carrier').shields).toBeGreaterThan(s.shields);
      expect(by('carrier').armor).toBeGreaterThan(s.armor);
      expect(by('carrier').outfitSpace).toBeGreaterThan(s.outfitSpace);
    }
  });
  it('starter has the lowest price', () => {
    for (const s of others('starter')) expect(by('starter').price).toBeLessThan(s.price);
  });
});
