import type { SystemDef } from '../data/schemas';
import type { UiContext } from './context';
import { button, el, hotkeyFor } from './dom';

const SVG_NS = 'http://www.w3.org/2000/svg';

function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>, text?: string) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  if (text !== undefined) node.textContent = text;
  return node;
}

/** SVG star map of every system at its mapPos, links as lines, current system marked. */
export function starMapSvg(systems: SystemDef[], currentId: string): SVGSVGElement {
  const pad = 80;
  const xs = systems.map((s) => s.mapPos.x);
  const ys = systems.map((s) => s.mapPos.y);
  const minX = Math.min(...xs) - pad, maxX = Math.max(...xs) + pad;
  const minY = Math.min(...ys) - pad, maxY = Math.max(...ys) + pad;
  const root = svg('svg', {
    viewBox: `${minX} ${minY} ${maxX - minX} ${maxY - minY}`,
    class: 'sw-map-svg',
    role: 'img',
    'aria-label': 'Star map',
  });
  const byId = new Map(systems.map((s) => [s.id, s]));
  const drawn = new Set<string>();
  for (const s of systems) {
    for (const l of s.links) {
      const o = byId.get(l);
      const key = [s.id, l].sort().join('|');
      if (!o || drawn.has(key)) continue;
      drawn.add(key);
      root.append(svg('line', { x1: s.mapPos.x, y1: s.mapPos.y, x2: o.mapPos.x, y2: o.mapPos.y, class: 'sw-map-link' }));
    }
  }
  for (const s of systems) {
    const here = s.id === currentId;
    const g = svg('g', { class: here ? 'sw-map-sys sw-map-here' : 'sw-map-sys' });
    if (here) g.append(svg('circle', { cx: s.mapPos.x, cy: s.mapPos.y, r: 18, class: 'sw-map-ring' }));
    g.append(svg('circle', { cx: s.mapPos.x, cy: s.mapPos.y, r: 8, class: 'sw-map-dot' }));
    g.append(svg('text', { x: s.mapPos.x, y: s.mapPos.y - 26, class: 'sw-map-name' }, s.name));
    if (here) g.append(svg('text', { x: s.mapPos.x, y: s.mapPos.y + 38, class: 'sw-map-here-label' }, 'You are here'));
    root.append(g);
  }
  return root;
}

/** Placeholder star map, opened from flight by `map`; `map` or `back` closes it. Sim is paused. */
export function showMap(ctx: UiContext): void {
  const { controller } = ctx;
  const close = () => {
    ctx.unmount();
    controller.startFlight();
  };
  const systems = Object.values(controller.data.systems);
  const screen = el('div', { class: 'sw-screen sw-overlay', attrs: { 'data-testid': 'star-map' } }, [
    el('div', { class: 'sw-panel sw-map' }, [
      el('h1', { class: 'sw-title', text: 'Star Map' }),
      el('div', { class: 'sw-map-frame' }, [starMapSvg(systems, controller.world.systemId)]),
      el('div', { class: 'sw-actions sw-actions-row' }, [
        button('Close', close, { class: 'sw-btn-primary', hotkey: hotkeyFor(controller.settings.bindings, 'map') }),
      ]),
    ]),
  ]);
  ctx.mount(screen, {
    groups: ['flight', 'menus'],
    onPress: (pressed) => {
      if (pressed.has('map') || pressed.has('back')) close();
    },
  });
}
