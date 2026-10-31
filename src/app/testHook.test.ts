// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { testFlags, testHookActive } from './testHook';

afterEach(() => vi.unstubAllEnvs());

describe('test hook gating', () => {
  it('is active in dev builds', () => {
    vi.stubEnv('DEV', true);
    expect(testHookActive()).toBe(true);
    expect(testFlags('?crash=1').crash).toBe(true);
    expect(testFlags('?test&calm=1').calm).toBe(true);
    expect(testFlags('?test').calm).toBeUndefined();
  });

  it('is never active in production, even when the URL mentions test', () => {
    vi.stubEnv('DEV', false);
    (window as unknown as { happyDOM: { setURL(url: string): void } }).happyDOM.setURL('https://example.test/starwake/?test&crash=1&baddata=1&calm=1');
    expect(testHookActive()).toBe(false);
    expect(testFlags('?test&crash=1&baddata=1&calm=1')).toEqual({ crash: false });
  });
});

describe('combat test hooks', () => {
  it('spawnHostile, disableTarget and combatState', async () => {
    vi.stubEnv('DEV', true);
    const { testData } = await import('../data/testData');
    const { DEFAULT_SETTINGS } = await import('../save/settings');
    const { Controller } = await import('./controller');
    const { installTestHook } = await import('./testHook');
    const data = testData();
    const c = new Controller(data, { ...DEFAULT_SETTINGS }, new EventTarget());
    installTestHook(c, data, {} as never);
    const hook = window.__starwake!;
    expect(hook.disableTarget()).toBe(false);
    const id = hook.spawnHostile();
    const npc = hook.combatState().npcs.find((n) => n.id === id)!;
    expect(npc).toMatchObject({ role: 'raider', hostile: true });
    expect(npc.hull.disabled).toBe(false);
    c.targetShip(id);
    expect(hook.disableTarget()).toBe(true);
    expect(hook.combatState().npcs.find((n) => n.id === id)!.hull).toMatchObject({ armor: 1, disabled: true });
    expect(hook.combatState().player.disabled).toBe(false);
    expect(hook.combatState().secondary).toBeNull();
    expect(hook.jumpPhase()).toBeNull();
    c.world = { ...c.world, jump: { toSystemId: 'vesk', phase: 'charge', t: 0 } };
    expect(hook.jumpPhase()).toBe('charge');
    c.dispose();
  });
});

describe('law test hooks', () => {
  it('spawnPatrol adds a peaceful patrol of the system government in scan range, or of a named one', async () => {
    vi.stubEnv('DEV', true);
    const { testData } = await import('../data/testData');
    const { DEFAULT_SETTINGS } = await import('../save/settings');
    const { Controller } = await import('./controller');
    const { installTestHook } = await import('./testHook');
    const data = testData();
    const c = new Controller(data, { ...DEFAULT_SETTINGS }, new EventTarget());
    installTestHook(c, data, {} as never);
    const hook = window.__starwake!;
    const gov = data.systems[c.world.systemId].government;
    const id = hook.spawnPatrol();
    const npc = c.traffic.npcs.find((n) => n.id === id)!;
    expect(npc).toMatchObject({ role: 'patrol', government: gov, engaged: false, peaceful: false, demand: false });
    expect(Math.hypot(npc.ship.pos.x - c.world.ship.pos.x, npc.ship.pos.y - c.world.ship.pos.y)).toBeLessThanOrEqual(data.law.scanRange);
    expect(hook.combatState().npcs.find((n) => n.id === id)!.hostile).toBe(false);
    const other = Object.keys(data.governments).find((g) => g !== gov && g !== 'raiders')!;
    const id2 = hook.spawnPatrol(other);
    expect(id2).not.toBe(id);
    expect(c.traffic.npcs.find((n) => n.id === id2)!.government).toBe(other);
    expect(() => hook.spawnPatrol('raiders')).toThrow(/keeps no law/);
    c.dispose();
  });
});
