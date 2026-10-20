// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Controller } from '../app/controller';
import { loadGameData } from '../data/load';
import { withoutPorts } from '../data/testData';
import { InputMode } from '../input/mode';
import type { PilotStore } from '../save/store';
import { DEFAULT_SETTINGS } from '../save/settings';
import { newWorld } from '../sim/world';
import type { UiContext } from './context';
import { createUi } from './context';
import { COUNT_UP_SEC, showPlanetScreen } from './planetScreen';

async function setup(credits: number, fuel: number, bindings = DEFAULT_SETTINGS.bindings, portId = 'halcyon') {
  const data = await loadGameData();
  const settings = { ...DEFAULT_SETTINGS, bindings };
  const c = new Controller(data, settings, new EventTarget());
  const w = newWorld(data);
  c.beginSession({ ...w, credits, ship: { ...w.ship, fuel } }, { id: 'p', name: 'P' }, portId);
  const root = document.createElement('div');
  document.body.append(root);
  const calls: { map: { onClose?: () => void }[]; planet: string[]; onPress?: (p: Set<string>) => void } = { map: [], planet: [] };
  const ctx = {
    root,
    controller: c,
    store: {} as PilotStore,
    inputMode: new InputMode(new EventTarget(), () => settings.bindings, 'keyboard'),
    planetImage: () => null,
    mount: (node: HTMLElement, opts: { onPress?: (p: Set<string>) => void } = {}) => {
      root.replaceChildren(node);
      calls.onPress = opts.onPress;
    },
    unmount: () => root.replaceChildren(),
    go: {
      mainMenu() {},
      planet: (id: string) => calls.planet.push(id),
      pause() {},
      map: (opts?: { onClose?: () => void }) => calls.map.push(opts ?? {}),
    },
  } as UiContext;
  showPlanetScreen(ctx, portId);
  return { root, c, calls, ctx };
}

describe('planet screen', () => {
  it('with credits below zero, Refuel is disabled and says why', async () => {
    const { root } = await setup(-400, 100);
    const refuel = [...root.querySelectorAll('button')].find((b) => b.textContent?.startsWith('Refuel'))!;
    expect(refuel.disabled).toBe(true);
    expect(root.querySelector('.sw-reason')?.textContent).toBe('Not enough credits to buy fuel.');
    expect(root.textContent).toContain('Credits: -400 cr');
  });

  it('shows singular fuel for one jump', async () => {
    const { root } = await setup(1000, 150);
    expect(root.textContent).toContain('Fuel: 1 jump');
    expect(root.textContent).not.toContain('1 jumps');
  });

  it('the corner Map button (or N) opens the map, which returns to this planet screen', async () => {
    const { root, calls } = await setup(1000, 300);
    const map = root.querySelector<HTMLButtonElement>('.sw-panel > .sw-map-corner')!;
    expect(map.textContent).toBe('MapN');
    expect(root.querySelector('.sw-actions')!.textContent).not.toContain('Star Map');
    map.click();
    expect(calls.map).toHaveLength(1);
    calls.map[0].onClose!();
    expect(calls.planet).toEqual(['halcyon']);
    calls.onPress!(new Set(['openMap']));
    expect(calls.map).toHaveLength(2);
  });

  it('an unbound Map action shows no key chip', async () => {
    const { root } = await setup(1000, 300, { ...DEFAULT_SETTINGS.bindings, openMap: [null, null] });
    const map = root.querySelector<HTMLButtonElement>('.sw-map-corner')!;
    expect(map.textContent).toBe('Map');
    expect(map.querySelector('.sw-key')).toBeNull();
  });

  const labels = (root: HTMLElement) => [...root.querySelectorAll('.sw-actions .sw-btn-label')].map((l) => l.textContent);
  const find = (root: HTMLElement, text: string) => [...root.querySelectorAll('button')].find((b) => b.textContent?.startsWith(text))!;

  it('Halcyon offers every service, in order, with hotkey chips, plus date and cargo', async () => {
    const { root } = await setup(1000, 150);
    expect(labels(root)).toEqual(['Commodity Exchange', 'Mission Computer', 'Outfitter', 'Refuel — 300 cr', 'Mission Log', 'How to Play', 'Leave']);
    const chips = [...root.querySelectorAll('.sw-actions .sw-key')].map((k) => k.textContent);
    expect(chips).toEqual(['C', 'M', 'O', 'R', 'K', 'H', 'L']);
    expect(root.textContent).toContain('1 Mar 3207');
    expect(root.textContent).toContain('Cargo: 20/20 t');
  });

  it('a former fuel-less port (Tallow Rock) now offers Refuel', async () => {
    const { root } = await setup(1000, 150, DEFAULT_SETTINGS.bindings, 'tallow-rock');
    expect(labels(root)).toContain('Refuel — 750 cr');
    expect(find(root, 'Refuel').disabled).toBe(false);
  });

  it('a refuel-only port shows only Refuel, Mission Log and Leave', async () => {
    const { root } = await setup(1000, 150, DEFAULT_SETTINGS.bindings, 'haywain');
    expect(labels(root).map((l) => l?.split(' — ')[0])).toEqual(['Refuel', 'Mission Log', 'How to Play', 'Leave']);
  });

  it('Commodity Exchange opens the exchange; Done returns to the planet screen', async () => {
    const { root, calls } = await setup(1000, 300);
    find(root, 'Commodity Exchange').click();
    expect(root.querySelector('[data-testid="exchange"]')).not.toBeNull();
    find(root, 'Done').click();
    expect(calls.planet).toEqual(['halcyon']);
  });

  it('Mission Computer (button or M) and Mission Log (K) open their screens', async () => {
    const a = await setup(1000, 300);
    find(a.root, 'Mission Computer').click();
    expect(a.root.querySelector('[data-testid="mission-computer"]')).toBeTruthy();
    const b = await setup(1000, 300);
    b.calls.onPress!(new Set(['openMissions']));
    expect(b.root.querySelector('[data-testid="mission-computer"]')).toBeTruthy();
    const c = await setup(1000, 300);
    c.calls.onPress!(new Set(['missionLog']));
    expect(c.root.querySelector('[data-testid="mission-log"]')).toBeTruthy();
  });

  it('How to Play (button or H) opens the reference; Back returns to this planet screen', async () => {
    const a = await setup(1000, 300);
    find(a.root, 'How to Play').click();
    expect(a.root.querySelector('[data-testid="how-to-play"]')).toBeTruthy();
    find(a.root, 'Back').click();
    expect(a.calls.planet).toEqual(['halcyon']);
    const b = await setup(1000, 300);
    b.calls.onPress!(new Set(['howToPlay']));
    expect(b.root.querySelector('[data-testid="how-to-play"]')).toBeTruthy();
  });
});

