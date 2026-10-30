// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { createStore } from 'idb-keyval';
import { afterEach, describe, expect, it } from 'vitest';
import { Controller, MSG_USED_BACKUP } from '../app/controller';
import { loadGameData } from '../data/load';
import type { ActionId } from '../input/actions';
import { InputMode } from '../input/mode';
import { DEFAULT_SETTINGS } from '../save/settings';
import { PilotStore } from '../save/store';
import { POD_ID } from '../sim/death';
import { newWorld } from '../sim/world';
import type { UiContext } from './context';
import { showDestroyedCard } from './destroyedCard';

const DT = 1 / 60;
let n = 0;

async function setup(opts: { pod?: boolean; save?: boolean } = {}) {
  const data = await loadGameData();
  const store = new PilotStore(createStore(`destroyed-${n++}`, 'kv'));
  const c = new Controller(data, DEFAULT_SETTINGS, new EventTarget());
  const w = newWorld(data, 1);
  c.beginSession({ ...w, credits: 1234, outfits: { ...w.outfits, ...(opts.pod ? { [POD_ID]: 1 } : {}) } }, { id: 'p', name: 'P' }, 'halcyon');
  c.store = store;
  if (opts.save !== false) await c.save();
  c.leavePlanet();
  const root = document.createElement('div');
  document.body.append(root);
  const calls: string[] = [];
  const state: { onPress?: (p: Set<ActionId>) => void } = {};
  const ctx = {
    root,
    controller: c,
    store,
    inputMode: new InputMode(new EventTarget(), () => DEFAULT_SETTINGS.bindings, 'keyboard'),
    planetImage: () => null,
    mount: (node: HTMLElement, o: { onPress?: (p: Set<ActionId>) => void } = {}) => {
      root.replaceChildren(node);
      state.onPress = o.onPress;
    },
    unmount: () => root.replaceChildren(),
    go: { mainMenu: () => calls.push('mainMenu'), planet: (id: string) => calls.push(`planet:${id}`), pause() {}, map() {} },
  } as unknown as UiContext;
  const btn = (label: RegExp) => [...root.querySelectorAll('button')].find((b) => label.test(b.textContent ?? ''))!;
  /** Fly until the destroyed event fires; returns its tick count. */
  const destroy = (): number => {
    let fired = 0;
    c.on('destroyed', () => fired++);
    c.startFlight();
    c.combat.battle = { ...c.combat.battle, player: { ...c.combat.battle.player, armor: 0, disabled: true }, playerDestroyed: true };
    let ticks = 0;
    while (!fired && ticks < 600) {
      c.update(DT);
      ticks++;
    }
    return ticks;
  };
  return { c, store, root, ctx, calls, state, btn, destroy };
}

afterEach(() => document.body.replaceChildren());

describe('destroyed event', () => {
  it('fires 2 s after the player is destroyed', async () => {
    const { destroy } = await setup();
    const ticks = destroy();
    expect(ticks).toBeGreaterThanOrEqual(119);
    expect(ticks).toBeLessThanOrEqual(122);
  });
});

describe('after destruction', () => {
  it('no tow can be called in the 2 s window', async () => {
    const { c } = await setup();
    c.update(DT);
    c.combat.battle = { ...c.combat.battle, player: { ...c.combat.battle.player, armor: 0, disabled: true }, playerDestroyed: true };
    for (let i = 0; i < 100; i++) c.update(DT);
    c.combat.disabledCalmSec = 99;
    expect(c.towDestination()).toBeNull();
    expect(c.callTow()).toBe(false);
    expect(c.deathView()).not.toBeNull();
  });

  it('the used-backup notice reaches the planet screen', async () => {
    const { c, store, destroy } = await setup({ pod: false });
    const real = store.load.bind(store);
    c.store = { save: (p) => store.save(p), load: async (id) => ({ ...(await real(id)), usedBackup: true }) };
    destroy();
    await c.continueAfterDeath();
    expect(c.takeNotices()).toContain(MSG_USED_BACKUP);
  });
});

describe('destroyed card', () => {
  it('with a pod wakes at the rescue port with autosave', async () => {
    const { c, store, root, ctx, btn, calls, destroy } = await setup({ pod: true });
    destroy();
    expect(c.deathView()).toEqual({ pod: true });
    showDestroyedCard(ctx, c.deathView()!);
    expect(root.textContent).toContain('Your ship is destroyed.');
    expect(root.textContent).toContain('Your escape pod got you clear.');
    btn(/Wake up/).click();
    await c.lastSave;
    await new Promise((r) => setTimeout(r, 0));
    expect(c.landedPlanetId).not.toBeNull();
    expect(c.world.shipId).toBe(c.data.config.startShipId);
    expect(c.world.outfits[POD_ID]).toBeUndefined();
    const saved = (await store.load('p')).pilot;
    expect(saved.planetId).toBe(c.landedPlanetId);
    expect(saved.shipId).toBe(c.data.config.startShipId);
    expect(c.deathView()).toBeNull();
    expect(calls).not.toContain('mainMenu');
  });

  it('without a pod reloads the last save', async () => {
    const { c, root, ctx, btn, destroy } = await setup({ pod: false });
    c.world = { ...c.world, credits: 1 };
    destroy();
    expect(c.deathView()).toEqual({ pod: false });
    showDestroyedCard(ctx, c.deathView()!);
    expect(root.textContent).toContain('Your ship is lost.');
    btn(/Load last save/).click();
    await new Promise((r) => setTimeout(r, 20));
    expect(c.world.credits).toBe(1234);
    expect(c.landedPlanetId).toBe('halcyon');
    expect(c.pilot?.id).toBe('p');
  });

  it('no save goes to the main menu', async () => {
    const { c, ctx, btn, destroy, calls, store } = await setup({ pod: false, save: false });
    expect(await store.list()).toHaveLength(0);
    destroy();
    showDestroyedCard(ctx, c.deathView()!);
    btn(/Load last save/).click();
    await new Promise((r) => setTimeout(r, 20));
    expect(calls).toContain('mainMenu');
    expect(c.pilot).toBeNull();
  });
});
