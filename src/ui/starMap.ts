import type { GameData } from '../data/schemas';
import { formatDate } from '../sim/calendar';
import { fuelCheck, lanesOf, routeBetween, visibleSystems } from '../sim/galaxy';
import type { WorldState } from '../sim/types';
import { setRoute } from '../sim/world';
import type { UiContext } from './context';
import { button, el, hotkeyFor } from './dom';
import { guideCard } from './guideHint';

export { visibleSystemCount } from '../sim/galaxy';

const SVG_NS = 'http://www.w3.org/2000/svg';
/** Unknown systems: a plain grey outline, whatever their owner. */
export const UNKNOWN_COLOR = '#5a6472';
/** Map units of empty space around the outermost systems at minimum zoom. */
export const PAD = 100;
const MAX_ZOOM = 4;
const PREVIEW_ZOOM = 2;
const ZOOM_STEP = 1.5;
/** Pointer travel (px) before a press on the map counts as a drag rather than a click. */
const DRAG_PX = 6;

export type SystemState = 'known' | 'seen' | 'unknown';

export interface MapNode {
  id: string;
  /** Null for unknown systems: their names aren't charted. */
  name: string | null;
  state: SystemState;
  color: string;
  x: number;
  y: number;
  current: boolean;
  /** A mission's destination port is in this system. */
  flag: boolean;
}

export interface MapModel {
  nodes: MapNode[];
  /** Each lane once; only lanes with a known or seen end. */
  lanes: [string, string][];
}

function stateOf(world: WorldState, id: string): SystemState {
  if (id === world.systemId || world.known.includes(id)) return 'known';
  return world.seen.includes(id) ? 'seen' : 'unknown';
}

/** What the star map draws: systems by exploration state, the lanes you know of, mission flags. */
export function mapModel(world: WorldState, data: GameData): MapModel {
  const flagged = new Set(world.missions.map((m) => data.planets[m.destId]?.systemId).filter((id) => id !== undefined));
  const nodes: MapNode[] = visibleSystems(data, world.flags).map((s) => {
    const state = stateOf(world, s.id);
    return {
      id: s.id,
      name: state === 'unknown' ? null : s.name,
      state,
      color: state === 'unknown' ? UNKNOWN_COLOR : (data.governments[s.government]?.color ?? UNKNOWN_COLOR),
      x: s.mapPos.x,
      y: s.mapPos.y,
      current: s.id === world.systemId,
      flag: flagged.has(s.id),
    };
  });
  const lanes: [string, string][] = [];
  const drawn = new Set<string>();
  for (const s of visibleSystems(data, world.flags)) {
    for (const l of lanesOf(data, s.id, world.flags)) {
      const key = [s.id, l].sort().join('|');
      if (drawn.has(key) || !data.systems[l]) continue;
      drawn.add(key);
      if (stateOf(world, s.id) !== 'unknown' || stateOf(world, l) !== 'unknown') lanes.push([s.id, l]);
    }
  }
  return { nodes, lanes };
}

export interface RouteSummary {
  /** Hops to the system (next first); [] for the current system; null when no known route. */
  route: string[] | null;
  text: string;
  /** The tank can't cover the whole route. */
  short: boolean;
  /** Jumps the current fuel covers. */
  reachable: number;
}

const jumps = (n: number) => `${n} ${n === 1 ? 'jump' : 'jumps'}`;

/**
 * Fewest-hops route as setRoute plots it (charted systems, or any lane to a mission's system),
 * with "N jumps · fuel needed N · you have M" (in jumps).
 */
export function routeSummary(world: WorldState, data: GameData, toId: string, opts: { anyLane?: boolean } = {}): RouteSummary {
  const reachable = fuelCheck(world.ship.fuel, 0, data.config).reachable;
  if (toId === world.systemId) return { route: [], text: 'You are here', short: false, reachable };
  // anyLane previews a mission's course (accepting one charts any lane), so it may cross unexplored space.
  const plotted = opts.anyLane ? routeBetween(data, world.systemId, toId, () => true, world.flags) : null;
  const r = plotted ? null : setRoute(world, data, toId);
  const route = plotted ?? (r?.ok ? r.world.route : null);
  if (!route) return { route: null, text: 'No known route', short: false, reachable };
  const n = route.length;
  const unexplored = opts.anyLane && route.some((id) => !world.known.includes(id)) ? ' (through unexplored space)' : '';
  return { route, text: `${jumps(n)}${unexplored} · fuel needed ${n} · you have ${reachable}`, short: reachable < n, reachable };
}

