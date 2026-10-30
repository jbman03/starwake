// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Controller } from '../app/controller';
import { loadGameData } from '../data/load';
import { ACTION_IDS, ACTION_LABEL } from '../input/actions';
import { rebind } from '../input/bindings';
import { InputMode } from '../input/mode';
import { DEFAULT_SETTINGS } from '../save/settings';
import type { PilotStore } from '../save/store';
import { newWorld } from '../sim/world';
import type { ContextAction } from '../sim/context';
import { createUi } from './context';
import { contextLabel, mountRails } from './rails';
import { controlRows, HOW_TO_PLAY_TABS, PHONE_CONTROLS, showHowToPlay, tabText } from './howToPlay';
import { MAX_MISSIONS } from '../sim/missions';
import type { GameData } from '../data/schemas';

let seq = 0;

async function setup(opts: { session?: boolean; bindings?: typeof DEFAULT_SETTINGS.bindings } = {}) {
  const data = await loadGameData();
  const settings = { ...DEFAULT_SETTINGS, bindings: opts.bindings ?? DEFAULT_SETTINGS.bindings, touch: { ...DEFAULT_SETTINGS.touch } };
  const c = new Controller(data, settings, new EventTarget());
  const root = document.createElement('div');
  document.body.append(root);
  const store = { list: async () => [] } as unknown as PilotStore;
  const ctx = createUi(root, c, store, () => null, new InputMode(new EventTarget(), () => settings.bindings, 'keyboard'));
  if (opts.session !== false) c.beginSession(newWorld(data, 1), { id: `htp-${++seq}`, name: 'P' }, 'halcyon');
  const btn = (label: string) =>
    [...root.querySelectorAll('button')].find((b) => (b.querySelector('.sw-btn-label')?.textContent ?? b.textContent) === label)!;
  return { c, ctx, root, btn };
}

const tabButton = (root: HTMLElement, name: string) =>
  ([...root.querySelectorAll('[role="tab"]')] as HTMLButtonElement[]).find((t) => t.textContent === name)!;

beforeEach(() => localStorage.clear());
afterEach(() => document.body.replaceChildren());

