import { describe, expect, it } from 'vitest';
import { testData } from '../data/testData';
import { ESCORT_ORDERS, escortMaxArmor, escortMaxFuel } from './escorts';

const data = testData();

describe('escort helpers', () => {
  it('lists the four orders', () => {
    expect(ESCORT_ORDERS).toEqual(['follow', 'attack', 'hold', 'defend']);
  });

  it('max armor is hull plus fitted armor outfits', () => {
    const bare = escortMaxArmor(data, { shipId: 'courier', outfits: {} });
    expect(bare).toBe(data.ships.courier.armor);
    expect(escortMaxArmor(data, { shipId: 'courier', outfits: { 'armor-plate': 1 } })).toBeGreaterThan(bare);
  });

  it('max fuel is whole jumps of the tank', () => {
    expect(escortMaxFuel(data, { shipId: 'courier', outfits: {} })).toBe(
      Math.floor(data.ships.courier.fuelCapacity / data.config.fuelPerJump),
    );
    expect(escortMaxFuel(data, { shipId: 'courier', outfits: { 'fuel-tank': 1 } })).toBeGreaterThan(
      escortMaxFuel(data, { shipId: 'courier', outfits: {} }),
    );
  });
});
