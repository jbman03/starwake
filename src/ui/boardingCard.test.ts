// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { Controller } from '../app/controller';
import { hostileAhead } from '../app/combatControl';
import { loadGameData } from '../data/load';
import type { ActionId } from '../input/actions';
import { InputMode } from '../input/mode';
import { DEFAULT_SETTINGS } from '../save/settings';
import type { PilotStore } from '../save/store';
import { captureSucceeds } from '../sim/boarding';
import { newWorld } from '../sim/world';
import type { UiContext } from './context';
import { showBoardingCard } from './boardingCard';

const DT = 1 / 60;

/** A controller flying beside a disabled raider `shipId` 30 px away, whose capture attempt `succeeds` (or not). */
async function setup(opts: { shipId?: string; capture?: boolean; mine?: Record<string, number>; trader?: boolean } = {}) {
  const data = await loadGameData();
  const shipId = opts.shipId ?? 'shuttle';
  let world = newWorld(data, 1);
  if (opts.capture !== undefined) {
    for (let seed = 1; seed < 400; seed++) {
      world = newWorld(data, seed);
      const probe = hostileAhead(world, { npcs: [], targetId: null } as never, data, shipId);
      if (captureSucceeds(world, data, probe.traffic.npcs[0]) === opts.capture) break;
    }
  }
  world = { ...world, credits: 5000, outfits: { ...world.outfits, ...opts.mine } };
  const c = new Controller(data, DEFAULT_SETTINGS, new EventTarget());
  c.beginSession(world, { id: 'p', name: 'P' }, 'halcyon');
  c.leavePlanet();
  const r = hostileAhead(c.world, c.traffic, data, shipId);
  c.traffic = {
    ...r.traffic,
    npcs: r.traffic.npcs.map((n) =>
      n.id === r.id ? { ...n, role: opts.trader ? ('trader' as const) : n.role, engaged: false, hull: { ...n.hull, armor: 1, disabled: true }, ship: { ...n.ship, pos: { x: c.world.ship.pos.x + 30, y: c.world.ship.pos.y }, vel: { ...c.world.ship.vel } } } : n,
    ),
  };
  const root = document.createElement('div');
  document.body.append(root);
  const state: { onPress?: (p: Set<ActionId>) => void } = {};
  const ctx = {
    root,
    controller: c,
    store: {} as PilotStore,
    inputMode: new InputMode(new EventTarget(), () => DEFAULT_SETTINGS.bindings, 'keyboard'),
    planetImage: () => null,
    mount: (node: HTMLElement, o: { onPress?: (p: Set<ActionId>) => void } = {}) => {
      root.replaceChildren(node);
      state.onPress = o.onPress;
    },
    unmount: () => root.replaceChildren(),
    go: { mainMenu() {}, planet() {}, pause() {}, map() {} },
  } as unknown as UiContext;
  const open = () => {
    expect(c.board()).toBe(true);
    showBoardingCard(ctx, c);
  };
  const btn = (label: RegExp) => [...root.querySelectorAll('button')].find((b) => label.test(b.textContent ?? ''))!;
  const press = (...a: ActionId[]) => state.onPress!(new Set(a));
  const run = (sec: number) => {
    c.startFlight();
    for (let i = 0; i < Math.round(sec / DT); i++) c.update(DT);
    c.pauseFlight();
  };
  return { c, data, root, ctx, state, open, btn, press, run, id: r.id };
}

afterEach(() => document.body.replaceChildren());

