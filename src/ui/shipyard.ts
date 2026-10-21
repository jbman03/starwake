import { jumpsOf } from '../sim/fuel';
import { SHIP_BLOCK_TEXT } from '../sim/shipyard';
import { shipStock } from '../sim/stock';
import type { UiContext } from './context';
import { confirmDialog, formatCredits, promptDialog } from './dom';
import { cleanPilotName, NAME_MAX } from './mainMenu';
import { shipIcon } from './icons';
import { infoBlock, showShop, type ShopItem } from './shop';

const jumpsText = (n: number) => `${n} ${n === 1 ? 'jump' : 'jumps'}`;

/** The shipyard: this port's hulls as a paged grid; Buy trades in the current ship and fitted outfits. */
export function showShipyard(ctx: UiContext, planetId: string, onClose: () => void): void {
  const { controller } = ctx;
  const { data } = controller;
  const port = data.planets[planetId];

  const items = (): ShopItem[] =>
    shipStock(planetId, data).map((def) => {
      const q = controller.shipQuote(def.id);
      const w = controller.world;
      const owned = w.shipId === def.id;
      if (q.check.ok === false && q.check.reason === 'locked') {
        const silhouette = shipIcon(def, 56);
        silhouette.style.filter = 'brightness(0) opacity(0.35)';
        return {
          id: def.id,
          name: '???',
          icon: () => silhouette,
          canBuy: false,
          reason: SHIP_BLOCK_TEXT.locked,
          info: () => infoBlock('???', 'A hull the yard will not talk about. Someone here knows more than they say.', []),
        };
      }
      const fitted = Object.values(w.outfits).reduce((n, c) => n + c, 0);
      const notes =
        fitted > 0 && !owned
          ? [
              'Your fitted outfits go with your old ship: their added cargo, fuel, armor and shields are lost. The yard pays half their price in your trade-in.',
            ]
          : [];
      return {
        id: def.id,
        name: def.name,
        icon: () => shipIcon(def, 56),
        badge: owned ? 'Yours' : undefined,
        canBuy: q.check.ok,
        reason: q.check.ok ? undefined : SHIP_BLOCK_TEXT[q.check.reason],
        info: () =>
          infoBlock(
            def.name,
            def.description,
            [
              ['Cargo', `${def.cargo} t`],
              ['Berths', String(def.passengers)],
              ['Fuel', jumpsText(jumpsOf(def.fuelCapacity, data.config.fuelPerJump))],
              ['Shields', String(def.shields)],
              ['Armor', String(def.armor)],
              ['Outfit space', `${def.outfitSpace} t`],
              ['Speed', String(def.maxSpeed)],
              ['Turn', `${def.turnRate}°/s`],
              ['Price', formatCredits(q.price)],
              ['Trade-in', formatCredits(q.tradeIn)],
              ['Net cost', formatCredits(q.net)],
            ],
            notes,
          ),
      };
    });

  showShop(ctx, {
    title: `${port.name} · Shipyard`,
    testId: 'shipyard',
    items,
    onClose,
    onBuy: async (id, say) => {
      const q = controller.shipQuote(id);
      if (!q.check.ok) return say(SHIP_BLOCK_TEXT[q.check.reason], true);
      const from = data.ships[controller.world.shipId].name;
      const to = data.ships[id].name;
      const ok = await confirmDialog(ctx.root, {
        title: `Trade in your ${from} and buy ${to} for ${formatCredits(q.net)}?`,
        message: Object.values(controller.world.outfits).some((c) => c > 0) ? 'Your fitted outfits go with the old ship.' : undefined,
        confirm: 'Buy ship',
      });
      if (!ok) return;
      const r = controller.buyShip(id);
      if (!r.check.ok) return say(SHIP_BLOCK_TEXT[r.check.reason], true);
      // Cancel (Esc) keeps the hull's own name.
      const raw = await promptDialog(ctx.root, {
        title: `Name your ${to}`,
        label: 'Ship name',
        value: to,
        maxLength: NAME_MAX,
        confirm: 'Name ship',
      });
      const named = raw === null ? to : cleanPilotName(raw);
      controller.nameShip(named);
      say(named === to ? `You now fly the ${to}.` : `You now fly the ${to}, ${named}.`);
    },
  });
}
