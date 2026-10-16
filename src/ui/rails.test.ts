// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { Controller } from '../app/controller';
import { loadGameData } from '../data/load';
import { InputMode } from '../input/mode';
import { DEFAULT_SETTINGS } from '../save/settings';
import type { WorldState } from '../sim/types';
import { newWorld } from '../sim/world';
import { contextLabel, mountRails } from './rails';

async function setup(mode: 'touch' | 'keyboard' = 'touch') {
  const data = await loadGameData();
  const settings = { ...DEFAULT_SETTINGS, touch: { ...DEFAULT_SETTINGS.touch } };
  const c = new Controller(data, settings, new EventTarget());
  c.pilot = { id: 'p', name: 'P' };
  const inputMode = new InputMode(new EventTarget(), () => settings.bindings, mode);
  const parent = document.createElement('div');
  document.body.append(parent);
  const rails = mountRails({ parent, controller: c, inputMode, size: () => ({ w: 844, h: 390 }), autoUpdate: false });
  return { c, data, rails, parent, inputMode };
}

describe('contextLabel', () => {
  it('names the land target, jump destination, take control and the tow fee', async () => {
    const data = await loadGameData();
    const w = newWorld(data);
    expect(contextLabel('land', w, data)).toBe('⬇ LAND ON HALCYON');
    expect(contextLabel('land', { ...w, targetPlanetId: 'merrow' }, data)).toBe('⬇ LAND ON MERROW');
    expect(contextLabel('jump', { ...w, route: ['vesk'] }, data)).toBe('JUMP TO VESK');
    expect(contextLabel('jump', { ...w, route: ['tessaly', 'aurelle'] }, data)).toBe('JUMP TO TESSALY');
    expect(contextLabel('jump', w, data)).toBeNull();
    expect(contextLabel('autopilotOut', w, data)).toBe('⇱ AUTOPILOT TO JUMP POINT');
    expect(contextLabel('takeControl', w, data)).toBe('✋ TAKE CONTROL');
    expect(contextLabel('tow', w, data)).toBe(`CALL TOW (${data.config.towFee} cr)`);
    expect(contextLabel(null, w, data)).toBeNull();
  });
});

describe('mountRails', () => {
  it('shows rails only in touch mode during a session', async () => {
    const { c, rails, inputMode, parent } = await setup('keyboard');
    c.startFlight();
    rails.update();
    const layer = parent.querySelector<HTMLElement>('[data-testid="touch-rails"]')!;
    expect(layer.hidden).toBe(true);
    inputMode.set('touch');
    rails.update();
    expect(layer.hidden).toBe(false);
    c.endSession();
    rails.update();
    expect(layer.hidden).toBe(true);
  });

  it('context button shows the label and performs the context action', async () => {
    const { c, rails, parent } = await setup();
    c.startFlight();
    c.update(1 / 60);
    rails.update();
    const btn = parent.querySelector<HTMLButtonElement>('[data-testid="context-button"]')!;
    expect(btn.hidden).toBe(false);
    expect(btn.textContent).toBe('⬇ LAND ON HALCYON');
    btn.dispatchEvent(new Event('pointerdown'));
    c.update(1 / 60);
    expect(c.landedPlanetId).toBe('halcyon');
    rails.update();
    expect(btn.hidden).toBe(true);
  });

  it('in open space too close to jump, the context button autopilots out to the jump point', async () => {
    const { c, rails, parent } = await setup();
    c.startFlight();
    c.world = { ...c.world, ship: { ...c.world.ship, pos: { x: -1000, y: -1000 } } };
    rails.update();
    const btn = parent.querySelector<HTMLButtonElement>('[data-testid="context-button"]')!;
    expect(btn.hidden).toBe(false);
    expect(btn.textContent).toBe('⇱ AUTOPILOT TO JUMP POINT');
    btn.dispatchEvent(new Event('pointerdown'));
    expect(c.world.assist).toEqual({ kind: 'autopilot', dest: { type: 'jumpPoint' }, autoLand: false });
    rails.update();
    expect(btn.textContent).toBe('✋ TAKE CONTROL');
  });

  it('fire button presses and releases firePrimary through the touch source', async () => {
    const { c, rails, parent } = await setup();
    c.startFlight();
    rails.update();
    const fire = parent.querySelector<HTMLElement>('[data-control="fire"]')!;
    fire.dispatchEvent(new Event('pointerdown'));
    expect(c.touch.poll('flight').actions.has('firePrimary')).toBe(true);
    fire.dispatchEvent(new Event('pointerup'));
    expect(c.touch.poll('flight').actions.has('firePrimary')).toBe(false);
  });

  it('dims fire, missile and stick to 20% during autopilot', async () => {
    const { c, rails, parent } = await setup();
    c.startFlight();
    const auto: WorldState = { ...c.world, assist: { kind: 'autopilot', dest: { type: 'jumpPoint' }, autoLand: false } };
    c.world = auto;
    rails.update();
    for (const name of ['fire', 'missile', 'stick']) {
      expect(parent.querySelector<HTMLElement>(`[data-control="${name}"]`)!.style.opacity).toBe('0.2');
    }
    c.world = { ...auto, assist: { kind: 'none' } };
    rails.update();
    expect(parent.querySelector<HTMLElement>('[data-control="fire"]')!.style.opacity).toBe('');
  });

  it('shows the autopilot route banner top-center of the clear region while the autopilot flies', async () => {
    const { c, rails, parent } = await setup();
    c.startFlight();
    rails.update();
    const banner = parent.querySelector<HTMLElement>('[data-testid="route-banner"]')!;
    expect(banner.hidden).toBe(true);
    c.world = { ...c.world, route: ['vesk'], assist: { kind: 'autopilot', dest: { type: 'jumpPoint' }, autoLand: false } };
    rails.update();
    expect(banner.hidden).toBe(false);
    expect(banner.textContent).toBe('Autopilot → Vesk · fuel after: 2 jumps');
    const clear = JSON.parse(parent.querySelector<HTMLElement>('[data-testid="touch-rails"]')!.dataset.clear!);
    expect(parseFloat(banner.style.left)).toBeCloseTo(clear.x + clear.w / 2, 5);
    expect(parseFloat(banner.style.maxWidth)).toBeLessThanOrEqual(clear.w);
    c.world = { ...c.world, assist: { kind: 'none' } };
    rails.update();
    expect(banner.hidden).toBe(true);
  });

  it('classic steering adds a Thrust button', async () => {
    const { c, rails, parent } = await setup();
    c.startFlight();
    rails.update();
    expect(parent.querySelector<HTMLElement>('[data-control="thrust"]')!.hidden).toBe(true);
    c.settings.touch.steering = 'classic';
    rails.update();
    expect(parent.querySelector<HTMLElement>('[data-control="thrust"]')!.hidden).toBe(false);
  });

  it('mirror puts the stick rail on the right', async () => {
    const { c, rails, parent } = await setup();
    c.startFlight();
    rails.update();
    const stickRail = parent.querySelector<HTMLElement>('[data-rail="stick"]')!;
    expect(stickRail.style.left).toBe('0px');
    c.settings.touch.mirror = true;
    rails.update();
    expect(stickRail.style.left).toBe('724px');
  });
});
