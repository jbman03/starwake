import { describe, expect, it } from 'vitest';
import { testData } from '../data/testData';
import { ammoCap, hasWeapon, npcLoadout, weaponsOf } from './weapons';

const data = testData();

describe('weaponsOf', () => {
  it('groups guns/turrets, beams and launchers', () => {
    const w = weaponsOf(
      { 'pivot-turret': 1, 'light-blaster': 2, 'lance-beam': 1, 'rocket-rack': 1, rocket: 5, 'cargo-pod': 2, ghost: 1 },
      data,
    );
    expect(w.guns.map((g) => [g.def.id, g.count])).toEqual([['light-blaster', 2], ['pivot-turret', 1]]);
    expect(w.beams.map((g) => [g.def.id, g.count])).toEqual([['lance-beam', 1]]);
    expect(w.launchers.map((g) => [g.def.id, g.count])).toEqual([['rocket-rack', 1]]);
  });
});

describe('ammoCap', () => {
  it('is max x launchers that fire it', () => {
    expect(ammoCap({}, 'rocket', data)).toBe(0);
    expect(ammoCap({ 'rocket-rack': 1 }, 'rocket', data)).toBe(20);
    expect(ammoCap({ 'rocket-rack': 2 }, 'rocket', data)).toBe(40);
    expect(ammoCap({ 'rocket-rack': 2 }, 'seeker', data)).toBe(0);
  });
});

describe('npcLoadout', () => {
  it('falls back to light blasters by crew', () => {
    expect(npcLoadout(data.ships.kestrel)).toEqual(data.ships.kestrel.loadout);
    const mk = (crew: number) => ({ ...data.ships.shuttle, loadout: undefined, crew });
    expect(npcLoadout(mk(1))).toEqual({});
    expect(npcLoadout(mk(2))).toEqual({ 'light-blaster': 1 });
    expect(npcLoadout(mk(3))).toEqual({ 'light-blaster': 1 });
    expect(npcLoadout(mk(6))).toEqual({ 'light-blaster': 2 });
  });
});

describe('hasWeapon', () => {
  it('is true for guns, beams and launchers only', () => {
    expect(hasWeapon({}, data)).toBe(false);
    expect(hasWeapon({ 'cargo-pod': 1, rocket: 3 }, data)).toBe(false);
    expect(hasWeapon({ 'light-blaster': 1 }, data)).toBe(true);
    expect(hasWeapon({ 'lance-beam': 1 }, data)).toBe(true);
    expect(hasWeapon({ 'rocket-rack': 1 }, data)).toBe(true);
  });
});