describe('How to Play', () => {
  it('has the five tabs and every one renders text', async () => {
    const { ctx, root } = await setup();
    showHowToPlay(ctx, { onClose: () => {} });
    const tabs = [...root.querySelectorAll('[role="tab"]')] as HTMLButtonElement[];
    expect(tabs.map((t) => t.textContent)).toEqual(['Flying', 'Planets & trade', 'Missions', 'Travel & fuel', 'Controls']);
    expect(HOW_TO_PLAY_TABS).toHaveLength(5);
    for (const t of tabs) {
      t.click();
      const panel = root.querySelector('[role="tabpanel"]')!;
      expect(panel.textContent!.length, t.textContent!).toBeGreaterThan(100);
      expect(root.querySelector('.sw-tab-active')!.textContent).toBe(t.textContent);
    }
  });

  it('teaches the facts the game enforces', async () => {
    const { ctx, root } = await setup();
    showHowToPlay(ctx, { onClose: () => {} });
    const text = (tab: string) => {
      tabButton(root, tab).click();
      return root.querySelector('[role="tabpanel"]')!.textContent!;
    };
    expect(text('Travel & fuel')).toContain('100 fuel');
    expect(text('Travel & fuel')).toContain('500 cr');
    expect(text('Travel & fuel')).toContain('PLOT COURSE');
    expect(text('Missions')).toContain('advance is taken back');
    expect(text('Planets & trade')).toContain('20 t');
  });

  it('Controls lists every action with its keys and a phone control', async () => {
    const { ctx, root } = await setup();
    showHowToPlay(ctx, { onClose: () => {} });
    tabButton(root, 'Controls').click();
    for (const id of ACTION_IDS) {
      const row = root.querySelector(`[data-action="${id}"]`)!;
      expect(row, id).not.toBeNull();
      expect(row.textContent).toContain(ACTION_LABEL[id]);
      expect(row.textContent).toContain(PHONE_CONTROLS[id]);
    }
    expect(root.querySelector('[data-testid="keys-fireSecondary"]')!.textContent).toBe('Left Shift / Right Shift');
    expect(root.querySelector('[data-testid="keys-thrust"]')!.textContent).toBe('↑');
  });

  it('Controls reflects a rebound key in either slot, and unbound actions', async () => {
    let b = rebind(DEFAULT_SETTINGS.bindings, 'thrust', 0, 'KeyW');
    b = rebind(b, 'land', 1, 'KeyQ');
    b = rebind(b, 'jump', 0, null);
    expect(controlRows(b).flatMap((g) => g.rows).find((r) => r.action === 'thrust')!.keys).toEqual(['W']);
    const { ctx, root } = await setup({ bindings: b });
    showHowToPlay(ctx, { onClose: () => {}, tab: 'controls' });
    expect(root.querySelector('[data-testid="keys-thrust"]')!.textContent).toBe('W');
    expect(root.querySelector('[data-testid="keys-land"]')!.textContent).toBe('L / Q');
    expect(root.querySelector('[data-testid="keys-jump"]')!.textContent).toBe('Unbound');
  });

  it('Flying tab names the steering keys from bindings', async () => {
    const data = await loadGameData();
    const text = (b: typeof DEFAULT_SETTINGS.bindings) => tabText('flying', b, data).map((x) => x.text).join(' ');
    expect(text(DEFAULT_SETTINGS.bindings)).toContain('↑ thrusts, ← and → turn, ↓ reverses.');
    let b = rebind(DEFAULT_SETTINGS.bindings, 'thrust', 0, 'KeyW');
    b = rebind(b, 'turnLeft', 0, 'KeyA');
    b = rebind(b, 'turnRight', 0, 'KeyD');
    b = rebind(b, 'reverse', 0, 'KeyS');
    expect(text(b)).toContain('W thrusts, A and D turn, S reverses.');
    expect(text(b)).not.toContain('Up thrusts');
  });

  it('numbers come from the data, not literals', async () => {
    const real = await loadGameData();
    const ship = real.ships[real.config.startShipId];
    const data = {
      ...real,
      config: { ...real.config, fuelPerJump: 75, towFee: 650 },
      ships: { ...real.ships, [ship.id]: { ...ship, cargo: 35, fuelCapacity: 300 } },
    } as GameData;
    const all = (['flying', 'trade', 'missions', 'travel'] as const)
      .flatMap((t) => tabText(t, DEFAULT_SETTINGS.bindings, data))
      .map((x) => x.text)
      .join(' ');
    expect(all).toContain("The starter shuttle's hold fits 35 t;");
    expect(all).toContain('Each jump uses 75 fuel');
    expect(all).toContain("holds 4 jumps' worth");
    expect(all).toContain('It costs 650 cr');
    expect(all).toContain('press Esc and choose Call for tow in the pause menu');
    expect(all).toContain('The tow takes you to a port for 650 cr.');
    expect(all).toContain(`You can hold up to ${MAX_MISSIONS} jobs`);
  });

  it('explains the jump sequence and its skip, the volume sliders and V muting everything, with your own keys', async () => {
    const real = await loadGameData();
    const data = { ...real, config: { ...real.config, jump: { ...real.config.jump, chargeSec: 2, burnSec: 1, flashSec: 0.5, arriveSec: 0.5 } } } as GameData;
    const b = rebind(rebind(DEFAULT_SETTINGS.bindings, 'jump', 0, 'KeyU'), 'toggleSound', 0, 'KeyO');
    const travel = tabText('travel', b, data).map((x) => x.text).join(' ');
    expect(travel).toContain('A jump takes about 4 seconds');
    expect(travel).toContain('the engines charge, it burns hard as the stars stretch, a flash');
    expect(travel).toContain('Press U again while turning, charging or burning to skip straight to the flash; on a phone, tap the SKIP button.');
    const flying = tabText('flying', b, data).map((x) => x.text).join(' ');
    expect(flying).toContain('Settings → General has separate Music and Effects sliders.');
    expect(flying).toContain('O mutes everything, music included');
    expect(PHONE_CONTROLS.jump).toContain('SKIP');
  });

  it("text tabs use the pilot's own keys", async () => {
    const { ctx, root } = await setup({ bindings: rebind(DEFAULT_SETTINGS.bindings, 'land', 0, 'KeyP') });
    showHowToPlay(ctx, { onClose: () => {} });
    expect(root.querySelector('[role="tabpanel"]')!.textContent).toContain('press P.');
  });

  it('the story jobs text uses the interact key of the pilot', async () => {
    const { ctx, root } = await setup({ bindings: rebind(DEFAULT_SETTINGS.bindings, 'interact', 0, 'KeyH') });
    showHowToPlay(ctx, { onClose: () => {} });
    tabButton(root, 'Missions').click();
    const text = root.querySelector('[role="tabpanel"]')!.textContent!;
    expect(text).toContain('In flight, H (or the Scan or Search button');
  });

  it('Back calls onClose', async () => {
    const { ctx, root } = await setup();
    let closed = 0;
    showHowToPlay(ctx, { onClose: () => closed++ });
    [...root.querySelectorAll('button')].find((b) => b.textContent?.startsWith('Back'))!.click();
    expect(closed).toBe(1);
  });
});

