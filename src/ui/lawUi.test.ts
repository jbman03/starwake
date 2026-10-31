// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { Controller } from '../app/controller';
import { loadGameData } from '../data/load';
import { InputMode } from '../input/mode';
import { pilotFromWorld } from '../save/pilot';
import type { PilotStore } from '../save/store';
import { DEFAULT_SETTINGS } from '../save/settings';
import { LEGAL_COLOR, LEGAL_LABEL } from '../sim/law';
import { sidebarInfo } from '../render/sidebarInfo';
import { outfitStock } from '../sim/stock';
import { outfitPrice } from '../sim/outfitter';
import { newWorld } from '../sim/world';
import type { UiContext } from './context';
import { pilotCard } from './mainMenu';
import { showOutfitter } from './outfitter';
import { showPlanetScreen } from './planetScreen';
import { showShipyard } from './shipyard';

async function setup(portId: string, patch: Record<string, unknown> = {}) {
  const data = await loadGameData();
  const c = new Controller(data, { ...DEFAULT_SETTINGS }, new EventTarget());
  const w = { ...newWorld(data), outfits: {}, credits: 500000, ...patch };
  c.beginSession(w, { id: 'p', name: 'P' }, portId);
  const root = document.createElement('div');
  document.body.replaceChildren(root);
  const ctx = {
    root,
    controller: c,
    store: {} as PilotStore,
    inputMode: new InputMode(new EventTarget(), () => DEFAULT_SETTINGS.bindings, 'keyboard'),
    planetImage: () => null,
    mount: (node: HTMLElement) => root.replaceChildren(node),
    unmount: () => root.replaceChildren(),
    go: { mainMenu() {}, planet() {}, pause() {}, map() {} },
  } as unknown as UiContext;
  return { root, c, ctx, data };
}

const btn = (root: HTMLElement, text: string) =>
  [...root.querySelectorAll('button')].find((b) => b.querySelector('.sw-btn-label')?.textContent === text)!;
const tile = (root: HTMLElement, id: string) => root.querySelector<HTMLElement>(`[data-item="${id}"]`)!;
const flush = () => new Promise((r) => setTimeout(r, 0));
const WARDEN = { concord: { points: 30, salaryDay: -1 } }; // rank 2: 5% discount
const KEEPER = { concord: { points: 70, salaryDay: -1 } }; // rank 3

describe('sidebar law line', () => {
  it('reads Law: <status> in the status colour for the current system government', async () => {
    const data = await loadGameData();
    const w = newWorld(data);
    const gov = data.systems[w.systemId].government;
    expect(LEGAL_COLOR).toEqual({ clean: '#7fd18b', suspect: '#e0c060', wanted: '#e08a50', hunted: '#e05050' });
    const heats = { clean: 0, suspect: data.law.thresholds.suspect, wanted: data.law.thresholds.wanted, hunted: data.law.thresholds.hunted };
    for (const [status, heat] of Object.entries(heats) as [keyof typeof heats, number][]) {
      const info = sidebarInfo({ ...w, law: { [gov]: { heat } } }, data);
      expect(info.law).toEqual({ text: `Law: ${LEGAL_LABEL[status]}`, color: LEGAL_COLOR[status] });
    }
    // Heat with another government does not show here.
    const other = Object.keys(data.governments).find((g) => g !== gov)!;
    expect(sidebarInfo({ ...w, law: { [other]: { heat: 90 } } }, data).law.text).toBe('Law: Clean');
  });
});

describe('pilot card law and rank lines', () => {
  it('lists non-Clean governments and ranked factions', async () => {
    const data = await loadGameData();
    const w = { ...newWorld(data), law: { concord: { heat: 40 }, 'free-reach': { heat: 3 } }, ranks: KEEPER };
    const save = pilotFromWorld(w, data.config.startPlanetId, { id: 'a', name: 'Ann' });
    const c = pilotCard(save, data);
    expect(c.lawLines).toEqual(['Concord: Wanted']);
    expect(c.rankLines).toEqual(['Concord: Keeper']);
  });

  it('is empty for a fresh pilot', async () => {
    const data = await loadGameData();
    const c = pilotCard(pilotFromWorld(newWorld(data), data.config.startPlanetId, { id: 'a', name: 'Ann' }), data);
    expect(c.lawLines).toEqual([]);
    expect(c.rankLines).toEqual([]);
  });
});

