// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resetBindings } from '../input/bindings';
import { DEFAULT_SETTINGS, loadSettings, saveSettings } from './settings';

const KEY = 'starwake.settings';
afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('settings', () => {
  it('defaults', () => {
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
    expect(DEFAULT_SETTINGS.autoLandOnArrival).toBe(true);
    expect(DEFAULT_SETTINGS.bindings).toEqual(resetBindings());
  });
  it('a fresh sound key skips V when V is already used in another group', () => {
    const b = resetBindings();
    b.openOutfitter = ['KeyV', null];
    const { toggleSound: _t, ...rest } = b;
    localStorage.setItem(KEY, JSON.stringify({ bindings: rest }));
    expect(loadSettings().bindings.toggleSound).toEqual([null, null]);
    expect(loadSettings().bindings.openOutfitter).toEqual(['KeyV', null]);
  });
  it('upgrades the old star map default [M, none] but not a custom one', () => {
    const old = resetBindings();
    old.map = ['KeyM', null];
    localStorage.setItem(KEY, JSON.stringify({ bindings: old }));
    expect(loadSettings().bindings.map).toEqual(['KeyN', 'KeyM']);
    old.map = ['KeyM', 'KeyP'];
    localStorage.setItem(KEY, JSON.stringify({ bindings: old }));
    expect(loadSettings().bindings.map).toEqual(['KeyM', 'KeyP']);
    old.map = ['KeyM', null];
    old.autoStop = ['KeyN', null]; // N already taken in the flight group
    localStorage.setItem(KEY, JSON.stringify({ bindings: old }));
    expect(loadSettings().bindings.map).toEqual(['KeyM', null]);
  });
  it('garbage json -> defaults', () => {
    localStorage.setItem(KEY, '{garbage');
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });
  it('throwing getItem -> defaults', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });
  it('throwing setItem is swallowed', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    expect(() => saveSettings(DEFAULT_SETTINGS)).not.toThrow();
  });
  it('round-trips', () => {
    const s = { ...DEFAULT_SETTINGS, volume: 0.2, quality: 'low' as const, touch: { ...DEFAULT_SETTINGS.touch, mirror: true } };
    saveSettings(s);
    expect(loadSettings()).toEqual(s);
  });
  it('merges missing keys and partial bindings', () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({ volume: 0.1, touch: { mirror: true }, bindings: { thrust: ['KeyW', null], map: 'bad' } }),
    );
    const s = loadSettings();
    expect(s.volume).toBe(0.1);
    expect(s.quality).toBe('high');
    expect(s.touch).toEqual({ ...DEFAULT_SETTINGS.touch, mirror: true });
    expect(s.bindings.thrust).toEqual(['KeyW', null]);
    expect(s.bindings.map).toEqual(resetBindings().map);
    expect(s.bindings.land).toEqual(resetBindings().land);
  });
  it('migration fills muted: false and keeps a saved muted', () => {
    localStorage.setItem(KEY, JSON.stringify({ volume: 0.5 }));
    expect(loadSettings().muted).toBe(false);
    expect(loadSettings().bindings.toggleSound).toEqual(['KeyV', null]);
    localStorage.setItem(KEY, JSON.stringify({ muted: true, muted2: 1 }));
    expect(loadSettings().muted).toBe(true);
    localStorage.setItem(KEY, JSON.stringify({ muted: 'yes' }));
    expect(loadSettings().muted).toBe(false);
  });
  it('invalid values fall back, opacity clamped', () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({ volume: 'x', quality: 'ultra', touch: { opacity: 5, buttonSize: 'XL' }, bindings: 7 }),
    );
    const s = loadSettings();
    expect(s.volume).toBe(0.8);
    expect(s.quality).toBe('high');
    expect(s.touch.opacity).toBe(1);
    expect(s.touch.buttonSize).toBe('M');
    expect(s.bindings).toEqual(resetBindings());
  });
  it('restores Escape-bearing defaults for pause/back when stored bindings drop Escape', () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({ bindings: { pause: [null, null], back: ['KeyB', null], thrust: ['KeyW', null] } }),
    );
    const s = loadSettings();
    expect(s.bindings.pause).toEqual(resetBindings().pause);
    expect(s.bindings.back).toEqual(resetBindings().back);
    expect(s.bindings.thrust).toEqual(['KeyW', null]);
  });
  it('a newly added action does not take a key the stored bindings already use in its group', () => {
    // Settings saved before the star map action existed, with refuel moved to N.
    localStorage.setItem(KEY, JSON.stringify({ bindings: { refuel: ['KeyN', null], thrust: ['KeyB', null] } }));
    const s = loadSettings();
    expect(s.bindings.refuel).toEqual(['KeyN', null]);
    expect(s.bindings.openMap).toEqual([null, null]);
    expect(s.bindings.buyGoods).toEqual(['KeyB', null]); // other group: no clash
    expect(s.bindings.openExchange).toEqual(['KeyC', null]);
  });
  it('settings saved before How to Play existed get H for it, unless H is taken in that group', () => {
    localStorage.setItem(KEY, JSON.stringify({ bindings: { thrust: ['KeyW', null] } }));
    const a = loadSettings();
    expect(a.bindings.howToPlay).toEqual(['KeyH', null]);
    expect(a.bindings.menuHowToPlay).toEqual(['KeyH', null]);
    // The pilot had already moved Refuel (planet group) to H.
    localStorage.setItem(KEY, JSON.stringify({ bindings: { refuel: ['KeyH', null] } }));
    const b = loadSettings();
    expect(b.bindings.refuel).toEqual(['KeyH', null]);
    expect(b.bindings.howToPlay).toEqual([null, null]);
    expect(b.bindings.menuHowToPlay).toEqual(['KeyH', null]); // menus group: no clash
  });
  it('old saved bindings gain cycleSecondary and board', () => {
    const old = resetBindings() as Record<string, unknown>;
    for (const id of ['cycleSecondary', 'board', 'encounterChoice4', 'encounterChoice5']) delete old[id];
    localStorage.setItem(KEY, JSON.stringify({ bindings: old }));
    const b = loadSettings().bindings;
    expect(b.cycleSecondary).toEqual(['KeyQ', null]);
    expect(b.board).toEqual(['KeyB', null]);
    expect(b.encounterChoice4).toEqual(['Digit4', null]);
    expect(b.encounterChoice5).toEqual(['Digit5', null]);
    // A pilot who already put Q on thrust keeps it; the new action waits for a key.
    localStorage.setItem(KEY, JSON.stringify({ bindings: { ...old, thrust: ['KeyQ', null] } }));
    expect(loadSettings().bindings.cycleSecondary).toEqual([null, null]);
  });
});