describe('planet screen after a tow', () => {
  it('shows every mission the tow failed', async () => {
    const data = withoutPorts(await loadGameData(), 'vesk');
    const c = new Controller(data, DEFAULT_SETTINGS, new EventTarget());
    const w = newWorld(data, 1);
    const due = (id: string, title: string) => ({
      id, typeId: 'delivery', originId: 'halcyon', destId: 'merrow', tons: 0, passengers: 0, pay: 500,
      paidUpfront: false, deadlineDay: 0, title, description: '', cargoName: 'x',
    });
    c.beginSession({ ...w, systemId: 'vesk', ship: { ...w.ship, fuel: 0 }, missions: [due('a', 'Job A'), due('b', 'Job B')] },
      { id: 'p', name: 'P' }, 'halcyon');
    const root = document.createElement('div');
    document.body.append(root);
    createUi(root, c, {} as PilotStore, () => null, new InputMode(new EventTarget(), () => DEFAULT_SETTINGS.bindings, 'keyboard'));
    c.leavePlanet();
    c.world = { ...c.world, systemId: 'vesk' }; // leaving Halcyon put us in calder; strand us in the port-less vesk
    expect(c.callTow()).toBe(true);
    const screen = root.querySelector('[data-testid="planet-screen"]')!;
    expect(screen).toBeTruthy();
    expect(screen.textContent).toContain('Mission failed: Job A — the deadline passed.');
    expect(screen.textContent).toContain('Mission failed: Job B — the deadline passed.');
    root.remove();
  });
});

describe('credits count-up after jobs pay', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  async function paid(reduced: boolean) {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: reduced && q.includes('reduce'), media: q }));
    vi.useFakeTimers();
    const s = await setup(1000, 300);
    const job = {
      id: 'j1', typeId: 'delivery', originId: 'halcyon', destId: 'merrow', tons: 1, passengers: 0, pay: 700,
      paidUpfront: false, deadlineDay: null, title: 'T', description: '', cargoName: 'crates',
    };
    s.c.world = { ...s.c.world, missions: [job] };
    (s.c as unknown as { landAt(id: string): void }).landAt('merrow');
    expect(s.c.world.credits).toBe(1700);
    showPlanetScreen(s.ctx, 'merrow');
    return s;
  }
  const shown = (root: HTMLElement) => root.querySelector('.sw-stats')!.textContent!.match(/Credits: ([\d,-]+) cr/)![1];

  it('counts from the old value to the new one over 0.8 s', async () => {
    const { root } = await paid(false);
    expect(shown(root)).toBe('1,000');
    vi.advanceTimersByTime((COUNT_UP_SEC * 1000) / 2);
    const mid = Number(shown(root).replace(/,/g, ''));
    expect(mid).toBeGreaterThan(1000);
    expect(mid).toBeLessThan(1700);
    vi.advanceTimersByTime((COUNT_UP_SEC * 1000) / 2 + 100);
    expect(shown(root)).toBe('1,700');
  });

  it('jumps straight to the new value under prefers-reduced-motion', async () => {
    const { root } = await paid(true);
    expect(shown(root)).toBe('1,700');
  });
});
