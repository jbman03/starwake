// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { Controller } from '../app/controller';
import { loadGameData } from '../data/load';
import type { ActionId } from '../input/actions';
import { InputMode } from '../input/mode';
import { DEFAULT_SETTINGS } from '../save/settings';
import type { PilotStore } from '../save/store';
import { cargoFree } from '../sim/cargo';
import { offersAt } from '../sim/missions';
import type { Mission } from '../sim/types';
import { newWorld } from '../sim/world';
import type { UiContext } from './context';
import { showMissionComputer } from './missionComputer';
import { showMissionLog } from './missionLog';
import { showPauseMenu } from './pauseMenu';
import { showPlanetScreen } from './planetScreen';

async function setup(patch: (w: ReturnType<typeof newWorld>) => ReturnType<typeof newWorld> = (w) => w) {
  const data = await loadGameData();
  const c = new Controller(data, DEFAULT_SETTINGS, new EventTarget());
  c.beginSession(patch({ ...newWorld(data), credits: 5000 }), { id: 'p', name: 'P' }, 'halcyon');
  const root = document.createElement('div');
  document.body.append(root);
  const state: { onPress?: (p: Set<ActionId>) => void; closed: number; maps: { initialSelection?: string; onClose?: () => void }[] } = {
    closed: 0,
    maps: [],
  };
  const ctx = {
    root,
    controller: c,
    store: {} as PilotStore,
    inputMode: new InputMode(new EventTarget(), () => DEFAULT_SETTINGS.bindings, 'keyboard'),
    planetImage: () => null,
    mount: (node: HTMLElement, opts: { onPress?: (p: Set<ActionId>) => void; cleanup?: () => void } = {}) => {
      root.replaceChildren(node);
      state.onPress = opts.onPress;
    },
    unmount: () => root.replaceChildren(),
    go: {
      mainMenu() {},
      planet() {},
      pause() {},
      map: (o: { initialSelection?: string; onClose?: () => void } = {}) => state.maps.push(o),
    },
  } as unknown as UiContext;
  const q = (t: string) => root.querySelector(`[data-testid="${t}"]`)!;
  const btn = (label: string, within: ParentNode = root) =>
    [...within.querySelectorAll('button')].find((b) => b.querySelector('.sw-btn-label')?.textContent === label)!;
  const rows = () => [...root.querySelectorAll('.sw-mc-row')];
  return { data, c, root, ctx, state, q, btn, rows };
}

afterEach(() => document.body.replaceChildren());

