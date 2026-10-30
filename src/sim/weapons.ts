import type { GameData, OutfitDef, ShipDef } from '../data/schemas';

export type GunDef = Extract<OutfitDef, { category: 'gun' | 'turret' }>;
export type BeamDef = Extract<OutfitDef, { category: 'beam' }>;
export type LauncherDef = Extract<OutfitDef, { category: 'launcher' }>;
export type AmmoDef = Extract<OutfitDef, { category: 'ammo' }>;

export interface Weapons {
  guns: { def: GunDef; count: number }[];
  beams: { def: BeamDef; count: number }[];
  launchers: { def: LauncherDef; count: number }[];
}

/** The weapons among a set of outfits, each group ordered by outfit id. Unknown ids and non-weapons are skipped. */
export function weaponsOf(outfits: Record<string, number>, data: GameData): Weapons {
  const out: Weapons = { guns: [], beams: [], launchers: [] };
  for (const id of Object.keys(outfits).sort()) {
    const count = outfits[id];
    const def = data.outfits[id];
    if (!def || !(count > 0)) continue;
    if (def.category === 'gun' || def.category === 'turret') out.guns.push({ def, count });
    else if (def.category === 'beam') out.beams.push({ def, count });
    else if (def.category === 'launcher') out.launchers.push({ def, count });
  }
  return out;
}

/** How many of an ammo the ship can carry: its `max` times the launchers that fire it. */
export function ammoCap(outfits: Record<string, number>, ammoId: string, data: GameData): number {
  const ammo = data.outfits[ammoId];
  if (!ammo || ammo.category !== 'ammo') return 0;
  const launchers = weaponsOf(outfits, data).launchers.reduce((n, l) => n + (l.def.effect.ammo === ammoId ? l.count : 0), 0);
  return ammo.max * launchers;
}

/** True when anything fitted can fire: a gun, turret, beam or launcher. */
export function hasWeapon(outfits: Record<string, number>, data: GameData): boolean {
  const w = weaponsOf(outfits, data);
  return w.guns.length + w.beams.length + w.launchers.length > 0;
}

/** What an NPC hull carries: its own loadout, else a light blaster per 2 crew, up to 2. */
export function npcLoadout(def: ShipDef): Record<string, number> {
  if (def.loadout) return def.loadout;
  const guns = Math.min(2, Math.floor(def.crew / 2));
  return guns > 0 ? { 'light-blaster': guns } : {};
}
