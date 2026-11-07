import type { RawGameData } from '../data/load';
import type { Plugin } from '../plugins/format';
import { baseRecords, recordsOf, upsert, type Rec } from './model';

type Sys = Rec & { name?: string; mapPos: { x: number; y: number }; links: string[] };

/** The systems as the game would see them with this plug-in: base records, each replaced by the plug-in's own. */
export function effectiveSystems(raw: RawGameData, p: Plugin): Sys[] {
  const mine = new Map(recordsOf(p, 'systems').map((r) => [r.id, r as Sys]));
  const out: Sys[] = baseRecords(raw, 'systems').map((r) => mine.get(r.id) ?? (r as Sys));
  for (const r of mine.values()) if (!out.some((s) => s.id === r.id)) out.push(r);
  return out;
}

/** The plug-in's copy of a system, copying the base record in first when it has none. */
function ownCopy(raw: RawGameData, p: Plugin, id: string): { plugin: Plugin; sys: Sys } | null {
  const mine = recordsOf(p, 'systems').find((r) => r.id === id) as Sys | undefined;
  if (mine) return { plugin: p, sys: mine };
  const base = baseRecords(raw, 'systems').find((r) => r.id === id) as Sys | undefined;
  if (!base) return null;
  const sys = JSON.parse(JSON.stringify(base)) as Sys;
  return { plugin: upsert(p, 'systems', sys), sys };
}

/** Move a plug-in system to a map position (whole numbers). */
export function placeSystem(p: Plugin, id: string, at: { x: number; y: number }): Plugin {
  const sys = recordsOf(p, 'systems').find((r) => r.id === id) as Sys | undefined;
  if (!sys) return p;
  return upsert(p, 'systems', { ...sys, mapPos: { x: Math.round(at.x), y: Math.round(at.y) } });
}

/**
 * Add a lane between two systems, or remove it if there is one. Lanes go both ways in the game, so both records
 * change; a base system the plug-in hasn't touched yet is copied into it first.
 */
export function toggleLane(raw: RawGameData, p: Plugin, a: string, b: string): Plugin {
  if (a === b) return p;
  const ca = ownCopy(raw, p, a);
  if (!ca) return p;
  const cb = ownCopy(raw, ca.plugin, b);
  if (!cb) return p;
  const linked = ca.sys.links.includes(b);
  const flip = (s: Sys, other: string): Sys => ({ ...s, links: linked ? s.links.filter((l) => l !== other) : [...s.links, other] });
  const sysA = recordsOf(cb.plugin, 'systems').find((r) => r.id === a) as Sys;
  return upsert(upsert(cb.plugin, 'systems', flip(sysA, b)), 'systems', flip(cb.sys, a));
}

const SVG = 'http://www.w3.org/2000/svg';
const svgEl = (tag: string, attrs: Record<string, string | number>, text?: string) => {
  const n = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
  if (text !== undefined) n.textContent = text;
  return n;
};

/**
 * The map view (editor spec §6): every system and lane; the plug-in's systems drawn brighter. With one of them
 * selected, a click on empty space moves it there and a click on another system adds or removes a lane.
 */
export function systemMap(raw: RawGameData, p: Plugin, selected: string | null, act: { move(at: { x: number; y: number }): void; link(other: string): void }): SVGSVGElement {
  const systems = effectiveSystems(raw, p);
  const mine = new Set(recordsOf(p, 'systems').map((r) => r.id));
  const xs = systems.map((s) => s.mapPos.x);
  const ys = systems.map((s) => s.mapPos.y);
  const pad = 120;
  const [x0, y0] = [Math.min(...xs) - pad, Math.min(...ys) - pad];
  const [w, h] = [Math.max(...xs) - x0 + pad, Math.max(...ys) - y0 + pad];
  const svg = svgEl('svg', { class: 'sw-ed-map', viewBox: `${x0} ${y0} ${w} ${h}`, role: 'img', 'aria-label': 'System map', 'data-testid': 'editor-map' }) as SVGSVGElement;
  const byId = new Map(systems.map((s) => [s.id, s]));
  const drawn = new Set<string>();
  for (const s of systems)
    for (const l of s.links) {
      const o = byId.get(l);
      const key = [s.id, l].sort().join('|');
      if (!o || drawn.has(key)) continue;
      drawn.add(key);
      svg.append(svgEl('line', { x1: s.mapPos.x, y1: s.mapPos.y, x2: o.mapPos.x, y2: o.mapPos.y, class: mine.has(s.id) || mine.has(l) ? 'sw-ed-lane sw-ed-lane-mine' : 'sw-ed-lane' }));
    }
  for (const s of systems) {
    const g = svgEl('g', { class: `sw-ed-sys${mine.has(s.id) ? ' sw-ed-sys-mine' : ''}${s.id === selected ? ' sw-ed-sys-on' : ''}`, 'data-system': s.id, transform: `translate(${s.mapPos.x} ${s.mapPos.y})` });
    g.append(svgEl('circle', { r: 14 }), svgEl('text', { y: -20 }, s.name ?? s.id));
    g.addEventListener('click', (e) => {
      e.stopPropagation();
      if (selected && selected !== s.id) act.link(s.id);
    });
    svg.append(g);
  }
  svg.addEventListener('click', (e) => {
    if (!selected || !mine.has(selected)) return;
    const m = svg.getScreenCTM();
    if (!m) return;
    const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    act.move({ x: pt.x, y: pt.y });
  });
  return svg;
}
