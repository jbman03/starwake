// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { Controller } from '../app/controller';
import { testData, withoutPorts } from '../data/testData';
import { InputMode } from '../input/mode';
import { DEFAULT_SETTINGS } from '../save/settings';
import type { PilotStore } from '../save/store';
import type { Mission, WorldState } from '../sim/types';
import { accept } from '../sim/missions';
import { newWorld } from '../sim/world';
import type { UiContext } from './context';
import { mapModel, PAD, routeSummary, showStarMap, systemDetails } from './starMap';

const data = testData();
const world = (): WorldState => newWorld(data, 1);
const lane = (a: string, b: string) => (l: [string, string]) => (l[0] === a && l[1] === b) || (l[0] === b && l[1] === a);

describe('mission destinations in uncharted space', () => {
  it('an accepted job charts its system: no longer a blank circle, and a route is offered', () => {
    const w = world();
    const port = Object.values(data.planets).find((p) => p.systemId === 'brackwater')!;
    expect(mapModel(w, data).nodes.find((n) => n.id === 'brackwater')!.state).toBe('unknown');
    expect(routeSummary(w, data, 'brackwater').route).toBeNull();
    const o = { offerId: 'o1', typeId: 'dump', originId: 'halcyon', destId: port.id, tons: 1, passengers: 0, pay: 400,
      paidUpfront: true, deadlineDay: null, title: 'T', description: '', cargoName: 'waste' };
    const taken = accept(w, data, o);
    const node = mapModel(taken, data).nodes.find((n) => n.id === 'brackwater')!;
    expect(node).toMatchObject({ state: 'seen', name: data.systems.brackwater.name, flag: true });
    expect(routeSummary(taken, data, 'brackwater').route?.at(-1)).toBe('brackwater');
  });
});

describe('mapModel', () => {
  it('fills known systems, outlines seen ones and blanks unknown ones (no name, grey)', () => {
    const m = mapModel(world(), data);
    expect(m.nodes).toHaveLength(Object.keys(data.systems).length);
    const node = (id: string) => m.nodes.find((n) => n.id === id)!;
    expect(node('calder')).toMatchObject({ name: 'Calder', state: 'known', current: true, color: data.governments.concord.color });
    expect(node('vesk')).toMatchObject({ name: 'Vesk', state: 'seen', current: false, color: data.governments.independent.color });
    expect(node('skerry')).toMatchObject({ name: null, state: 'unknown', current: false });
    expect(node('skerry').color).not.toBe(data.governments.independent.color);
    expect(node('calder')).toMatchObject({ x: data.systems.calder.mapPos.x, y: data.systems.calder.mapPos.y });
  });

  it('draws each lane once, only where an end is known or seen', () => {
    const m = mapModel(world(), data);
    expect(m.lanes.filter(lane('calder', 'vesk'))).toHaveLength(1); // known–seen
    expect(m.lanes.some(lane('vesk', 'lastlight'))).toBe(true); // seen–unknown
    expect(m.lanes.some(lane('redwater', 'skerry'))).toBe(false); // unknown–unknown
    expect(m.lanes.some(lane('brackwater', 'skerry'))).toBe(false);
  });

  it('flags the systems of mission destinations', () => {
    const mission = { id: 'm1', destId: 'vanterre' } as Mission; // a Tessaly port
    const m = mapModel({ ...world(), missions: [mission] }, data);
    expect(m.nodes.filter((n) => n.flag).map((n) => n.id)).toEqual(['tessaly']);
  });
});

describe('routeSummary', () => {
  it('counts jumps and fuel, and is short when the tank cannot cover the route', () => {
    const w = world(); // 3 jumps of fuel
    expect(routeSummary(w, data, 'tessaly')).toEqual({ route: ['tessaly'], text: '1 jump · fuel needed 1 · you have 3', short: false, reachable: 3 });
    const far = routeSummary(w, data, 'brannock');
    expect(far.route).toHaveLength(4);
    expect(far.text).toBe('4 jumps · fuel needed 4 · you have 3');
    expect(far.short).toBe(true);
    expect(far.reachable).toBe(3);
  });

  it('has no route to unknown systems and nothing to plan to the current one', () => {
    expect(routeSummary(world(), data, 'skerry')).toMatchObject({ route: null, text: 'No known route', short: false });
    expect(routeSummary(world(), data, 'calder')).toMatchObject({ route: [], text: 'You are here' });
  });
});

