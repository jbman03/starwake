import type { OutfitDef } from '../data/schemas';
import { OUTFIT_BLOCK_TEXT, outfitSellCheck } from '../sim/outfitter';
import { worldStats } from '../sim/shipStats';
import { outfitStock } from '../sim/stock';
import type { UiContext } from './context';
import { formatCredits } from './dom';
import { outfitIcon } from './icons';
import { infoBlock, showShop, type ShopItem } from './shop';

/** One-line effect of an outfit, e.g. "+5 t cargo". */
function effectText(def: OutfitDef, fuelPerJump: number): string {
  switch (def.category) {
    case 'cargo':
      return `+${def.effect.cargo} t cargo`;
    case 'fuel': {
      const jumps = fuelPerJump > 0 ? def.effect.fuel / fuelPerJump : 0;
      return `+${def.effect.fuel} fuel (${Number.isInteger(jumps) ? jumps : jumps.toFixed(1)} jump${jumps === 1 ? '' : 's'})`;
    }
    case 'armor':
      return `+${def.effect.armor} armor`;
    case 'shields':
      return `+${def.effect.shields} shields`;
    case 'map':
      return `Charts systems within ${def.effect.mapJumps} jumps`;
    case 'scoop':
      return `Gathers ${def.effect.fuelPerMin} fuel per minute while drifting`;
  }
}

/** The outfitter: this port's outfits as a paged grid with owned-count badges; Buy and Sell one at a time. */
export function showOutfitter(ctx: UiContext, planetId: string, onClose: () => void): void {
  const { controller } = ctx;
  const { data } = controller;
  const port = data.planets[planetId];

  const items = (): ShopItem[] =>
    outfitStock(planetId, data).map((def) => {
      const w = controller.world;
      const owned = w.outfits[def.id] ?? 0;
      const buy = controller.outfitQuote(def.id);
      const sell = outfitSellCheck(w, data, def.id);
      const isMap = def.category === 'map';
      const rows: [string, string][] = [
        ['Effect', effectText(def, data.config.fuelPerJump)],
        ['Space', `${def.space} t`],
        ['Max', isMap ? 'One-time' : String(def.max)],
        ['Fitted', isMap ? '-' : String(owned)],
        ['Price', formatCredits(def.price)],
      ];
      const notes: string[] = [];
      if (owned > 0 && sell.ok) {
        rows.push(['Resale value', formatCredits(sell.refund)]);
        if (sell.fuelLost > 0) notes.push(`Selling one drains ${sell.fuelLost} fuel to fit the smaller tank.`);
      } else if (owned > 0 && !sell.ok) {
        notes.push(OUTFIT_BLOCK_TEXT[sell.reason]);
      }
      if (!isMap) {
        const space = worldStats(w, data);
        notes.push(`Free outfit space: ${space.spaceFree} of ${space.outfitSpace} t.`);
      }
      return {
        id: def.id,
        name: def.name,
        icon: () => outfitIcon(def, 48),
        badge: owned > 0 ? String(owned) : undefined,
        canBuy: buy.ok,
        reason: buy.ok ? undefined : OUTFIT_BLOCK_TEXT[buy.reason],
        canSell: sell.ok,
        info: () => infoBlock(def.name, def.description, rows, notes),
      };
    });

  showShop(ctx, {
    title: `${port.name} · Outfitter`,
    testId: 'outfitter',
    items,
    onClose,
    onBuy: (id, say) => {
      const r = controller.buyOutfit(id);
      const def = data.outfits[id];
      if (r.ok) say(`Bought ${def.name} for ${formatCredits(def.price)}.`);
      else say(OUTFIT_BLOCK_TEXT[r.reason], true);
    },
    onSell: (id, say) => {
      const r = controller.sellOutfit(id);
      const def = data.outfits[id];
      if (r.ok) say(`Sold ${def.name} for ${formatCredits(r.refund)}.`);
      else say(OUTFIT_BLOCK_TEXT[r.reason], true);
    },
  });
}
