// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { Controller } from '../app/controller';
import { loadGameData } from '../data/load';
import { InputMode } from '../input/mode';
import type { PilotStore } from '../save/store';
import { DEFAULT_SETTINGS } from '../save/settings';
import { newWorld } from '../sim/world';
import type { UiContext } from './context';
import { showOutfitter } from './outfitter';
import { showPlanetScreen } from './planetScreen';
import { showShipyard } from './shipyard';
import { pageSize, showShop, type ShopItem } from './shop';

async function setup(portId: string, credits = 50000) {
  const data = await loadGameData();
  const c = new Controller(data, { ...DEFAULT_SETTINGS }, new EventTarget());
  const w = newWorld(data);
  c.beginSession({ ...w, credits }, { id: 'p', name: 'P' }, portId);
  const root = document.createElement('div');
  document.body.replaceChildren(root);
  const calls = {
    planet: [] as string[],
    onPress: undefined as ((p: Set<string>) => void) | undefined,
    mapClose: undefined as (() => void) | undefined,
  };
  const ctx = {
    root,
    controller: c,
    store: {} as PilotStore,
    inputMode: new InputMode(new EventTarget(), () => DEFAULT_SETTINGS.bindings, 'keyboard'),
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
      map: (o?: { onClose?: () => void }) => {
        calls.mapClose = o?.onClose;
      },
    },
  } as UiContext;
  return { root, c, ctx, calls, data };
}

const btn = (root: HTMLElement, text: string) =>
  [...root.querySelectorAll('button')].find((b) => b.querySelector('.sw-btn-label')?.textContent === text)!;
const tile = (root: HTMLElement, id: string) => root.querySelector<HTMLElement>(`[data-item="${id}"]`)!;
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('pageSize', () => {
  it('is 3x2 on a phone and 4x3 on a desktop', () => {
    expect(pageSize(844, 390)).toEqual({ cols: 3, rows: 2 });
    expect(pageSize(1280, 800)).toEqual({ cols: 4, rows: 3 });
  });
});

describe('outfitter', () => {
  it('buying a pod shows a count badge of 1 and takes 2000 credits', async () => {
    const { root, ctx, c } = await setup('halcyon');
    showOutfitter(ctx, 'halcyon', () => {});
    const before = c.world.credits;
    tile(root, 'cargo-pod').click();
    expect(tile(root, 'cargo-pod').querySelector('.sw-shop-badge')).toBeNull();
    btn(root, 'Buy').click();
    await flush();
    expect(tile(root, 'cargo-pod').querySelector('.sw-shop-badge')?.textContent).toBe('1');
    expect(c.world.credits).toBe(before - 2000);
  });

  it('coming back from the map keeps the selected tile', async () => {
    const { root, ctx, calls } = await setup('halcyon');
    showOutfitter(ctx, 'halcyon', () => {});
    const ids = [...root.querySelectorAll('[data-item]')].map((n) => n.getAttribute('data-item')!);
    const pick = ids[2];
    tile(root, pick).click();
    root.querySelector<HTMLButtonElement>('.sw-map-corner')!.click();
    calls.mapClose!();
    expect(tile(root, pick).classList.contains('sw-shop-selected')).toBe(true);
  });

  it('disables Buy with the space reason once the space is full', async () => {
    const { root, ctx, c } = await setup('halcyon', 100000);
    showOutfitter(ctx, 'halcyon', () => {});
    tile(root, 'cargo-pod').click();
    for (let i = 0; i < 2; i++) {
      btn(root, 'Buy').click();
      await flush();
    }
    expect(c.world.outfits['cargo-pod']).toBe(2);
    expect(btn(root, 'Buy').disabled).toBe(true);
    expect(root.textContent).toContain('Not enough free outfit space.');
  });

  it('Sell refunds half and is disabled with nothing fitted', async () => {
    const { root, ctx, c } = await setup('halcyon');
    showOutfitter(ctx, 'halcyon', () => {});
    tile(root, 'cargo-pod').click();
    expect(btn(root, 'Sell').disabled).toBe(true);
    btn(root, 'Buy').click();
    await flush();
    const mid = c.world.credits;
    btn(root, 'Sell').click();
    expect(c.world.credits).toBe(mid + 1000);
  });
});

describe('shipyard', () => {
  it('shows the trade-in for the mule, and buying it (confirmed) gives a 60 t hold', async () => {
    const { root, ctx, c, calls } = await setup('vanterre');
    showShipyard(ctx, 'vanterre', () => ctx.go.planet('vanterre'));
    tile(root, 'mule').click();
    expect(root.querySelector('.sw-shop-info')?.textContent).toContain('Trade-in');
    expect(root.querySelector('.sw-shop-info')?.textContent).toContain('7,500 cr');
    expect(btn(root, 'Sell')).toBeUndefined();
    btn(root, 'Buy').click();
    expect(document.body.textContent).toContain('Trade in your Wayfarer Shuttle and buy Mule Light Freighter for 37,500 cr?');
    btn(document.body, 'Buy ship').click();
    await flush();
    expect(c.world.shipId).toBe('mule');
    showPlanetScreen(ctx, 'vanterre');
    expect(root.textContent).toContain('/60 t');
    expect(calls.planet).toEqual([]);
  });

  it('warns that fitted outfits go with the old ship', async () => {
    const { root, ctx, c } = await setup('vanterre');
    c.world = { ...c.world, outfits: { 'cargo-pod': 1 } };
    showShipyard(ctx, 'vanterre', () => {});
    tile(root, 'mule').click();
    expect(root.querySelector('.sw-shop-info')?.textContent).toContain('go with your old ship');
  });
});