describe('systemDetails', () => {
  it('lists government, goods, services and ports for a known system', () => {
    const d = systemDetails('calder', world(), data);
    expect(d.title).toBe('Calder');
    const row = (label: string) => d.rows.find((r) => r.label === label)?.value;
    expect(row('Government')).toBe('Concord of Lanterns');
    expect(row('Goods')).toContain('Food');
    expect(row('Goods')).toContain('Halcyon Copperwine');
    expect(row('Services')).toBe('Refuel, Exchange, Missions, Outfitter');
    const bare = systemDetails('calder', world(), withoutPorts(data, 'calder'));
    expect(bare.rows.find((r) => r.label === 'Services')?.value).toBe('None');
    expect(row('Ports')).toBe('Halcyon, Merrow, Brigg Station');
    expect(row('Hazards')).toBe('None');
  });

  it('says Unexplored for unknown systems and hides their name', () => {
    const d = systemDetails('skerry', world(), data);
    expect(d.title).toBe('Unexplored');
    expect(JSON.stringify(d)).not.toContain('Skerry');
  });

  it('gives only the name and government for a seen system', () => {
    const d = systemDetails('vesk', world(), data);
    expect(d.title).toBe('Vesk');
    expect(d.rows.map((r) => r.label)).toEqual(['Government', 'Details']);
  });
});