describe('planet screen fines and salary', () => {
  it('shows a row per owed government and Pay clears it', async () => {
    const { root, ctx, c } = await setup('halcyon', { law: { concord: { heat: 40 }, 'free-reach': { heat: 35 } } });
    showPlanetScreen(ctx, 'halcyon');
    const rows = [...root.querySelectorAll('.sw-fine-row > span')].map((s) => s.textContent);
    expect(rows).toEqual(['Fines owed to Concord: 1,600 cr', 'Fines owed to Free Reach: 1,400 cr']);
    const before = c.world.credits;
    btn(root, 'Pay').click();
    expect(c.world.credits).toBe(before - 1600);
    expect(c.world.law.concord.heat).toBe(0);
    expect(root.querySelectorAll('.sw-fine-row')).toHaveLength(1);
  });

  it('a short-credits refusal says so and changes nothing', async () => {
    const { root, ctx, c } = await setup('halcyon', { credits: 100, law: { concord: { heat: 40 } } });
    showPlanetScreen(ctx, 'halcyon');
    btn(root, 'Pay').click();
    expect(root.querySelector('.sw-status')!.textContent).toBe('Not enough credits.');
    expect(c.world.credits).toBe(100);
    expect(root.querySelectorAll('.sw-fine-row')).toHaveLength(1);
  });

  it('shows no row while Clean', async () => {
    const { root, ctx } = await setup('halcyon', { law: { concord: { heat: 2 } } });
    showPlanetScreen(ctx, 'halcyon');
    expect(root.querySelector('.sw-fine-row')).toBeNull();
  });

  it('a salary notice on landing reads "{Gov} salary: +{cr} cr"', async () => {
    const { root, ctx, c, data } = await setup('halcyon', { ranks: KEEPER });
    c.leavePlanet();
    c.selectPlanet('halcyon');
    c.world = { ...c.world, assist: { kind: 'autopilot', dest: { type: 'planet', id: 'halcyon' }, autoLand: true } };
    for (let i = 0; i < 60 * 60 && c.landedPlanetId === null; i++) c.update(1 / 60);
    showPlanetScreen(ctx, 'halcyon');
    expect(data.systems[data.planets.halcyon.systemId].government).toBe('concord');
    expect(root.querySelector('.sw-status')!.textContent).toContain('Concord salary: +150 cr');
  });
});

describe('rank discounts and locks in the shops', () => {
  it('outfitter shows and charges the discounted price, and says so', async () => {
    const { root, ctx, c, data } = await setup('halcyon', { ranks: WARDEN });
    const list = data.outfits['cargo-pod'].price;
    const charged = outfitPrice(c.world, data, 'halcyon', 'cargo-pod');
    expect(charged).toBe(Math.round(list * 0.95));
    showOutfitter(ctx, 'halcyon', () => {});
    tile(root, 'cargo-pod').click();
    expect(root.textContent).toContain(`${charged.toLocaleString('en-US')} cr (5% Concord rank discount, list ${list.toLocaleString('en-US')} cr)`);
    const before = c.world.credits;
    btn(root, 'Buy').click();
    await flush();
    expect(before - c.world.credits).toBe(charged);
    expect(root.textContent).toContain(`Bought ${data.outfits['cargo-pod'].name} for ${charged.toLocaleString('en-US')} cr.`);
  });

  it('outfitter shows the plain list price with no discount', async () => {
    const { root, ctx, data } = await setup('halcyon');
    showOutfitter(ctx, 'halcyon', () => {});
    tile(root, 'cargo-pod').click();
    expect(root.textContent).not.toContain('rank discount');
    expect(root.textContent).toContain(`${data.outfits['cargo-pod'].price.toLocaleString('en-US')} cr`);
  });

  it('outfitter: a rank-gated outfit says "Requires Concord rank 4 (Keeper)" style text', async () => {
    const { root, ctx, data } = await setup('halcyon');
    const def = data.outfits['cargo-pod'];
    def.requiresRank = { government: 'concord', rank: 4 };
    try {
      showOutfitter(ctx, 'halcyon', () => {});
      tile(root, 'cargo-pod').click();
      expect(root.textContent).toContain('Requires Concord rank 4 (Beacon)');
      expect(btn(root, 'Buy').disabled).toBe(true);
    } finally {
      delete def.requiresRank;
    }
  });

  it('shipyard: rank-gated hull names the rank; discounted price is shown', async () => {
    const { root, ctx, data } = await setup('vanterre', { ranks: WARDEN });
    const hull = data.ships.mule;
    showShipyard(ctx, 'vanterre', () => {});
    tile(root, 'mule').click();
    expect(root.textContent).toContain('5% Concord rank discount');
    hull.requiresRank = { government: 'concord', rank: 4 };
    try {
      showShipyard(ctx, 'vanterre', () => {});
      tile(root, 'mule').click();
      expect(root.textContent).toContain('Requires Concord rank 4 (Beacon)');
    } finally {
      delete hull.requiresRank;
    }
  });

  it('the scrambler tile shows its effect and an icon', async () => {
    const data = await loadGameData();
    const port = Object.values(data.planets).find((p) => p.services.includes('outfitter') && outfitStock(p.id, data).some((o) => o.id === 'scrambler'));
    expect(port, 'a port stocks the scrambler').toBeDefined();
    const { root, ctx } = await setup(port!.id);
    showOutfitter(ctx, port!.id, () => {});
    const t = tile(root, 'scrambler');
    expect(t.textContent).toContain('Scan Scrambler');
    expect(t.querySelector('svg')).not.toBeNull();
    t.click();
    expect(root.textContent).toContain("Cuts a patrol scan's catch chance by 50%");
  });
});
