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
});
