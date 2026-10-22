import { describe, expect, it } from 'vitest';
import { testData } from '../data/testData';
import { cargoUsed } from './cargo';
import { systemsWithin } from './galaxy';
import { buyOutfit, outfitBuyCheck, outfitSellCheck, OUTFIT_BLOCK_TEXT, sellOutfit } from './outfitter';
import { worldStats } from './shipStats';
import type { FrameInput, WorldState } from './types';
import { newWorld, stepWorld } from './world';

const data = testData();
const PORT = 'halcyon'; // Calder, tier 3, outfitter
const base = (over: Partial<WorldState> = {}): WorldState => ({ ...newWorld(data, 1), ...over });

describe('outfitBuyCheck / buyOutfit', () => {
  it('buys a cargo pod for 2000', () => {
    const w = base();
    const r = buyOutfit(w, data, PORT, 'cargo-pod');
    expect(r.check).toEqual({ ok: true });
    expect(r.world.credits).toBe(w.credits - 2000);
    expect(r.world.outfits['cargo-pod']).toBe(1);
  });

  it('blocks on credits, including negative credits', () => {
    expect(outfitBuyCheck(base({ credits: 1999 }), data, PORT, 'cargo-pod')).toEqual({ ok: false, reason: 'credits' });
    expect(outfitBuyCheck(base({ credits: -5 }), data, PORT, 'local-chart')).toEqual({ ok: false, reason: 'credits' });
    expect(outfitBuyCheck(base({ credits: 2000 }), data, PORT, 'cargo-pod')).toEqual({ ok: true });
  });

  it('blocks on space', () => {
    const w = base({ outfits: { 'cargo-pod': 1, 'fuel-tank': 1 } }); // 8 used, 2 free
    expect(outfitBuyCheck(w, data, PORT, 'cargo-pod')).toEqual({ ok: false, reason: 'space' });
  });

  it('blocks on max', () => {
    const w = base({ outfits: { 'fuel-scoop': 1 }, credits: 99999 });
    expect(outfitBuyCheck(w, data, PORT, 'fuel-scoop')).toEqual({ ok: false, reason: 'max' });
  });

  it('blocks on notSold and leaves the world unchanged', () => {
    const w = base();
    const r = buyOutfit(w, data, PORT, 'heavy-armor');
    expect(r.check).toEqual({ ok: false, reason: 'notSold' });
    expect(r.world).toBe(w);
  });

  it('orders the checks: max before space before credits', () => {
    const w = base({ credits: 0, outfits: { 'fuel-scoop': 1 } });
    expect(outfitBuyCheck(w, data, PORT, 'fuel-scoop')).toEqual({ ok: false, reason: 'max' });
    expect(outfitBuyCheck(w, data, PORT, 'extended-tank')).toEqual({ ok: false, reason: 'space' });
    expect(outfitBuyCheck(w, data, PORT, 'fuel-tank')).toEqual({ ok: false, reason: 'credits' });
  });

  it('local chart reveals everything within 4 jumps and is not stored', () => {
    const w = base();
    const r = buyOutfit(w, data, PORT, 'local-chart');
    expect(r.check).toEqual({ ok: true });
    expect(r.world.credits).toBe(w.credits - 1000);
    expect(r.world.outfits['local-chart']).toBeUndefined();
    for (const id of systemsWithin(data, 'calder', 4, [])) expect(r.world.known).toContain(id);
    expect(r.world.known.length).toBeGreaterThan(w.known.length);
    expect(r.world.seen.filter((id) => r.world.known.includes(id))).toEqual([]);
  });

  it('local chart is blocked with nothingToReveal once everything in range is known', () => {
    const once = buyOutfit(base(), data, PORT, 'local-chart').world;
    expect(outfitBuyCheck(once, data, PORT, 'local-chart')).toEqual({ ok: false, reason: 'nothingToReveal' });
    expect(buyOutfit(once, data, PORT, 'local-chart').world).toBe(once);
  });
});