describe('showStarMap', () => {
  afterEach(() => document.body.replaceChildren());

  function setup(onClose?: () => void, landedAt?: string, extra: { preview?: { systemId: string; label: string } } = {}) {
    const settings = { ...DEFAULT_SETTINGS };
    const c = new Controller(data, settings, new EventTarget(), world());
    if (landedAt) c.beginSession(c.world, { id: 'p', name: 'P' }, landedAt);
    const root = document.createElement('div');
    document.body.append(root);
    let mounted: { onPress?: (p: Set<string>) => void; groups?: readonly string[] } = {};
    const ctx = {
      root,
      controller: c,
      store: {} as PilotStore,
      inputMode: new InputMode(new EventTarget(), () => settings.bindings, 'keyboard'),
      planetImage: () => null,
      mount: (node: HTMLElement, opts: typeof mounted = {}) => {
        root.replaceChildren(node);
        mounted = opts;
      },
      unmount: () => root.replaceChildren(),
      go: { mainMenu() {}, planet() {}, pause() {}, map() {} },
    } as unknown as UiContext;
    showStarMap(ctx, { ...(onClose ? { onClose } : {}), ...extra });
    const btn = (name: string) => [...root.querySelectorAll('button')].find((b) => b.textContent?.startsWith(name))!;
    const sys = (id: string) => root.querySelector<SVGGElement>(`[data-system="${id}"]`)!;
    return { c, root, btn, sys, press: (...a: string[]) => mounted.onPress?.(new Set(a)), groups: () => mounted.groups };
  }

  it('draws unknown systems without names and marks the current system', () => {
    const { root, sys } = setup();
    expect(root.querySelector('[data-testid="star-map"]')).not.toBeNull();
    expect(sys('skerry').classList.contains('sw-sys-unknown')).toBe(true);
    expect(sys('skerry').textContent).toBe('');
    expect(sys('vesk').classList.contains('sw-sys-seen')).toBe(true);
    expect(sys('calder').querySelector('.sw-map-ring')).not.toBeNull();
  });

  it('selecting a system shows its info; Set course plots it and Clear course clears it', () => {
    const { c, root, btn, sys } = setup();
    expect(btn('Set course').disabled).toBe(true);
    sys('tessaly').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const info = root.querySelector('[data-testid="map-info"]')!;
    expect(info.textContent).toContain('Tessaly');
    expect(info.textContent).toContain('Concord of Lanterns');
    expect(info.textContent).toContain('1 Mar 3207');
    expect(root.querySelector('[data-testid="map-route"]')!.textContent).toBe('1 jump · fuel needed 1 · you have 3');
    expect(btn('Set course').disabled).toBe(false);
    expect(btn('Clear course').disabled).toBe(true);
    btn('Set course').click();
    expect(c.world.route).toEqual(['tessaly']);
    expect(btn('Set course').disabled).toBe(true); // already set
    expect(btn('Clear course').disabled).toBe(false);
    expect(root.querySelector('.sw-map-route')).not.toBeNull();
    btn('Clear course').click();
    expect(c.world.route).toEqual([]);
  });

  it('marks a route the fuel cannot cover in red, with the unreachable jumps dashed', () => {
    const { root, sys } = setup();
    sys('brannock').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const text = root.querySelector('[data-testid="map-route"]')!;
    expect(text.classList.contains('sw-map-short')).toBe(true);
    expect(root.querySelectorAll('.sw-map-route-short')).toHaveLength(1); // the 4th hop
    expect(root.querySelectorAll('.sw-map-route-ok')).toHaveLength(1);
  });

  it('keyboard selection keeps focus on the chosen system', () => {
    const { root, sys } = setup();
    for (const key of ['Enter', ' ']) {
      sys('tessaly').focus();
      expect(document.activeElement).toBe(sys('tessaly'));
      sys('tessaly').dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
      expect(root.querySelector('[data-testid="map-info"]')!.textContent).toContain('Tessaly');
      expect(document.activeElement).toBe(sys('tessaly'));
      expect(sys('tessaly').classList.contains('sw-map-selected')).toBe(true);
    }
    // Set course re-renders too; a focused system keeps focus through it.
    sys('minster').focus();
    [...root.querySelectorAll('button')].find((b) => b.textContent?.startsWith('Set course'))!.click();
    expect(document.activeElement).toBe(sys('minster'));
  });

  it('unknown systems show Unexplored and cannot be plotted', () => {
    const { root, btn, sys } = setup();
    sys('skerry').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(root.querySelector('[data-testid="map-info"]')!.textContent).toContain('Unexplored');
    expect(root.querySelector('[data-testid="map-route"]')!.textContent).toBe('No known route');
    expect(btn('Set course').disabled).toBe(true);
  });

  it('zoom buttons narrow the viewBox down to 4x and back out to the whole galaxy', () => {
    const { root } = setup();
    const svgEl = root.querySelector('svg')!;
    const width = () => Number(svgEl.getAttribute('viewBox')!.split(' ')[2]);
    const full = width();
    const zoomIn = root.querySelector<HTMLButtonElement>('[aria-label="Zoom in"]')!;
    const zoomOut = root.querySelector<HTMLButtonElement>('[aria-label="Zoom out"]')!;
    zoomOut.click();
    expect(width()).toBeCloseTo(full);
    for (let i = 0; i < 10; i++) zoomIn.click();
    expect(width()).toBeCloseTo(full / 4);
    for (let i = 0; i < 10; i++) zoomOut.click();
    expect(width()).toBeCloseTo(full);
  });

  it('Close (or back) runs onClose; without one it resumes flight', () => {
    let closed = 0;
    const a = setup(() => closed++);
    a.btn('Close').click();
    expect(closed).toBe(1);
    expect(a.root.children).toHaveLength(0);

    const b = setup();
    expect(b.groups()).toEqual(['flight', 'menus']);
    b.press('back');
    expect(b.c.isFlying).toBe(true);
  });

  it('opened from a planet, it listens to the planet group and closes on openMap', () => {
    let closed = 0;
    const { press, groups } = setup(() => closed++, 'halcyon');
    expect(groups()).toEqual(['planet', 'menus']);
    press('openMap');
    expect(closed).toBe(1);
  });

  it('a preview selects its system, shows the label and the route, and leaves the course alone until Set course', () => {
    const { c, root, btn, sys } = setup(undefined, undefined, { preview: { systemId: 'tessaly', label: 'Mission: Deliver rations' } });
    expect(sys('tessaly').classList.contains('sw-map-selected')).toBe(true);
    expect(sys('tessaly').classList.contains('sw-map-preview')).toBe(true);
    expect(root.querySelector('[data-testid="map-preview"]')!.textContent).toBe('Mission: Deliver rations');
    expect(root.querySelector('[data-testid="map-route"]')!.textContent).toBe("1 jump · fuel needed 1 · you have 3");
    expect(c.world.route).toEqual([]);
    btn('Set course').click();
    expect(c.world.route).toEqual(['tessaly']);
  });

  it('a preview centres and zooms the view on its system', () => {
    const { root } = setup(undefined, undefined, { preview: { systemId: 'tessaly', label: 'Mission: x' } });
    const [x, y, w, h] = root.querySelector('svg')!.getAttribute('viewBox')!.split(' ').map(Number);
    const at = data.systems.tessaly.mapPos;
    const all = Object.values(data.systems);
    const xs = all.map((q) => q.mapPos.x);
    const ys = all.map((q) => q.mapPos.y);
    const bx = Math.min(...xs) - PAD;
    const by = Math.min(...ys) - PAD;
    const bw = Math.max(...xs) + PAD - bx;
    const bh = Math.max(...ys) + PAD - by;
    expect(w).toBeCloseTo(bw / 2, 6); // zoom 2
    expect(h).toBeCloseTo(bh / 2, 6);
    // Centred on the system, clamped so the view stays inside the galaxy bounds.
    const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
    expect(x + w / 2).toBeCloseTo(clamp(at.x, bx + w / 2, bx + bw - w / 2), 6);
    expect(y + h / 2).toBeCloseTo(clamp(at.y, by + h / 2, by + bh - h / 2), 6);
  });

  it('a preview of an unexplored system still gets a marker', () => {
    const unknown = mapModel(world(), data).nodes.find((n) => n.state === 'unknown')!;
    const { sys } = setup(undefined, undefined, { preview: { systemId: unknown.id, label: 'Mission: x' } });
    expect(sys(unknown.id).classList.contains('sw-map-preview')).toBe(true);
  });
});