export interface SystemDetails {
  title: string;
  rows: { label: string; value: string }[];
}

const SERVICE_NAMES = { exchange: 'Exchange', missions: 'Missions', shipyard: 'Shipyard', outfitter: 'Outfitter' } as const;
const listOr = (items: string[], none = 'None') => (items.length > 0 ? items.join(', ') : none);

/** Info panel content. Unknown systems are "Unexplored"; seen ones show only name and owner. */
export function systemDetails(id: string, world: WorldState, data: GameData): SystemDetails {
  const sys = data.systems[id];
  const state = stateOf(world, id);
  if (!sys || state === 'unknown') return { title: 'Unexplored', rows: [] };
  const government = { label: 'Government', value: data.governments[sys.government]?.name ?? sys.government };
  if (state === 'seen') return { title: sys.name, rows: [government, { label: 'Details', value: 'Not yet visited' }] };

  const ports = Object.values(data.planets).filter((p) => p.systemId === id);
  const goods = new Set<string>();
  const services = new Set<string>();
  for (const p of ports) {
    for (const g of Object.keys(p.market ?? {})) goods.add(g);
    for (const s of p.services) services.add(s);
  }
  return {
    title: sys.name,
    rows: [
      government,
      { label: 'Goods', value: listOr([...goods].map((g) => data.commodities[g]?.name ?? g)) },
      {
        label: 'Services',
        value: listOr([
          ...(ports.length > 0 ? ['Refuel'] : []), // every port sells fuel
          ...(Object.keys(SERVICE_NAMES) as (keyof typeof SERVICE_NAMES)[]).filter((s) => services.has(s)).map((s) => SERVICE_NAMES[s]),
        ]),
      },
      { label: 'Ports', value: listOr(ports.map((p) => p.name)) },
      { label: 'Hazards', value: listOr(sys.hazards ?? []) },
    ],
  };
}

function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>, text?: string) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  if (text !== undefined) node.textContent = text;
  return node;
}

const points = (ids: string[], data: GameData) => ids.map((id) => `${data.systems[id].mapPos.x},${data.systems[id].mapPos.y}`).join(' ');

/**
 * EV-style star map. Systems are circles colored by owner (filled = visited, hollow = seen,
 * grey outline = unknown) joined by the lanes you know of. Zoom with the buttons, wheel or
 * pinch; drag to pan (both change the SVG viewBox). Select a system for its info and route,
 * then Set course. Flight is paused while it's open; closing runs `onClose` (default: resume
 * flight). `initialSelection` pre-selects a system; `preview` (a mission's destination) also centres on it,
 * rings it and shows its label, without touching the plotted course. Opened from a planet it listens to the planet group (N or Esc close it).
 */