describe('Replay first flight', () => {
  it('from Halcyon (landed) restarts the guide at step 1', async () => {
    const { c, ctx, btn } = await setup();
    c.guide!.start();
    c.guide!.skip();
    expect(c.guide!.current()).toBeNull();
    showHowToPlay(ctx, { onClose: () => {} });
    const replay = btn('Replay first flight') as HTMLButtonElement;
    expect(replay.disabled).toBe(false);
    replay.click();
    expect(c.guide!.current()?.step).toBe(1);
    expect(c.guide!.current()?.text).toContain('Commodity Exchange');
  });

  it('mid-guide it goes back to step 1, not on from the saved step', async () => {
    const { c, ctx, btn } = await setup();
    c.guide!.start();
    c.guide!.update({ screen: 'exchange', world: c.world, landedPlanetId: 'halcyon' });
    expect(c.guide!.current()?.step).toBe(2);
    showHowToPlay(ctx, { onClose: () => {} });
    (btn('Replay first flight') as HTMLButtonElement).click();
    expect(c.guide!.current()?.step).toBe(1);
  });

  it('in flight it uses the flight fallback instead of step 1', async () => {
    const { c, ctx, btn } = await setup();
    c.leavePlanet();
    c.pauseFlight();
    showHowToPlay(ctx, { onClose: () => {} });
    (btn('Replay first flight') as HTMLButtonElement).click();
    expect(c.guide!.current()?.step).toBe(5);
  });

  it('with no session it is disabled and says to load a pilot', async () => {
    const { ctx, root, btn } = await setup({ session: false });
    showHowToPlay(ctx, { onClose: () => {} });
    expect((btn('Replay first flight') as HTMLButtonElement).disabled).toBe(true);
    expect(root.textContent).toContain('Load a pilot first');
  });
});

describe('How to Play entry points', () => {
  it('opens from the main menu and Back returns to it', async () => {
    const { ctx, root, btn } = await setup({ session: false });
    ctx.go.mainMenu();
    btn('How to Play').click();
    expect(root.querySelector('[data-testid="how-to-play"]')).not.toBeNull();
    btn('Back').click();
    expect(root.querySelector('[data-testid="main-menu"]')).not.toBeNull();
    expect(root.querySelector('[data-testid="how-to-play"]')).toBeNull();
  });

  it('opens from the pause menu and Back returns to it', async () => {
    const { c, ctx, root, btn } = await setup();
    c.leavePlanet();
    c.pauseFlight();
    ctx.go.pause();
    btn('How to Play').click();
    expect(root.querySelector('[data-testid="how-to-play"]')).not.toBeNull();
    btn('Back').click();
    expect(root.querySelector('[data-testid="pause-menu"]')).not.toBeNull();
  });
});

