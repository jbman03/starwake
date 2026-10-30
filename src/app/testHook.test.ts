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
    c.dispose();
  });
});
