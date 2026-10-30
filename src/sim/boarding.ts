import type { GameData } from '../data/schemas';
import { cargoFree } from './cargo';
import { hashString, mulberry32 } from './random';
import { shipStats } from './shipStats';
import { tradeInValue } from './shipyard';
import type { Npc } from './traffic';
import type { WorldState } from './types';
import { weaponsOf, ammoCap } from './weapons';

export interface Loot {
  credits: number;
  cargo: Record<string, number>;
  ammo: Record<string, number>;
}

const round10 = (n: number): number => Math.round(n / 10) * 10;

/** Disabled, close and slow relative to the player. */
export function canBoard(world: WorldState, data: GameData, npc: Npc): boolean {
  const b = data.combat.boarding;
  if (!npc.hull.disabled) return false;
  const d = Math.hypot(npc.ship.pos.x - world.ship.pos.x, npc.ship.pos.y - world.ship.pos.y);
  const rel = Math.hypot(npc.ship.vel.x - world.ship.vel.x, npc.ship.vel.y - world.ship.vel.y);
  return d <= b.range && rel <= b.maxSpeed;
}

/** What the ship holds: credits, trade goods (traders only) and its ammo. Seeded by (seed, 'loot', npc.id). */
export function lootOf(world: WorldState, data: GameData, npc: Npc): Loot {
  const b = data.combat.boarding;
  const r = mulberry32(hashString(world.seed, 'loot', npc.id));
  const hull = data.ships[npc.shipId];
  const [cLo, cHi] = b.creditsFraction;
  const credits = round10(hull.price * (cLo + r() * (cHi - cLo)));
  const cargo: Record<string, number> = {};
  if (npc.role === 'trader' && hull.cargo > 0) {
    const [fLo, fHi] = b.cargoFraction;
    const tons = Math.max(1, Math.round(hull.cargo * (fLo + r() * (fHi - fLo))));
    const goods = Object.keys(data.commodities).sort();
    const kinds = tons >= 2 && r() < b.twoGoodsChance ? 2 : 1;
    const first = goods[Math.floor(r() * goods.length)];
    if (kinds === 1) cargo[first] = tons;
    else {
      const rest = goods.filter((g) => g !== first);
      const second = rest[Math.floor(r() * rest.length)];
      const [sLo, sHi] = b.twoGoodsSplit;
      const part = Math.min(tons - 1, Math.max(1, Math.round(tons * (sLo + r() * (sHi - sLo)))));
      cargo[first] = part;
      cargo[second] = tons - part;
    }
  }
  const ammo: Record<string, number> = {};
  for (const [id, n] of Object.entries(npc.outfits)) if (n > 0 && data.outfits[id]?.category === 'ammo') ammo[id] = n;
  return { credits, cargo, ammo };
}

export function captureOdds(world: WorldState, data: GameData, npc: Npc): number {
  const b = data.combat.boarding;
  const mine = data.ships[world.shipId].crew;
  const theirs = data.ships[npc.shipId].crew;
  const raw = (b.captureBase * mine) / theirs;
  return Math.round(Math.min(b.captureMax, Math.max(b.captureMin, raw)) * 100) / 100;
}

export function captureSucceeds(world: WorldState, data: GameData, npc: Npc): boolean {
  return mulberry32(hashString(world.seed, 'capture', npc.id))() < captureOdds(world, data, npc);
}

interface Taken {
  world: WorldState;
  loot: Loot;
  text: string;
}

export function takeCredits(world: WorldState, loot: Loot): Taken {
  const n = loot.credits;
  return {
    world: { ...world, credits: world.credits + n },
    loot: { ...loot, credits: 0 },
    text: n > 0 ? `Took ${n} credits.` : 'No credits to take.',
  };
}

