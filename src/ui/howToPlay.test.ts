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
import { createUi } from './context';
import { controlRows, HOW_TO_PLAY_TABS, PHONE_CONTROLS, showHowToPlay } from './howToPlay';

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

  it("text tabs use the pilot's own keys", async () => {
    const { ctx, root } = await setup({ bindings: rebind(DEFAULT_SETTINGS.bindings, 'land', 0, 'KeyP') });
    showHowToPlay(ctx, { onClose: () => {} });
    expect(root.querySelector('[role="tabpanel"]')!.textContent).toContain('press P.');
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
