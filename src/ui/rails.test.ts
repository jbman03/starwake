// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { Controller } from '../app/controller';
import { loadGameData } from '../data/load';
import { Guide } from '../guide/guide';
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
    expect(contextLabel('plotCourse', w, data)).toBe('🗺 PLOT COURSE');
    expect(contextLabel('takeControl', w, data)).toBe('✋ TAKE CONTROL');
    expect(contextLabel('tow', w, data)).toBe(`CALL TOW (${data.config.towFee} cr)`);
    expect(contextLabel(null, w, data)).toBeNull();
  });
});

describe('mountRails', () => {
  it('the HUD shows the plotted course under the target line, and hides it with no course', async () => {
    const { c, rails, parent } = await setup();
    c.startFlight();
    rails.update();
    const course = parent.querySelector<HTMLElement>('[data-testid="rail-course"]')!;
    expect(course.hidden).toBe(true);
    c.plotRoute('mirren');
    rails.update();
    expect(course.hidden).toBe(false);
    expect(course.textContent).toBe('Course: Vesk (2 jumps)');
  });

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
    for (let i = 0; i < 40; i++) c.update(1 / 60); // the landing effect runs first
    expect(c.landedPlanetId).toBe('halcyon');
    rails.update();
    expect(btn.hidden).toBe(true);
  });

  it('with a course set near the planet the button offers AUTOPILOT, not LAND; targeting a planet gives LAND ON <PORT>', async () => {
    const { c, rails, parent } = await setup();
    c.startFlight();
    c.plotRoute('vesk');
    rails.update();
    const btn = parent.querySelector<HTMLButtonElement>('[data-testid="context-button"]')!;
    expect(btn.textContent).toBe('⇱ AUTOPILOT TO JUMP POINT');
    c.selectPlanet('merrow');
    rails.update();
    expect(btn.textContent).toBe('⬇ LAND ON MERROW');
  });

  it('with no destination in open space, the context button offers PLOT COURSE and opens the map', async () => {
    const { c, rails, parent } = await setup();
    const menus: string[] = [];
    c.on('menu', (e) => menus.push(e.action));
    c.startFlight();
    c.world = { ...c.world, ship: { ...c.world.ship, pos: { x: -1000, y: -1000 } } };
    rails.update();
    const btn = parent.querySelector<HTMLButtonElement>('[data-testid="context-button"]')!;
    expect(btn.hidden).toBe(false);
    expect(btn.textContent).toBe('🗺 PLOT COURSE');
    btn.dispatchEvent(new Event('pointerdown'));
    expect(menus).toEqual(['map']);
    expect(c.isFlying).toBe(false);
  });

  it('in open space too close to jump, the context button autopilots out to the jump point', async () => {
    const { c, rails, parent } = await setup();
    c.startFlight();
    c.world = { ...c.world, route: ['vesk'], ship: { ...c.world.ship, pos: { x: -1000, y: -1000 } } };
    rails.update();
    const btn = parent.querySelector<HTMLButtonElement>('[data-testid="context-button"]')!;
    expect(btn.hidden).toBe(false);
    expect(btn.textContent).toBe('⇱ AUTOPILOT TO JUMP POINT');
    btn.dispatchEvent(new Event('pointerdown'));
    expect(c.world.assist).toEqual({ kind: 'autopilot', dest: { type: 'jumpPoint' }, autoLand: false });
    rails.update();
    expect(btn.textContent).toBe('✋ TAKE CONTROL');
  });

  it('has a labelled Map button above the radar at 844×390, even with the radar hidden, that presses map', async () => {
    const { c, rails, parent } = await setup();
    c.startFlight();
    rails.update();
    const map = parent.querySelector<HTMLButtonElement>('[data-control="map"]')!;
    const radar = parent.querySelector<HTMLElement>('[data-control="radar"]')!;
    expect(map.textContent).toBe('Map');
    expect(map.hidden).toBe(false);
    const rail = map.parentElement!;
    const kids = [...rail.children];
    expect(kids.indexOf(map)).toBe(kids.indexOf(radar) - 1);
    c.settings.touch.buttonSize = 'L';
    c.settings.touch.steering = 'classic';
    const tight = mountRails({ parent, controller: c, inputMode: new InputMode(new EventTarget(), () => c.settings.bindings, 'touch'), size: () => ({ w: 667, h: 270 }), autoUpdate: false });
    tight.update();
    const maps = parent.querySelectorAll<HTMLButtonElement>('[data-control="map"]');
    expect(maps[1].hidden).toBe(false);
    expect(parent.querySelectorAll<HTMLElement>('[data-control="radar"]')[1].hidden).toBe(true);
    expect(parseFloat(maps[1].style.height)).toBeGreaterThanOrEqual(44);
    const pressed: boolean[] = [];
    c.touch.press = ((a: string) => pressed.push(a === 'map')) as typeof c.touch.press;
    map.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    expect(pressed[0]).toBe(true);
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

  it('while the guide runs, the stick rail shows its hint under the HUD and a 44 px Skip guide beside Stop', async () => {
    const { c, rails, parent, data } = await setup();
    c.startFlight();
    rails.update();
    const stick = parent.querySelector<HTMLElement>('[data-control="stick"]')!;
    const hintText = parent.querySelector<HTMLElement>('[data-testid="rail-guide"]')!;
    const skip = parent.querySelector<HTMLButtonElement>('[data-control="guide-skip"]')!;
    const stickWithout = parseFloat(stick.style.width);
    expect(hintText.hidden).toBe(true);
    expect(skip.hidden).toBe(true);

    const m = new Map<string, string>();
    const storage = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) } as Storage;
    c.guide = new Guide(c, data, { mode: () => 'touch', key: () => '?', storage });
    expect(c.guide.start()).toBe(true);
    rails.update();
    expect(hintText.hidden).toBe(false);
    expect(hintText.textContent).toBe(c.guide.current()!.text);
    expect(hintText.closest('[data-rail="stick"]')).not.toBeNull();
    expect(skip.hidden).toBe(false);
    expect(skip.textContent).toBe('Skip guide');
    expect(parseFloat(skip.style.height)).toBeGreaterThanOrEqual(44);
    expect(parseFloat(skip.style.width)).toBeGreaterThanOrEqual(44);
    expect(parseFloat(stick.style.width)).toBeLessThan(stickWithout); // the rail made room

    const asked: string[] = [];
    c.on('guideSkip', (e) => asked.push(e.type));
    skip.dispatchEvent(new Event('pointerdown')); // a finger landing on it (or sliding off Stop) is not a skip
    expect(asked).toEqual([]);
    skip.click();
    expect(asked).toEqual(['guideSkip']);

    c.guide.skip();
    rails.update();
    expect(hintText.hidden).toBe(true);
    expect(skip.hidden).toBe(true);
    expect(parseFloat(stick.style.width)).toBe(stickWithout);
  });

  it('the final "Nice trade" card is not shown in the rail (the screens show it)', async () => {
    const { c, rails, parent, data } = await setup();
    c.startFlight();
    const m = new Map<string, string>();
    const storage = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) } as Storage;
    const target = { good: 'food', system: 'tessaly', port: 'vanterre' };
    m.set('starwake.guide.p', JSON.stringify({ step: 11, done: false, target, startCredits: 0, profit: 5 }));
    c.guide = new Guide(c, data, { mode: () => 'touch', key: () => '?', storage });
    c.guide.start();
    expect(c.guide.current()?.step).toBe(11);
    rails.update();
    expect(parent.querySelector<HTMLElement>('[data-testid="rail-guide"]')!.hidden).toBe(true);
    expect(parent.querySelector<HTMLElement>('[data-control="guide-skip"]')!.hidden).toBe(true);
  });
});