describe('mission computer', () => {
  it('lists 3-7 offers with the selected one described, plus date and rumor line', async () => {
    const { ctx, rows, q, c } = await setup();
    showMissionComputer(ctx, 'halcyon', () => {});
    expect(rows().length).toBeGreaterThanOrEqual(3);
    expect(rows().length).toBeLessThanOrEqual(7);
    expect(rows()[0].getAttribute('aria-selected')).toBe('true');
    const first = c.offers()[0];
    expect(q('mc-detail').textContent).toContain(first.title);
    expect(q('mc-detail').textContent).toContain(first.description);
    expect(q('mc-detail').textContent).toContain('Pays');
    expect(q('mc-stats').textContent).toContain('1 Mar 3207');
    expect(q('mc-rumor')).toBeTruthy();
  });

  it('accepting moves the job into the log, takes cargo space and keeps the selection on the next job', async () => {
    const { ctx, c, rows, btn, q } = await setup();
    showMissionComputer(ctx, 'halcyon', () => {});
    // First job we can take that carries cargo.
    const offers = c.offers();
    const pick = offers.findIndex((o) => o.tons > 0 && o.tons <= 20);
    expect(pick).toBeGreaterThanOrEqual(0);
    rows()[pick].dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const target = offers[pick];
    const next = offers[pick + 1];
    const free0 = cargoFree(c.world, c.data);
    btn('Accept Mission').click();
    expect(c.world.missions.map((m) => m.id)).toEqual([target.offerId]);
    expect(cargoFree(c.world, c.data)).toBe(free0 - target.tons);
    expect(rows().length).toBe(offers.length - 1);
    expect(rows().some((r) => r.getAttribute('data-offer') === target.offerId)).toBe(false);
    if (next) expect(q('mc-detail').textContent).toContain(next.title);
    expect(q('mc-message').textContent).toContain('Accepted');
  });

  it('Enter accepts and Up/Down move the selection', async () => {
    const { ctx, c, rows } = await setup();
    showMissionComputer(ctx, 'halcyon', () => {});
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'ArrowDown' }));
    expect(rows()[1].getAttribute('aria-selected')).toBe('true');
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'ArrowUp' }));
    expect(rows()[0].getAttribute('aria-selected')).toBe('true');
    const id = c.offers()[0].offerId;
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Enter' }));
    expect(c.world.missions.length === 1 || c.world.takenOffers.includes(id)).toBe(true);
  });

  it('a 20-40 t shipment shows Accept disabled with the cargo space reason', async () => {
    const { ctx, c, data, rows, btn, q } = await setup();
    // Find a day on which Halcyon posts a shipment (needs 20+ t of a 20 t hold: not takeable once any cargo is aboard).
    let day = 0;
    let index = -1;
    for (; day < 200 && index < 0; day++) {
      index = offersAt({ ...c.world, day }, data, 'halcyon').findIndex((o) => o.typeId === 'shipment');
    }
    expect(index).toBeGreaterThanOrEqual(0);
    c.world = { ...c.world, day: day - 1, cargo: { ...c.world.cargo, [Object.keys(data.commodities)[0]]: 5 } };
    showMissionComputer(ctx, 'halcyon', () => {});
    rows()[index].dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(btn('Accept Mission').disabled).toBe(true);
    expect(q('mc-reason').textContent).toBe('Not enough cargo space');
  });

  it('Done and Esc close it', async () => {
    const { ctx, state, btn } = await setup();
    let closed = 0;
    showMissionComputer(ctx, 'halcyon', () => closed++);
    state.onPress!(new Set(['back']));
    expect(closed).toBe(1);
    showMissionComputer(ctx, 'halcyon', () => closed++);
    btn('Done').click();
    expect(closed).toBe(2);
  });
});

const job = (over: Partial<Mission> = {}): Mission => ({
  id: 'j1',
  typeId: 'delivery',
  originId: 'halcyon',
  destId: 'merrow',
  tons: 4,
  passengers: 0,
  pay: 700,
  paidUpfront: false,
  deadlineDay: 5,
  title: 'Deliver rations to Merrow',
  description: 'Rations needed.',
  cargoName: 'rations',
  ...over,
});

