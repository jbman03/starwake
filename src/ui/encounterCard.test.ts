// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { Controller } from '../app/controller';
import { loadGameData } from '../data/load';
import type { ActionId } from '../input/actions';
import { InputMode } from '../input/mode';
import { DEFAULT_SETTINGS } from '../save/settings';
import type { PilotStore } from '../save/store';
import { addNote } from '../sim/story';
import { newWorld } from '../sim/world';
import type { UiContext } from './context';
import { showEncounterCard } from './encounterCard';
import { showMissionLog } from './missionLog';

async function setup() {
  const data = await loadGameData();
  const c = new Controller(data, DEFAULT_SETTINGS, new EventTarget());
  c.beginSession({ ...newWorld(data, 1), credits: 5000 }, { id: 'p', name: 'P' }, 'halcyon');
  c.leavePlanet();
  const root = document.createElement('div');
  document.body.append(root);
  const state: { onPress?: (p: Set<ActionId>) => void } = {};
  const ctx = {
    root,
    controller: c,
    store: {} as PilotStore,
    inputMode: new InputMode(new EventTarget(), () => DEFAULT_SETTINGS.bindings, 'keyboard'),
    planetImage: () => null,
    mount: (node: HTMLElement, opts: { onPress?: (p: Set<ActionId>) => void } = {}) => {
      root.replaceChildren(node);
      state.onPress = opts.onPress;
    },
    unmount: () => root.replaceChildren(),
    go: { mainMenu() {}, planet() {}, pause() {}, map() {} },
  } as unknown as UiContext;
  const open = () => {
    c.pauseFlight();
    showEncounterCard(ctx, c.encounterView()!, (i) => c.chooseEncounter(i)?.messages ?? null);
  };
  const btn = (label: RegExp) => [...root.querySelectorAll('button')].find((b) => label.test(b.textContent ?? ''))!;
  return { c, root, ctx, state, open, btn };
}

afterEach(() => document.body.replaceChildren());

describe('encounter card', () => {
  it('disables a blocked choice and shows its reason', async () => {
    const { c, root, open, btn } = await setup();
    c.forceEncounter('cheap-goods-pedlar');
    c.world = { ...c.world, credits: 10 };
    open();
    const buy = btn(/Buy 10 t/);
    expect(buy.disabled).toBe(true);
    expect(root.textContent).toContain('Not enough credits');
    expect(btn(/Decline/).disabled).toBe(false);
  });

  it('choosing updates the world, shows the outcome, and the mission is in the log; Done resumes', async () => {
    const { c, root, ctx, state, open, btn } = await setup();
    c.forceEncounter('stranded-passenger');
    open();
    expect(c.isFlying).toBe(false);
    state.onPress!(new Set<ActionId>(['encounterChoice1']));
    expect(c.world.missions).toHaveLength(1);
    expect(root.textContent).toContain('tired passenger');
    expect(root.querySelectorAll('[data-testid="encounter-choice"]')).toHaveLength(0);
    btn(/Done/).click();
    expect(c.isFlying).toBe(true);
    expect(root.querySelector('[data-testid="encounter-card"]')).toBeNull();

    showMissionLog(ctx, () => {});
    expect(root.querySelectorAll('.sw-mc-row')).toHaveLength(1);
  });

  it('Not now on a site closes without using it; the site stays', async () => {
    const { c, open, btn } = await setup();
    c.forceEncounter('cargo-drift');
    open();
    btn(/Not now/).click();
    expect(c.isFlying).toBe(true);
    expect(c.pending).not.toBeNull();
  });

  it('Not now (and Esc) on a hail clears the hail', async () => {
    const a = await setup();
    a.c.forceEncounter('stranded-passenger');
    a.open();
    a.btn(/Not now/).click();
    expect(a.c.isFlying).toBe(true);
    expect(a.c.pending).toBeNull();

    const b = await setup();
    b.c.forceEncounter('stranded-passenger');
    b.open();
    b.state.onPress!(new Set<ActionId>(['back']));
    expect(b.c.pending).toBeNull();
    expect(b.c.isFlying).toBe(true);
  });
});

describe('mission log notes', () => {
  it('lists world notes newest first', async () => {
    const { c, root, ctx } = await setup();
    c.world = addNote(addNote(c.world, 'First rumour.'), 'Second rumour.');
    showMissionLog(ctx, () => {});
    const items = [...root.querySelectorAll('[data-testid="log-notes"] li')].map((n) => n.textContent ?? '');
    expect(items).toHaveLength(2);
    expect(items[0]).toContain('Second rumour.');
  });
});