export function showStarMap(ctx: UiContext, opts: { onClose?: () => void; initialSelection?: string; preview?: { systemId: string; label: string } } = {}): void {
  const { controller } = ctx;
  const { data } = controller;
  const fromPlanet = controller.landedPlanetId !== null;
  const closeAction = fromPlanet ? 'openMap' : 'map';
  const close = () => {
    ctx.unmount();
    if (opts.onClose) opts.onClose();
    else controller.startFlight();
  };

  // ---- view box: zoom and pan ---------------------------------------------
  const all = visibleSystems(data, controller.world.flags);
  const bx = Math.min(...all.map((s) => s.mapPos.x)) - PAD;
  const by = Math.min(...all.map((s) => s.mapPos.y)) - PAD;
  const bw = Math.max(...all.map((s) => s.mapPos.x)) + PAD - bx;
  const bh = Math.max(...all.map((s) => s.mapPos.y)) + PAD - by;
  const view = { cx: bx + bw / 2, cy: by + bh / 2, z: 1 };

  const root = svg('svg', { class: 'sw-starmap-svg', role: 'img', 'aria-label': 'Star map' });
  const lanesLayer = svg('g', { class: 'sw-map-lanes' });
  const routeLayer = svg('g', { class: 'sw-map-routes' });
  const nodesLayer = svg('g', { class: 'sw-map-nodes' });
  root.append(lanesLayer, routeLayer, nodesLayer);
  const nodeGroups: { g: SVGGElement; x: number; y: number }[] = [];

  /** Map units per screen pixel at the current zoom (the SVG scales uniformly, centered). */
  const unitsPerPx = () => {
    const r = root.getBoundingClientRect();
    const w = bw / view.z;
    const h = bh / view.z;
    if (r.width <= 0 || r.height <= 0) return w / 800;
    return Math.max(w / r.width, h / r.height);
  };

  const applyView = () => {
    view.z = Math.min(MAX_ZOOM, Math.max(1, view.z));
    const w = bw / view.z;
    const h = bh / view.z;
    view.cx = Math.min(bx + bw - w / 2, Math.max(bx + w / 2, view.cx));
    view.cy = Math.min(by + bh - h / 2, Math.max(by + h / 2, view.cy));
    root.setAttribute('viewBox', `${view.cx - w / 2} ${view.cy - h / 2} ${w} ${h}`);
    // Systems keep their on-screen size at every zoom: each is drawn in px and scaled back.
    const k = unitsPerPx();
    for (const n of nodeGroups) n.g.setAttribute('transform', `translate(${n.x} ${n.y}) scale(${k})`);
  };

  /** Zoom by `factor`, keeping the map point under (clientX, clientY) in place; center by default. */
  const zoomBy = (factor: number, clientX?: number, clientY?: number) => {
    const w = bw / view.z;
    const h = bh / view.z;
    const r = root.getBoundingClientRect();
    let fx = 0.5;
    let fy = 0.5;
    if (clientX !== undefined && clientY !== undefined && r.width > 0 && r.height > 0) {
      const upp = Math.max(w / r.width, h / r.height);
      // Offsets of the letterboxed drawing inside the element.
      const ox = (r.width - w / upp) / 2;
      const oy = (r.height - h / upp) / 2;
      fx = Math.min(1, Math.max(0, (clientX - r.left - ox) / (w / upp)));
      fy = Math.min(1, Math.max(0, (clientY - r.top - oy) / (h / upp)));
    }
    const mx = view.cx - w / 2 + fx * w;
    const my = view.cy - h / 2 + fy * h;
    view.z = Math.min(MAX_ZOOM, Math.max(1, view.z * factor));
    const nw = bw / view.z;
    const nh = bh / view.z;
    view.cx = mx - fx * nw + nw / 2;
    view.cy = my - fy * nh + nh / 2;
    applyView();
  };

  // ---- pointer: drag to pan, pinch to zoom, wheel --------------------------
  const pointers = new Map<number, { x: number; y: number }>();
  let travel = 0;
  let dragged = false;
  let pinch: { dist: number } | null = null;
  const pinchDist = () => {
    const [a, b] = [...pointers.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  };
  root.addEventListener('pointerdown', (e) => {
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 1) {
      travel = 0;
      dragged = false;
    }
    pinch = pointers.size === 2 ? { dist: pinchDist() } : null;
  });
  root.addEventListener('pointermove', (e) => {
    const prev = pointers.get(e.pointerId);
    if (!prev) return;
    const cur = { x: e.clientX, y: e.clientY };
    pointers.set(e.pointerId, cur);
    if (pointers.size === 2 && pinch) {
      const d = pinchDist();
      const [a, b] = [...pointers.values()];
      if (pinch.dist > 0) zoomBy(d / pinch.dist, (a.x + b.x) / 2, (a.y + b.y) / 2);
      pinch.dist = d;
      dragged = true;
      return;
    }
    travel += Math.hypot(cur.x - prev.x, cur.y - prev.y);
    if (travel < DRAG_PX && !dragged) return;
    if (!dragged) {
      dragged = true;
      try {
        root.setPointerCapture(e.pointerId);
      } catch {
        // Synthetic events have no pointer to capture.
      }
    }
    const upp = unitsPerPx();
    view.cx -= (cur.x - prev.x) * upp;
    view.cy -= (cur.y - prev.y) * upp;
    applyView();
  });
  const release = (e: PointerEvent) => {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
  };
  root.addEventListener('pointerup', release);
  root.addEventListener('pointercancel', release);
  root.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      if (e.deltaY !== 0) zoomBy(e.deltaY < 0 ? 1.25 : 1 / 1.25, e.clientX, e.clientY);
    },
    { passive: false },
  );

  // ---- side panel ----------------------------------------------------------
  const preview = opts.preview && data.systems[opts.preview.systemId] ? opts.preview : undefined;
  if (preview) {
    const at = data.systems[preview.systemId].mapPos;
    view.z = PREVIEW_ZOOM;
    view.cx = at.x;
    view.cy = at.y;
  }
  let selected =
    preview?.systemId ??
    (opts.initialSelection && data.systems[opts.initialSelection] ? opts.initialSelection : undefined) ??
    controller.world.route.at(-1) ??
    controller.world.systemId;
  const info = el('div', { class: 'sw-map-info', attrs: { 'data-testid': 'map-info', 'aria-live': 'polite' } });
  const routeText = el('p', { class: 'sw-map-routetext', attrs: { 'data-testid': 'map-route' } });
  const setBtn = button('Set course', () => {
    controller.plotRoute(selected);
    render();
  });
  const clearBtn = button('Clear course', () => {
    controller.clearRoute();
    render();
  });
  const closeBtn = button('Close', close, { class: 'sw-btn-primary', hotkey: hotkeyFor(controller.settings.bindings, closeAction) });

  const select = (id: string) => {
    if (dragged) return; // the press was a pan, not a pick
    selected = id;
    render();
  };

  function drawNodes(world: WorldState): void {
    const model = mapModel(world, data);
    const byId = new Map(model.nodes.map((n) => [n.id, n]));
    lanesLayer.replaceChildren(
      ...model.lanes.map(([a, b]) => {
        const p = byId.get(a)!;
        const q = byId.get(b)!;
        const dim = p.state === 'unknown' || q.state === 'unknown';
        return svg('line', { x1: p.x, y1: p.y, x2: q.x, y2: q.y, class: dim ? 'sw-map-lane sw-map-lane-dim' : 'sw-map-lane' });
      }),
    );
    // Nodes are rebuilt on every render; remember which system had keyboard focus.
    const focused = (document.activeElement as Element | null)?.closest?.('[data-system]');
    const focusedId = focused && nodesLayer.contains(focused) ? focused.getAttribute('data-system') : null;
    nodeGroups.length = 0;
    nodesLayer.replaceChildren(
      ...model.nodes.map((n) => {
        const cls = ['sw-map-sys', `sw-sys-${n.state}`];
        if (n.current) cls.push('sw-map-here');
        if (n.id === selected) cls.push('sw-map-selected');
        if (n.id === preview?.systemId) cls.push('sw-map-preview');
        const g = svg('g', {
          class: cls.join(' '),
          'data-system': n.id,
          role: 'button',
          tabindex: 0,
          'aria-label': n.name ?? 'Unexplored system',
        });
        g.append(svg('circle', { r: 20, class: 'sw-map-hit' }));
        if (n.id === preview?.systemId) g.append(svg('circle', { r: 20, class: 'sw-map-prev' }));
        if (n.id === selected) g.append(svg('circle', { r: 15, class: 'sw-map-sel' }));
        if (n.current) g.append(svg('circle', { r: 12, class: 'sw-map-ring' }));
        const dot = svg('circle', { r: 7, class: 'sw-map-dot' });
        // Inline style: beats the stylesheet's default dot fill and stroke.
        if (n.state === 'known') dot.style.fill = n.color;
        if (n.state !== 'unknown') dot.style.stroke = n.color;
        g.append(dot);
        if (n.flag) g.append(svg('path', { d: 'M8 -8 V-24 L19 -19.5 L8 -15', class: 'sw-map-flag' }));
        if (n.name !== null) g.append(svg('text', { y: -16, class: 'sw-map-name' }, n.name));
        g.addEventListener('click', () => select(n.id));
        g.addEventListener('keydown', (e) => {
          if (e.key !== 'Enter' && e.key !== ' ') return;
          e.preventDefault();
          dragged = false;
          select(n.id);
        });
        nodeGroups.push({ g, x: n.x, y: n.y });
        return g;
      }),
    );
    if (focusedId) nodesLayer.querySelector<SVGGElement>(`[data-system="${focusedId}"]`)?.focus();
  }

  function render(): void {
    const world = controller.world;
    drawNodes(world);

    // Plotted course (faint), then the selected system's route: solid while the fuel lasts.
    const summary = routeSummary(world, data, selected, { anyLane: preview?.systemId === selected });
    routeLayer.replaceChildren();
    if (world.route.length > 0) {
      routeLayer.append(svg('polyline', { points: points([world.systemId, ...world.route], data), class: 'sw-map-course' }));
    }
    if (summary.route && summary.route.length > 0) {
      const path = [world.systemId, ...summary.route];
      const ok = path.slice(0, Math.min(path.length, summary.reachable + 1));
      if (ok.length > 1) routeLayer.append(svg('polyline', { points: points(ok, data), class: 'sw-map-route sw-map-route-ok' }));
      if (ok.length < path.length) {
        routeLayer.append(svg('polyline', { points: points(path.slice(ok.length - 1), data), class: 'sw-map-route sw-map-route-short' }));
      }
    }

    const d = systemDetails(selected, world, data);
    info.replaceChildren(
      el('div', { class: 'sw-map-date', text: formatDate(world.day, data.config) }),
      el('h2', { class: 'sw-map-sysname', text: d.title }),
      el(
        'dl',
        { class: 'sw-map-rows' },
        d.rows.flatMap((r) => [el('dt', { text: r.label }), el('dd', { text: r.value })]),
      ),
    );
    routeText.textContent = summary.text;
    routeText.classList.toggle('sw-map-short', summary.short);

    // A previewed (not yet accepted) job's route may cross uncharted lanes that setRoute refuses: Set course needs a plottable one.
    const plottable = preview?.systemId === selected ? routeSummary(world, data, selected).route : summary.route;
    const hasRoute = !!plottable && plottable.length > 0;
    setBtn.disabled = !hasRoute || world.route.at(-1) === selected;
    clearBtn.disabled = world.route.length === 0;
    applyView();
  }

  const zoomButton = (label: string, text: string, onClick: () => void) =>
    el('button', { class: 'sw-btn sw-map-zoombtn', text, attrs: { type: 'button', 'aria-label': label }, onClick });

  const hint = guideCard(controller, ctx.root);
  const screen = el('div', { class: 'sw-screen sw-overlay sw-starmap-screen', attrs: { 'data-testid': 'star-map' } }, [
    el('div', { class: 'sw-panel sw-starmap' }, [
      el('div', { class: 'sw-starmap-view' }, [
        root,
        el('div', { class: 'sw-map-zoom' }, [
          zoomButton('Zoom in', '+', () => zoomBy(ZOOM_STEP)),
          zoomButton('Zoom out', '−', () => zoomBy(1 / ZOOM_STEP)),
          zoomButton('Show whole galaxy', '⤢', () => {
            view.z = 1;
            applyView();
          }),
        ]),
      ]),
      el('div', { class: 'sw-starmap-side' }, [
        el('h1', { class: 'sw-title', text: 'Star Map' }),
        ...(preview ? [el('p', { class: 'sw-map-preview-label', text: preview.label, attrs: { 'data-testid': 'map-preview' } })] : []),
        info,
        routeText,
        hint.node,
        el('div', { class: 'sw-actions' }, [el('div', { class: 'sw-actions sw-actions-row' }, [setBtn, clearBtn]), closeBtn]),
      ]),
    ]),
  ]);

  const onResize = () => applyView();
  window.addEventListener('resize', onResize);
  ctx.mount(screen, {
    groups: fromPlanet ? ['planet', 'menus'] : ['flight', 'menus'],
    onPress: (pressed) => {
      if (pressed.has(closeAction) || pressed.has('back')) close();
    },
    cleanup: () => {
      window.removeEventListener('resize', onResize);
      hint.dispose();
    },
    guide: 'map',
  });
  render();
}