describe('planet screen services', () => {
  it('Vanterre shows Shipyard, Outfitter and Tech hub; Halcyon only Outfitter; Merrow neither', async () => {
    for (const [port, yard, out, hub] of [
      ['vanterre', true, true, true],
      ['halcyon', false, true, false],
      ['merrow', false, false, false],
    ] as const) {
      const { root, ctx } = await setup(port);
      showPlanetScreen(ctx, port);
      const labels = [...root.querySelectorAll('.sw-actions .sw-btn-label')].map((l) => l.textContent);
      expect(labels.includes('Shipyard')).toBe(yard);
      expect(labels.includes('Outfitter')).toBe(out);
      expect(root.textContent?.includes('Tech hub')).toBe(hub);
    }
  });

  it('the Outfitter hotkey opens the outfitter and Done returns to the planet', async () => {
    const { root, ctx, calls } = await setup('halcyon');
    showPlanetScreen(ctx, 'halcyon');
    calls.onPress!(new Set(['openOutfitter']));
    expect(root.querySelector('[data-testid="outfitter"]')).not.toBeNull();
    btn(root, 'Done').click();
    expect(calls.planet).toEqual(['halcyon']);
  });
});

describe('paging', () => {
  it('Next page moves to the second page when there are more items than fit', () => {
    const items: ShopItem[] = Array.from({ length: 15 }, (_, i) => ({
      id: `i${i}`,
      name: `Item ${i}`,
      icon: () => document.createElement('span'),
      info: () => document.createElement('div'),
      canBuy: true,
    }));
    const root = document.createElement('div');
    document.body.replaceChildren(root);
    let onPress: ((p: Set<string>) => void) | undefined;
    const ctx = {
      root,
      controller: { settings: DEFAULT_SETTINGS, world: { credits: 0 } },
      mount: (node: HTMLElement, o: { onPress?: (p: Set<string>) => void }) => {
        root.replaceChildren(node);
        onPress = o.onPress;
      },
      unmount() {},
    } as unknown as UiContext;
    showShop(ctx, { title: 'T', testId: 'shipyard', items: () => items, onBuy() {}, onClose() {} });
    const ids = () => [...root.querySelectorAll('[data-item]')].map((n) => n.getAttribute('data-item'));
    expect(ids().length).toBe(12);
    onPress!(new Set(['shopNextPage']));
    expect(ids()).toEqual(['i12', 'i13', 'i14']);
    onPress!(new Set(['shopPrevPage']));
    expect(ids().length).toBe(12);
  });
});

describe('requiresStanding locked tiles', () => {
  const REQ = { government: 'concord', level: 'friend' as const };

  it('outfitter: a gated outfit is a locked ??? tile that names the government and cannot be bought', async () => {
    const { root, ctx, c, data } = await setup('halcyon');
    const def = data.outfits['cargo-pod'];
    def.requiresStanding = REQ;
    try {
      showOutfitter(ctx, 'halcyon', () => {});
      const t = tile(root, 'cargo-pod');
      expect(t.textContent).toContain('???');
      expect(t.textContent).not.toContain(def.name);
      t.click();
      expect(root.textContent).toContain('Requires Concord friendship');
      expect(btn(root, 'Buy').disabled).toBe(true);
      expect(c.outfitQuote('cargo-pod')).toEqual({ ok: false, reason: 'standing' });
      // Friendship opens the tile.
      c.world = { ...c.world, standing: { concord: 'friend' } };
      showOutfitter(ctx, 'halcyon', () => {});
      expect(tile(root, 'cargo-pod').textContent).toContain(def.name);
    } finally {
      delete def.requiresStanding;
    }
  });

  it('outfitter: an outfit already fitted stays visible and sellable when the requirement now fails', async () => {
    const { root, ctx, c } = await setup('halcyon');
    const def = c.data.outfits['cargo-pod'];
    def.requiresStanding = REQ;
    try {
      c.world = { ...c.world, outfits: { 'cargo-pod': 1 } };
      expect(c.outfitQuote('cargo-pod')).toEqual({ ok: false, reason: 'standing' });
      showOutfitter(ctx, 'halcyon', () => {});
      const t = tile(root, 'cargo-pod');
      expect(t.textContent).toContain(def.name);
      expect(t.textContent).not.toContain('???');
      t.click();
      expect(btn(root, 'Sell').disabled).toBe(false);
    } finally {
      delete def.requiresStanding;
    }
  });

  it('shipyard: a gated hull is a locked ??? tile that names the government', async () => {
    const { root, ctx, data } = await setup('vanterre');
    const hull = data.ships.mule;
    hull.requiresStanding = REQ;
    try {
      showShipyard(ctx, 'vanterre', () => {});
      const t = tile(root, 'mule');
      expect(t.textContent).toContain('???');
      expect(t.textContent).not.toContain(hull.name);
      t.click();
      expect(root.textContent).toContain('Requires Concord friendship');
      expect(btn(root, 'Buy').disabled).toBe(true);
    } finally {
      delete hull.requiresStanding;
    }
  });
});
