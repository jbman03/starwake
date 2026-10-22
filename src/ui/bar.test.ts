// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { Controller } from '../app/controller';
import { loadGameData } from '../data/load';
import type { GameData, StoryMissionDef } from '../data/schemas';
import type { ActionId } from '../input/actions';
import { InputMode } from '../input/mode';
import { DEFAULT_SETTINGS } from '../save/settings';
import type { PilotStore } from '../save/store';
import { newWorld } from '../sim/world';
import { showBar } from './bar';
import type { UiContext } from './context';
import { showPlanetScreen } from './planetScreen';

const mk = (over: Partial<StoryMissionDef> & Pick<StoryMissionDef, 'id'>): StoryMissionDef => ({
  arc: 'side',
  title: `Title ${over.id}`,
  giver: { name: 'Ansel Voss', title: 'Dockmaster' },
  offer: { where: 'bar', ports: ['halcyon'] },
  text: `Offer text ${over.id}`,
  acceptText: `Accept text ${over.id}`,
  declinable: true,
  steps: [{ kind: 'land', planet: 'merrow', text: 'Land at Merrow.' }],
  onComplete: [],
  ...over,
});
const light = mk({ id: 'light' });
const heavy = mk({
  id: 'heavy',
  giver: { name: 'Orla Penn', title: 'Broker' },
  steps: [{ kind: 'deliver', planet: 'merrow', cargo: { name: 'Ore', tons: 999 }, text: 'Deliver the ore.' }],
});

async function setup(...defs: StoryMissionDef[]) {
  const real = await loadGameData();
  const data: GameData = { ...real, story: Object.fromEntries(defs.map((d) => [d.id, d])) };
  const c = new Controller(data, DEFAULT_SETTINGS, new EventTarget());
  c.beginSession({ ...newWorld(data, 1), day: 10 }, { id: 'p', name: 'P' }, 'halcyon');
  const root = document.createElement('div');
  document.body.append(root);
  const state: { cleanup?: () => void; onPress?: (p: Set<ActionId>) => void; maps: unknown[] } = { maps: [] };
  const ctx = {
    root,
    controller: c,
    store: {} as PilotStore,
    inputMode: new InputMode(new EventTarget(), () => DEFAULT_SETTINGS.bindings, 'keyboard'),
    planetImage: () => null,
    mount: (node: HTMLElement, opts: { onPress?: (p: Set<ActionId>) => void; cleanup?: () => void } = {}) => {
      state.cleanup?.();
      state.cleanup = opts.cleanup;
      root.replaceChildren(node);
      state.onPress = opts.onPress;
    },
    unmount: () => root.replaceChildren(),
    go: { mainMenu() {}, planet() {}, pause() {}, map: (o: unknown) => state.maps.push(o) },
  } as unknown as UiContext;
  const q = (t: string) => root.querySelector(`[data-testid="${t}"]`)!;
  const btn = (label: string) => [...root.querySelectorAll('button')].find((b) => b.querySelector('.sw-btn-label')?.textContent === label)!;
  const rows = () => [...root.querySelectorAll('.sw-mc-row')];
  return { data, c, root, ctx, state, q, btn, rows };
}

afterEach(() => document.body.replaceChildren());

