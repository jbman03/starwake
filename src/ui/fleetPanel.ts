import type { GameData } from '../data/schemas';
import { formatDate } from '../sim/calendar';
import { escortMaxArmor, ORDER_LABEL } from '../sim/escorts';
import { presentEscorts } from '../sim/escortNpcs';
import { wingmanDef, wingmanRank } from '../sim/wingmen';
import type { Traffic } from '../sim/traffic';
import type { Escort, WorldState } from '../sim/types';
import type { UiContext } from './context';
import { button, el, hotkeyFor } from './dom';

export interface FleetRow {
  id: string;
  /** "Wren Halloway — Kestrel Interceptor". */
  name: string;
  /** "Flying with you · armor 64%", "Left behind: rejoins at your next landing", ... */
  status: string;
}

/**
 * What the Fleet panel shows (playtest: escorts and Wasps seemed to vanish with no trace): every escort and its
 * state, the fighters aboard and out, and the group's order. In flight, armor comes from the ship out in space.
 */
export function fleetRows(world: WorldState, data: GameData, traffic: Traffic | null): { rows: FleetRow[]; fighters: string | null; order: string } {
  const out = new Map((traffic ? presentEscorts(traffic) : []).map((n) => [n.id, n]));
  const pct = (armor: number, max: number) => `${Math.round((100 * Math.max(0, armor)) / Math.max(1, max))}%`;
  const statusOf = (e: Escort): string => {
    const w = wingmanDef(data, e);
    const rank = w ? ` · ${wingmanRank(data, e.takedowns ?? 0).name} wingman` : '';
    if (e.downUntilDay !== undefined) return `Ejected: back from ${formatDate(e.downUntilDay, data.config)} at a landing${rank}`;
    if (e.leaving) return `Unpaid: leaves at your next landing${rank}`;
    if (e.waiting) return `Left behind: rejoins at your next landing${rank}`;
    const n = out.get(e.id);
    if (n) return `${n.hull.disabled ? 'Disabled' : 'Flying with you'} · armor ${pct(n.hull.armor, n.hull.maxArmor)}${rank}`;
    return `${traffic ? 'Not in this system' : 'Docked with you'} · armor ${pct(e.armor, escortMaxArmor(data, e))}${rank}`;
  };
  const rows = world.escorts.map((e) => ({ id: e.id, name: `${e.name} — ${data.ships[e.shipId]?.name ?? e.shipId}`, status: statusOf(e) }));
  let fighters: string | null = null;
  const bays = Object.entries(world.outfits).filter(([id]) => data.outfits[id]?.category === 'bay');
  if (bays.length) {
    const aboard = bays.reduce((n, [id]) => {
      const def = data.outfits[id];
      return def.category === 'bay' ? n + (world.outfits[def.effect.fighter] ?? 0) : n;
    }, 0);
    const flying = traffic ? traffic.npcs.filter((n) => n.fighter?.carrierId === 'player') : [];
    fighters = `Fighters: ${aboard} aboard, ${flying.length} out${flying.some((n) => n.hull.disabled) ? ' (some disabled: lost if you leave)' : ''}`;
  }
  return { rows, fighters, order: `Order: ${ORDER_LABEL[world.escortOrder]}` };
}

/** The Fleet panel, in flight (its key, or the pause menu). Esc, the key or Done runs `onClose`. */
export function showFleetPanel(ctx: UiContext, onClose: () => void): void {
  const { controller } = ctx;
  const { data } = controller;
  const close = () => {
    ctx.unmount();
    onClose();
  };
  const view = fleetRows(controller.world, data, controller.landedPlanetId ? null : controller.traffic);
  const body =
    view.rows.length === 0 && !view.fighters
      ? [el('p', { class: 'sw-empty', text: 'No escorts or fighters. Hire escorts at a shipyard, recruit wingmen in bars, or fit a fighter bay to a carrier.' })]
      : [
          el('p', { class: 'sw-stat', text: view.order }),
          ...(view.fighters ? [el('p', { class: 'sw-stat', text: view.fighters, attrs: { 'data-testid': 'fleet-fighters' } })] : []),
          ...view.rows.map((r) =>
            el('div', { class: 'sw-escort-row', attrs: { 'data-fleet': r.id } }, [el('span', { text: r.name }), el('span', { class: 'sw-reason', text: r.status })]),
          ),
        ];
  const done = button('Done', close, { class: 'sw-btn-primary', hotkey: hotkeyFor(controller.settings.bindings, 'back') });
  const screen = el('div', { class: 'sw-screen sw-overlay', attrs: { 'data-testid': 'fleet-panel' } }, [
    el('div', { class: 'sw-panel sw-enc' }, [el('h2', { class: 'sw-enc-title', text: 'Fleet' }), el('div', { class: 'sw-escort-list' }, body), el('div', { class: 'sw-enc-actions' }, [done])]),
  ]);
  ctx.mount(screen, {
    groups: ['flight', 'menus'],
    onPress: (pressed) => {
      if (pressed.has('back') || pressed.has('fleet')) close();
    },
  });
}