/** Up to the free hold, highest-value goods first. */
export function takeCargo(world: WorldState, data: GameData, loot: Loot): Taken {
  let free = cargoFree(world, data);
  const cargo = { ...world.cargo };
  const left: Record<string, number> = { ...loot.cargo };
  const took: string[] = [];
  const ids = Object.keys(left).sort((a, b) => (data.commodities[b]?.basePrice ?? 0) - (data.commodities[a]?.basePrice ?? 0) || a.localeCompare(b));
  for (const id of ids) {
    const n = Math.min(free, left[id]);
    if (n <= 0) continue;
    cargo[id] = (cargo[id] ?? 0) + n;
    left[id] -= n;
    if (left[id] <= 0) delete left[id];
    free -= n;
    took.push(`${n} t of ${data.commodities[id]?.name ?? id}`);
  }
  return {
    world: { ...world, cargo },
    loot: { ...loot, cargo: left },
    text: took.length ? `Took ${took.join(', ')}.` : Object.keys(loot.cargo).length ? 'No room in your hold.' : 'No cargo to take.',
  };
}

/** Only ammo your launchers fire, up to what they can hold. */
export function takeAmmo(world: WorldState, data: GameData, loot: Loot): Taken {
  const outfits = { ...world.outfits };
  const left: Record<string, number> = { ...loot.ammo };
  const took: string[] = [];
  const fired = new Set(weaponsOf(world.outfits, data).launchers.map((l) => l.def.effect.ammo));
  for (const id of Object.keys(left).sort()) {
    if (!fired.has(id)) continue;
    const n = Math.min(left[id], Math.max(0, ammoCap(world.outfits, id, data) - (outfits[id] ?? 0)));
    if (n <= 0) continue;
    outfits[id] = (outfits[id] ?? 0) + n;
    left[id] -= n;
    if (left[id] <= 0) delete left[id];
    took.push(`${n} ${data.outfits[id]?.name ?? id}`);
  }
  return {
    world: { ...world, outfits },
    loot: { ...loot, ammo: left },
    text: took.length ? `Took ${took.join(', ')}.` : 'Nothing your launchers can use.',
  };
}

export type CommandCheck = { ok: true } | { ok: false; reason: 'cargo' | 'berths' | 'space' };

export const COMMAND_BLOCK_TEXT: Record<'cargo' | 'berths' | 'space', string> = {
  cargo: "Her hold can't take your cargo",
  berths: 'Not enough berths for your passengers',
  space: "Her outfits don't fit her hull",
};

export function canTakeCommand(world: WorldState, data: GameData, npc: Npc): CommandCheck {
  const her = shipStats(npc.shipId, npc.outfits, data);
  let tons = 0;
  for (const t of Object.values(world.cargo)) tons += t;
  for (const m of world.missions) tons += m.tons;
  if (tons > her.cargo) return { ok: false, reason: 'cargo' };
  let pax = 0;
  for (const m of world.missions) pax += m.passengers;
  if (pax > her.passengers) return { ok: false, reason: 'berths' };
  if (her.spaceFree < 0) return { ok: false, reason: 'space' };
  return { ok: true };
}

/** Swap into the captured ship. The caller checks canTakeCommand first. */
export function takeCommand(world: WorldState, data: GameData, npc: Npc): WorldState {
  const her = shipStats(npc.shipId, npc.outfits, data);
  return {
    ...world,
    credits: world.credits + tradeInValue(world, data),
    shipId: npc.shipId,
    outfits: { ...npc.outfits },
    shipName: npc.name,
    ship: { ...world.ship, fuel: Math.min(world.ship.fuel, her.fuelCapacity) },
    stats: { ...world.stats, captures: world.stats.captures + 1 },
  };
}

export function prizeValue(data: GameData, npc: Npc): number {
  return round10(data.combat.boarding.prizeFraction * data.ships[npc.shipId].price);
}

export function sellPrize(world: WorldState, data: GameData, npc: Npc): WorldState {
  return { ...world, credits: world.credits + prizeValue(data, npc), stats: { ...world.stats, captures: world.stats.captures + 1 } };
}