describe('spaceport bar', () => {
  it('lists each offer by giver and mission title, with the selected offer described and gossip shown', async () => {
    const { ctx, q, rows, data } = await setup(light, heavy);
    showBar(ctx, 'halcyon', () => {});
    expect(rows()).toHaveLength(2);
    expect(rows()[0].textContent).toContain('Ansel Voss, Dockmaster');
    expect(rows()[0].textContent).toContain('Title light');
    expect(rows()[0].getAttribute('aria-selected')).toBe('true');
    expect(q('bar-detail').textContent).toContain('Offer text light');
    expect(q('bar-gossip').textContent).toContain('Gossip');
    expect(q('bar-gossip').textContent).toContain(data.planets.halcyon.description);
  });

  it('Accept moves the mission to active and shows its acceptText', async () => {
    const { ctx, c, btn, q, rows } = await setup(light);
    showBar(ctx, 'halcyon', () => {});
    btn('Accept').click();
    expect(c.world.story.active.map((a) => a.id)).toEqual(['light']);
    expect(q('bar-detail').textContent).toContain('Accept text light');
    expect(q('bar-message').textContent).toContain('Accepted');
    expect(rows()).toHaveLength(0);
  });

  it('Enter accepts the selected offer and Down selects the next', async () => {
    const { ctx, c, rows } = await setup(light, heavy);
    showBar(ctx, 'halcyon', () => {});
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'ArrowDown' }));
    expect(rows()[1].getAttribute('aria-selected')).toBe('true');
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'ArrowUp' }));
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Enter' }));
    expect(c.world.story.active.map((a) => a.id)).toEqual(['light']);
  });

  it('a blocked accept is disabled and shows its reason', async () => {
    const { ctx, c, btn, q } = await setup(heavy);
    showBar(ctx, 'halcyon', () => {});
    expect(btn('Accept').disabled).toBe(true);
    expect(q('bar-reason').textContent).toBe('Not enough free hold');
    btn('Accept').click();
    expect(c.world.story.active).toEqual([]);
  });

  it('Decline is hidden when the mission cannot be put off', async () => {
    const { ctx, btn } = await setup(mk({ id: 'firm', declinable: false }));
    showBar(ctx, 'halcyon', () => {});
    expect(btn('Decline').hidden).toBe(true);
  });

  it('Decline hides the offer for today', async () => {
    const { ctx, c, btn, rows } = await setup(light);
    showBar(ctx, 'halcyon', () => {});
    btn('Decline').click();
    expect(rows()).toHaveLength(0);
    expect(c.storyOffers()).toEqual([]);
    expect(c.world.story.active).toEqual([]);
    c.world = { ...c.world, day: c.world.day + 1 };
    expect(c.storyOffers().map((d) => d.id)).toEqual(['light']);
  });

  it('with no offers it says so, and Done closes', async () => {
    const { ctx, q, btn, rows, root } = await setup();
    let closed = 0;
    showBar(ctx, 'halcyon', () => closed++);
    expect(rows()).toHaveLength(0);
    expect(q('bar-list').textContent).toContain('Nobody here');
    btn('Done').click();
    expect(closed).toBe(1);
    expect(root.querySelector('[data-testid="bar"]')).toBeNull();
  });

  it('shows the next lead only when it points to a different port', async () => {
    const far = await setup(mk({ id: 'far', offer: { where: 'bar', ports: ['merrow'] } }));
    showBar(far.ctx, 'halcyon', () => {});
    expect(far.q('bar-lead').textContent).toContain('Merrow');
    document.body.replaceChildren();
    const here = await setup(light);
    showBar(here.ctx, 'halcyon', () => {});
    expect(here.q('bar-lead').textContent).toBe('');
  });

  it('the corner Map button opens the map', async () => {
    const { ctx, state, root } = await setup(light);
    showBar(ctx, 'halcyon', () => {});
    (root.querySelector('.sw-map-corner') as HTMLButtonElement).click();
    expect(state.maps).toHaveLength(1);
  });
});

describe('planet screen bar service', () => {
  it('Halcyon has a Spaceport Bar button and B opens it; a port without the service has neither', async () => {
    const { ctx, root, state } = await setup(light);
    showPlanetScreen(ctx, 'halcyon');
    const btn = [...root.querySelectorAll('button')].find((b) => b.textContent?.startsWith('Spaceport Bar'))!;
    expect(btn).toBeTruthy();
    expect(btn.textContent).toContain('B');
    state.onPress!(new Set(['openBar']));
    expect(root.querySelector('[data-testid="bar"]')).not.toBeNull();
    showPlanetScreen(ctx, 'the-midden');
    expect([...root.querySelectorAll('button')].some((b) => b.textContent?.startsWith('Spaceport Bar'))).toBe(false);
    state.onPress!(new Set(['openBar']));
    expect(root.querySelector('[data-testid="bar"]')).toBeNull();
  });
});