describe('phone column matches the real touch controls', () => {
  it('every capitalised control it names is on a rail button or in a context button label', async () => {
    const data = await loadGameData();
    const settings = { ...DEFAULT_SETTINGS, touch: { ...DEFAULT_SETTINGS.touch, steering: 'classic' as const } };
    const c = new Controller(data, settings, new EventTarget());
    c.pilot = { id: 'p', name: 'P' };
    const parent = document.createElement('div');
    document.body.append(parent);
    mountRails({
      parent,
      controller: c,
      inputMode: new InputMode(new EventTarget(), () => settings.bindings, 'touch'),
      size: () => ({ w: 844, h: 390 }),
      autoUpdate: false,
    });
    const rail = new Set([...parent.querySelectorAll('[data-control]')].map((e) => e.textContent ?? ''));
    for (const t of ['STOP', 'FIRE', 'MSL', 'TGT', 'THR', 'II']) expect(rail, t).toContain(t);
    const w = newWorld(data);
    const labels = (['land', 'plotCourse', 'autopilotOut', 'jump', 'skipJump', 'takeControl', 'tow'] as ContextAction[])
      .map((a) => contextLabel(a, { ...w, route: ['vesk'] }, data) ?? '')
      .join(' | ');
    for (const text of Object.values(PHONE_CONTROLS)) {
      for (const token of text.match(/\b[A-Z]{2,}(?: [A-Z]{2,})*\b/g) ?? []) {
        const ok = rail.has(token) || labels.includes(token);
        expect(ok, `"${token}" in "${text}" is not a real control`).toBe(true);
      }
    }
    // Controls with no phone equivalent say so.
    expect(PHONE_CONTROLS.nearestHostile).toBe('Hold TGT');
    expect(PHONE_CONTROLS.cycleSecondary).toBe('Tap the label under MSL');
    expect(PHONE_CONTROLS.board).toBe('Board button');
    expect(PHONE_CONTROLS.faceTarget).toBe('None on phone');
    expect(PHONE_CONTROLS.nextTarget).toBe('TGT');
  });
});

describe('weapons', () => {
  it('Flying tab teaches the fire keys; no Controls row is marked coming soon', async () => {
    const { ctx, root } = await setup();
    showHowToPlay(ctx, { onClose: () => {} });
    const flying = root.querySelector('[role="tabpanel"]')!.textContent!;
    expect(flying).not.toContain('later update');
    expect(flying).toContain('fires your guns');
    tabButton(root, 'Controls').click();
    for (const id of ['firePrimary', 'fireSecondary', 'nearestHostile', 'cycleSecondary', 'board']) {
      expect(root.querySelector(`[data-action="${id}"]`)!.textContent).not.toContain('(coming soon)');
    }
  });

  it('autopilot wording covers a targeted planet and the jump point', async () => {
    const { ctx, root } = await setup();
    showHowToPlay(ctx, { onClose: () => {} });
    expect(root.querySelector('[role="tabpanel"]')!.textContent).toContain('flies to the targeted planet, or out to the jump point when nothing is targeted');
  });

  it('the replay note names where to look, by opener', async () => {
    const a = await setup();
    showHowToPlay(a.ctx, { onClose: () => {} });
    (a.btn('Replay first flight') as HTMLButtonElement).click();
    expect(a.root.textContent).toContain('Go back to the planet to see it.');
    document.body.replaceChildren();
    const b = await setup();
    b.c.leavePlanet();
    b.c.pauseFlight();
    showHowToPlay(b.ctx, { onClose: () => {} });
    (b.btn('Replay first flight') as HTMLButtonElement).click();
    expect(b.root.textContent).toContain('Resume flight to see it.');
  });
});
