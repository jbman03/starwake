// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Controller } from '../app/controller';
import { loadGameData } from '../data/load';
import type { ActionId } from '../input/actions';
import { InputMode } from '../input/mode';
import { DEFAULT_SETTINGS } from '../save/settings';
import type { PilotStore } from '../save/store';
import { displayLevel, priceOf } from '../sim/economy';
import { newWorld } from '../sim/world';
import type { UiContext } from './context';
import { LONG_PRESS_MS, showExchange } from './exchange';

async function setup(credits = 100_000) {
  const data = await loadGameData();
  const c = new Controller(data, DEFAULT_SETTINGS, new EventTarget());
  const w = newWorld(data);
  c.beginSession({ ...w, credits }, { id: 'p', name: 'P' }, 'halcyon');
  const root = document.createElement('div');
  document.body.append(root);
  const state: { onPress?: (p: Set<ActionId>) => void; cleanup?: () => void; closed: number } = { closed: 0 };
  const ctx = {
    root,
    controller: c,
    store: {} as PilotStore,
    inputMode: new InputMode(new EventTarget(), () => DEFAULT_SETTINGS.bindings, 'keyboard'),
    planetImage: () => null,
    mount: (node: HTMLElement, opts: { onPress?: (p: Set<ActionId>) => void; cleanup?: () => void } = {}) => {
      state.cleanup?.();
      root.replaceChildren(node);
      state.onPress = opts.onPress;
      state.cleanup = opts.cleanup;
    },
    unmount: () => {
      state.cleanup?.();
      state.cleanup = undefined;
      root.replaceChildren();
    },
    go: { mainMenu() {}, planet() {}, pause() {}, map() {} },
  } as UiContext;
  showExchange(ctx, 'halcyon', () => state.closed++);
  const q = (t: string) => root.querySelector(`[data-testid="${t}"]`)!.textContent;
  const btn = (label: string) => [...root.querySelectorAll('button')].find((b) => b.querySelector('.sw-btn-label')?.textContent === label)!;
  const row = (good: string) => root.querySelector<HTMLElement>(`tr[data-good="${good}"]`)!;
  const held = (good: string) => row(good).querySelector('.sw-ex-held')!.textContent;
  const keys = Object.keys(data.planets.halcyon.market!);
  return { root, c, data, state, q, btn, row, held, keys };
}

afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
});

describe('commodity exchange', () => {
  it('lists the market in key order with level and priced rows', async () => {
    const { data, c, row, root, keys } = await setup();
    const rows = [...root.querySelectorAll('tbody tr')].map((r) => r.getAttribute('data-good'));
    expect(rows).toEqual(keys);
    for (const id of keys) {
      const price = priceOf(c.world, data, 'halcyon', id)!;
      const level = displayLevel(price, data.commodities[id].basePrice);
      const text = { low: 'Low', med: 'Med', high: 'High' }[level];
      expect(row(id).querySelector('.sw-ex-level')!.textContent).toBe(text);
      expect(row(id).querySelector('.sw-ex-price')!.textContent).toBe(`${price.toLocaleString('en-US')} cr`);
    }
  });

  it('Buy 10 moves 10 t: In hold and credits change', async () => {
    const { btn, held, c, data, q, keys } = await setup(5000);
    const price = priceOf(c.world, data, 'halcyon', keys[0])!;
    btn('Buy 10').click();
    expect(held(keys[0])).toBe('10 t');
    expect(c.world.credits).toBe(5000 - price * 10);
    expect(q('exchange-stats')).toContain(`Credits: ${(5000 - price * 10).toLocaleString('en-US')} cr`);
    expect(q('exchange-stats')).toContain('Cargo: 10/20 t');
    expect(q('exchange-message')).toContain('Bought 10 t');
  });

  it('Shift-click moves 1 t', async () => {
    const { btn, held, keys } = await setup();
    btn('Buy 10').dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }));
    expect(held(keys[0])).toBe('1 t');
  });

  it('a long press (450 ms) moves 1 t and its click does not add 10', async () => {
    vi.useFakeTimers();
    const { btn, held, keys } = await setup();
    const b = btn('Buy 10');
    b.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    vi.advanceTimersByTime(LONG_PRESS_MS - 10);
    expect(held(keys[0])).toBe('0 t');
    vi.advanceTimersByTime(20);
    expect(held(keys[0])).toBe('1 t');
    b.dispatchEvent(new Event('pointerup', { bubbles: true }));
    b.click();
    expect(held(keys[0])).toBe('1 t');
    // a quick tap is a normal 10 t click
    b.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    vi.advanceTimersByTime(100);
    b.dispatchEvent(new Event('pointerup', { bubbles: true }));
    b.click();
    vi.advanceTimersByTime(1000);
    expect(held(keys[0])).toBe('11 t');
  });

  it('says why a press does nothing', async () => {
    const { btn, q } = await setup();
    btn('Sell 10').click();
    expect(q('exchange-message')).toBe('You have none to sell');
    btn('Buy 10').click();
    btn('Buy 10').click();
    btn('Buy 10').click();
    expect(q('exchange-message')).toBe('Hold full');
    expect(q('exchange-stats')).toContain('Cargo: 0/20 t');
  });

  it('says "Not enough credits" when the pilot is broke', async () => {
    const { btn, q, c } = await setup(0);
    btn('Buy 10').click();
    expect(q('exchange-message')).toBe('Not enough credits');
    expect(c.world.credits).toBe(0);
  });

  it('Buy max fills the hold; Sell all empties the selected line', async () => {
    const { btn, held, c, keys } = await setup();
    btn('Buy max').click();
    expect(held(keys[0])).toBe('20 t');
    btn('Sell all').click();
    expect(held(keys[0])).toBe('0 t');
    expect(c.world.cargo[keys[0]]).toBeUndefined();
  });

  it('arrow keys and clicks choose the row that trades', async () => {
    const { btn, held, row, keys } = await setup();
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'ArrowDown' }));
    expect(row(keys[1]).getAttribute('aria-selected')).toBe('true');
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'ArrowUp' }));
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'ArrowUp' }));
    expect(row(keys[0]).getAttribute('aria-selected')).toBe('true');
    row(keys[2]).click();
    btn('Buy 10').click();
    expect(held(keys[2])).toBe('10 t');
    expect(held(keys[0])).toBe('0 t');
  });

  it('B and S trade 10 t, Shift+B 1 t, and Esc closes', async () => {
    const { state, held, keys } = await setup();
    state.onPress!(new Set<ActionId>(['buyGoods']));
    expect(held(keys[0])).toBe('10 t');
    state.onPress!(new Set<ActionId>(['sellGoods']));
    expect(held(keys[0])).toBe('0 t');
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyB', shiftKey: true }));
    state.onPress!(new Set<ActionId>(['buyGoods']));
    expect(held(keys[0])).toBe('1 t');
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'ShiftLeft', shiftKey: false }));
    state.onPress!(new Set<ActionId>(['back']));
    expect(state.closed).toBe(1);
  });

  it('Done closes the screen', async () => {
    const { btn, state, root } = await setup();
    btn('Done').click();
    expect(state.closed).toBe(1);
    expect(root.children).toHaveLength(0);
  });
});