describe('boarding card', () => {
  it('lists loot rows with hotkeys', async () => {
    const { c, root, open, btn } = await setup();
    open();
    expect(c.isFlying).toBe(false);
    expect(root.querySelector('[data-testid="boarding-card"]')).not.toBeNull();
    expect(btn(/Take credits \(\d+ cr\)/)).toBeTruthy();
    expect(btn(/Take cargo \(\d+ t\)/)).toBeTruthy();
    expect(btn(/Take ammo \(\d+\)/)).toBeTruthy();
    expect(btn(/Attempt capture \(\d+%\)/)).toBeTruthy();
    const keys = [...root.querySelectorAll('[data-testid="boarding-choice"] .sw-key')].map((k) => k.textContent);
    expect(keys).toEqual(['1', '2', '3', '4', '5']);
    expect(btn(/Leave/).querySelector('.sw-key')?.textContent).toBe('5');
  });

  it('take cargo with hotkey 2, then leave resumes flight', async () => {
    const { c, root, open, press, btn } = await setup({ shipId: 'mule', trader: true });
    open();
    const held = () => Object.values(c.world.cargo).reduce((a, b) => a + b, 0);
    expect(held()).toBe(0);
    press('encounterChoice2');
    expect(held()).toBeGreaterThan(0);
    expect(btn(/Take cargo/).disabled).toBe(true);
    const gained = held();
    press('encounterChoice2');
    expect(held()).toBe(gained);
    expect(root.querySelector('[data-testid="boarding-card"]')).not.toBeNull();
    press('encounterChoice5'); // Leave
    expect(c.isFlying).toBe(true);
    expect(root.querySelector('[data-testid="boarding-card"]')).toBeNull();
  });

  it('take credits with hotkey 1 once; Esc leaves', async () => {
    const { c, open, press } = await setup({ shipId: 'mule' });
    open();
    const before = c.world.credits;
    press('encounterChoice1');
    const credits = c.world.credits;
    expect(credits).toBeGreaterThan(before);
    press('encounterChoice1');
    expect(c.world.credits).toBe(credits);
    expect(c.boardingView()!.rows.map((r) => r.id)).toEqual(['credits', 'cargo', 'ammo', 'capture']);
    press('back');
    expect(c.isFlying).toBe(true);
  });

  it('take ammo with hotkey 3 fills a launcher', async () => {
    const { c, open, press } = await setup({ shipId: 'kestrel', mine: { 'rocket-rack': 1 } });
    open();
    expect(c.world.outfits.rocket ?? 0).toBe(0);
    press('encounterChoice3');
    expect(c.world.outfits.rocket).toBeGreaterThan(0);
    expect(c.boardingView()!.rows[2].used).toBe(true);
  });

  it('capture success shows command and prize', async () => {
    const { c, root, open, press, btn } = await setup({ capture: true });
    open();
    press('encounterChoice4');
    expect(c.boardingView()!.stage).toBe('captured');
    expect(btn(/Take command/)).toBeTruthy();
    expect(btn(/Sell as prize \(\d+ cr\)/)).toBeTruthy();
    expect(root.textContent).not.toContain('drives your party off');
    expect(c.world.stats.captures).toBe(0); // not counted until she is taken or sold
  });

  it('sell as prize pays, counts the capture and removes the wreck', async () => {
    const { c, open, press, btn, id } = await setup({ capture: true });
    open();
    press('encounterChoice4');
    const credits = c.world.credits;
    btn(/Sell as prize/).click();
    expect(c.world.credits).toBe(credits + 3000);
    expect(c.world.stats.captures).toBe(1);
    expect(c.traffic.npcs.some((n) => n.id === id)).toBe(false);
    btn(/Done/).click();
    expect(c.isFlying).toBe(true);
  });

  it('take command swaps ships at 25% armor and no shields', async () => {
    const { c, data, open, press, btn, id } = await setup({ capture: true, shipId: 'courier' });
    c.traffic = { ...c.traffic, targetId: id };
    open();
    press('encounterChoice4');
    btn(/Take command/).click();
    expect(c.world.shipId).toBe('courier');
    expect(c.combat.battle.player.armor).toBeCloseTo(c.combat.battle.player.maxArmor * 0.25);
    expect(c.combat.battle.player.shields).toBe(0);
    expect(c.combat.battle.player.maxArmor).toBeGreaterThan(0);
    expect(c.combat.battle.player.disabled).toBe(false);
    expect(c.traffic.npcs.some((n) => n.id === id)).toBe(false);
    expect(c.traffic.targetId).toBeNull();
    expect(data.ships.courier).toBeTruthy();
  });

  it('command blocked shows its reason', async () => {
    const { c, root, open, press, btn } = await setup({ capture: true, shipId: 'shuttle' });
    c.world = { ...c.world, cargo: { food: 19 }, missions: [] };
    // Her hold is the shuttle's 20 t; load more than that.
    c.world = { ...c.world, cargo: { food: 25 } };
    open();
    press('encounterChoice4');
    const take = btn(/Take command/);
    expect(take.disabled).toBe(true);
    expect(root.textContent).toContain("Her hold can't take your cargo");
    expect(c.boardChoose('command')).toBeNull();
    expect(c.world.shipId).toBe('shuttle');
  });

  it('failed capture scuttles the ship after 3 s', async () => {
    const { c, root, open, press, btn, run, id } = await setup({ capture: false });
    const hull = { ...c.combat.battle.player };
    const events: string[] = [];
    c.on('battle', (e) => e.events.forEach((x) => x.type === 'destroyed' && events.push(x.id)));
    open();
    press('encounterChoice4');
    expect(root.textContent).toContain('The crew drives your party off.');
    expect(btn(/Attempt capture/).disabled).toBe(true);
    for (const re of [/Take credits/, /Take cargo/, /Take ammo/]) expect(btn(re).disabled).toBe(true);
    expect(btn(/Leave/).disabled).toBe(false);
    press('back');
    expect(c.isFlying).toBe(true);
    run(2.5);
    expect(c.traffic.npcs.some((n) => n.id === id)).toBe(true);
    run(1);
    expect(c.traffic.npcs.some((n) => n.id === id)).toBe(false);
    expect(events).toEqual([id]);
    expect(c.combat.battle.player.armor).toBe(hull.armor);
    expect(c.combat.battle.player.shields).toBe(hull.shields);
  });

  it('capturing a trader angers its government', async () => {
    const { c, data, open, press, id } = await setup({ capture: true });
    c.traffic = { ...c.traffic, npcs: c.traffic.npcs.map((n) => (n.id === id ? { ...n, role: 'trader' as const, government: 'concord' } : n)) };
    const messages: string[] = [];
    c.on('message', (e) => messages.push(e.text));
    open();
    press('encounterChoice4');
    expect(c.combat.battle.angry).toContain('concord');
    expect(c.world.standing.concord).toBe('cool');
    expect(data.governments.concord).toBeTruthy();
  });
});