describe('mission log', () => {
  it('shows destination, deadline with days left, load and pay', async () => {
    const { ctx, q, data } = await setup((w) => ({ ...w, missions: [job()] }));
    showMissionLog(ctx, () => {});
    const text = q('log-detail').textContent!;
    expect(text).toContain(`Merrow, ${data.systems[data.planets.merrow.systemId].name} system`);
    expect(text).toContain('6 Mar 3207 (5 days left)');
    expect(text).toContain('4 t of rations');
    expect(text).toContain('700 cr');
  });

  it('says "No deadline" for open-ended jobs and has an empty state', async () => {
    const { ctx, q } = await setup((w) => ({ ...w, missions: [job({ deadlineDay: null })] }));
    showMissionLog(ctx, () => {});
    expect(q('log-detail').textContent).toContain('No deadline');
    const e = await setup();
    showMissionLog(e.ctx, () => {});
    expect(e.root.textContent).toContain('No active missions.');
  });

  it('Abandon asks first, then removes the job and frees its cargo', async () => {
    const { ctx, c, root, btn, rows } = await setup((w) => ({ ...w, missions: [job()] }));
    showMissionLog(ctx, () => {});
    const before = cargoFree(c.world, c.data);
    btn('Abandon').click();
    const dialog = root.querySelector<HTMLElement>('.sw-dialog')!;
    expect(dialog).toBeTruthy();
    btn('Cancel', dialog).click();
    await Promise.resolve();
    expect(c.world.missions.length).toBe(1);
    btn('Abandon').click();
    btn('Abandon', root.querySelector<HTMLElement>('.sw-dialog')!).click();
    await new Promise((r) => setTimeout(r, 0));
    expect(c.world.missions.length).toBe(0);
    expect(cargoFree(c.world, c.data)).toBe(before + 4);
    expect(rows().length).toBe(0);
  });

  it('Show on map opens the map on the destination system; closing it brings the log back', async () => {
    const { ctx, state, data, btn, root } = await setup((w) => ({ ...w, missions: [job()] }));
    showMissionLog(ctx, () => {});
    btn('Show on map').click();
    expect(state.maps).toHaveLength(1);
    expect(state.maps[0].initialSelection).toBe(data.planets.merrow.systemId);
    state.maps[0].onClose!();
    expect(root.querySelector('[data-testid="mission-log"]')).toBeTruthy();
  });

  it('opens from the pause menu and returns to it', async () => {
    const { ctx, root, btn } = await setup();
    showPauseMenu(ctx);
    btn('Mission Log').click();
    expect(root.querySelector('[data-testid="mission-log"]')).toBeTruthy();
    btn('Done').click();
    expect(root.querySelector('[data-testid="pause-menu"]')).toBeTruthy();
  });
});

describe('pause menu and dialogs', () => {
  it('the pause menu Mission Log button has no hotkey chip (the pause menu does not handle K)', async () => {
    const { ctx, btn } = await setup();
    showPauseMenu(ctx);
    expect(btn('Mission Log').querySelector('.sw-key')).toBeNull();
  });

  it('arrows do not move the log selection behind the Abandon dialog', async () => {
    const { ctx, root, btn, rows } = await setup((w) => ({ ...w, missions: [job(), job({ id: 'j2', title: 'Second job' })] }));
    showMissionLog(ctx, () => {});
    btn('Abandon').click();
    expect(root.querySelector('.sw-dialog')).toBeTruthy();
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'ArrowDown' }));
    expect(rows()[0].getAttribute('aria-selected')).toBe('true');
  });
});

describe('completion dialog', () => {
  it('lists each completed mission and the total paid when the planet screen opens after a landing', async () => {
    const m1 = job({ id: 'a', destId: 'halcyon', title: 'Deliver rations to Halcyon', pay: 700 });
    const m2 = job({ id: 'b', destId: 'halcyon', title: 'Ferry settlers to Halcyon', pay: 1200, tons: 0, passengers: 2 });
    const { ctx, root, c } = await setup((w) => ({ ...w, missions: [m1, m2] }));
    const credits = c.world.credits;
    showPlanetScreen(ctx, 'halcyon');
    const dialog = root.querySelector('.sw-dialog')!;
    expect(dialog.textContent).toContain('Mission complete: Deliver rations to Halcyon');
    expect(dialog.textContent).toContain('Mission complete: Ferry settlers to Halcyon');
    expect(dialog.textContent).toContain('Paid 1,900 cr.');
    expect(c.world.credits).toBe(credits);
    expect(c.world.missions).toEqual([]);
    // Shown once: reopening the planet screen does not repeat it.
    root.replaceChildren();
    showPlanetScreen(ctx, 'halcyon');
    expect(root.querySelector('.sw-dialog')).toBeNull();
  });

  it('no dialog when nothing was completed', async () => {
    const { ctx, root } = await setup();
    showPlanetScreen(ctx, 'halcyon');
    expect(root.querySelector('.sw-dialog')).toBeNull();
  });
});