describe('outfitSellCheck / sellOutfit', () => {
  it('refunds 50%', () => {
    const w = base({ outfits: { 'cargo-pod': 1 } });
    expect(outfitSellCheck(w, data, 'cargo-pod')).toEqual({ ok: true, refund: 1000, fuelLost: 0 });
    const r = sellOutfit(w, data, 'cargo-pod');
    expect(r.world.credits).toBe(w.credits + 1000);
    expect(r.world.outfits['cargo-pod']).toBeUndefined();
  });

  it('refuses when not owned', () => {
    expect(outfitSellCheck(base(), data, 'cargo-pod')).toEqual({ ok: false, reason: 'notOwned' });
  });

  it('refuses a pod sale when cargo would not fit', () => {
    const w = base({ outfits: { 'cargo-pod': 1 }, cargo: { food: 25 } });
    expect(cargoUsed(w)).toBe(25);
    expect(outfitSellCheck(w, data, 'cargo-pod')).toEqual({ ok: false, reason: 'cargoWouldNotFit' });
    expect(sellOutfit(w, data, 'cargo-pod').world).toBe(w);
  });

  it('selling a fuel tank with full fuel loses 100 and trims fuel', () => {
    const w0 = base({ outfits: { 'fuel-tank': 1 } });
    const w = { ...w0, ship: { ...w0.ship, fuel: worldStats(w0, data).fuelCapacity } };
    expect(w.ship.fuel).toBe(400);
    expect(outfitSellCheck(w, data, 'fuel-tank')).toEqual({ ok: true, refund: 750, fuelLost: 100 });
    expect(sellOutfit(w, data, 'fuel-tank').world.ship.fuel).toBe(300);
  });

  it('maps are not sellable', () => {
    expect(outfitSellCheck(base(), data, 'local-chart')).toEqual({ ok: false, reason: 'notSellable' });
  });

  it('has text for every block reason', () => {
    for (const k of ['credits', 'space', 'max', 'notSold', 'nothingToReveal', 'notOwned', 'cargoWouldNotFit', 'notSellable'] as const) {
      expect(OUTFIT_BLOCK_TEXT[k].length).toBeGreaterThan(0);
    }
  });
});

describe('fuel scoop in stepWorld', () => {
  const idle: FrameInput = { actions: new Set(), pressed: new Set() };
  const run = (w: WorldState, secs: number) => {
    for (let i = 0; i < secs * 10; i++) w = stepWorld(w, data, idle, 0.1, { autoLandOnArrival: false }).world;
    return w;
  };
  const withFuel = (w: WorldState, fuel: number): WorldState => ({ ...w, ship: { ...w.ship, fuel } });

  it('adds 25 fuel over 60 s, capped at capacity', () => {
    const w0 = base({ outfits: { 'fuel-scoop': 1 } });
    expect(run(withFuel(w0, 100), 60).ship.fuel).toBeCloseTo(125, 5);
    expect(run(withFuel(w0, 290), 60).ship.fuel).toBe(300);
  });

  it('adds nothing without a scoop', () => {
    expect(run(withFuel(base(), 100), 60).ship.fuel).toBe(100);
  });

  it('adds nothing while jumping', () => {
    const w0 = base({ outfits: { 'fuel-scoop': 1 } });
    const w = { ...withFuel(w0, 100), jump: { toSystemId: 'tessaly', t: 0 } };
    expect(stepWorld(w, data, idle, 0.5, { autoLandOnArrival: false }).world.ship.fuel).toBe(100);
  });
});

describe('requiresStanding', () => {
  const gated = {
    ...data,
    outfits: { ...data.outfits, 'cargo-pod': { ...data.outfits['cargo-pod'], requiresStanding: { government: 'concord', level: 'friend' as const } } },
  };

  it('blocks with reason "standing" until the government is a friend', () => {
    const w = base({ credits: 5000 });
    expect(outfitBuyCheck(w, gated, PORT, 'cargo-pod')).toEqual({ ok: false, reason: 'standing' });
    expect(buyOutfit(w, gated, PORT, 'cargo-pod').world).toBe(w);
    expect(outfitBuyCheck({ ...w, standing: { concord: 'friend' } }, gated, PORT, 'cargo-pod')).toEqual({ ok: true });
    expect(OUTFIT_BLOCK_TEXT.standing).toBeTruthy();
  });
});
