import { describe, it, expect } from 'vitest';
import { testData } from './testData';
import { newWorld } from '../sim/world';
import { bestLoopPerJump, guideTradeProfit, jobsToAfford, medianMissionPerJump, medianMissionPay } from '../sim/balance';
import { pickTarget } from '../guide/target';
import { BUY_TONS } from '../guide/steps';
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

describe('earning curve (spec section 7)', () => {
  const data = testData();
  const world = newWorld(data, 1);
  const loop = bestLoopPerJump(world, data, data.config.startShipId);
  const mission = medianMissionPerJump(world, data, 60);
  const jobs = jobsToAfford(world, data, data.ships.courier.price);

  it('best shuttle loop earns at least 40% of the median mission per jump', () => {
    expect(loop, `loop ${loop.toFixed(0)}/jump, median mission ${mission.toFixed(0)}/jump, ratio ${(loop / mission).toFixed(2)}`).toBeGreaterThanOrEqual(0.4 * mission);
  });
  it('the courier is affordable after 8 to 14 median jobs', () => {
    expect(jobs, `${jobs} jobs (median pay ${medianMissionPay(world, data, 60)})`).toBeGreaterThanOrEqual(8);
    expect(jobs).toBeLessThanOrEqual(14);
  });
  it('the guide trade makes at least 300 cr on 20 t', () => {
    const t = pickTarget(world, data, data.config.startPlanetId)!;
    expect(t).not.toBeNull();
    const profit = guideTradeProfit(data, t.good, BUY_TONS);
    expect(profit, `${t.good} x${BUY_TONS}`).toBeGreaterThanOrEqual(300);
    expect(BUY_TONS).toBe(20);
  });
  it('Stillwater Pearl sells high at one or two known core ports', () => {
    const buyers = Object.values(data.planets).filter((p) => p.market?.['stillwater-pearl'] === 'high');
    expect(buyers.length).toBeGreaterThanOrEqual(1);
    expect(buyers.length).toBeLessThanOrEqual(2);
    for (const p of buyers) expect(data.config.knownAtStart).toContain(p.systemId);
  });
});
