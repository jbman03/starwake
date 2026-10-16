/** Original names for the New Pilot randomizer. Every "First 'Callsign' Last" fits in 24 chars. */
export const FIRST_NAMES = [
  'Mara', 'Dax', 'Ilya', 'Juno', 'Kestra', 'Rook', 'Tamsin', 'Oren', 'Vesna', 'Cade',
  'Lio', 'Petra', 'Soren', 'Wren', 'Ansel', 'Ysolde', 'Bram', 'Nadia', 'Teo', 'Quill',
  'Rhea', 'Calix', 'Imani', 'Jory', 'Zara', 'Emrys', 'Halle', 'Kofi', 'Sable', 'Tavi',
  'Uma', 'Vance', 'Wyn', 'Ines', 'Rafe', 'Odile', 'Lark', 'Nico', 'Saia', 'Bex',
] as const;

export const SURNAMES = [
  'Voss', 'Calloway', 'Hale', 'Okafor', 'Merrin', 'Strand', 'Ashby', 'Quarrel', 'Tennant', 'Rourke',
  'Vire', 'Lindqvist', 'Marrow', 'Okonkwo', 'Pryce', 'Sato', 'Drummond', 'Ferro', 'Galloway', 'Imre',
  'Kade', 'Lowe', 'Nakamura', 'Orsini', 'Pell', 'Reyes', 'Sorel', 'Thorne', 'Ulloa', 'Varga',
  'Wilder', 'Yarrow', 'Zell', 'Brenner', 'Castell', 'Dunmore', 'Everly', 'Faraday', 'Grieve', 'Holt',
] as const;

export const CALLSIGNS = [
  'Rook', 'Ghost', 'Ace', 'Comet', 'Drift', 'Flint', 'Hex', 'Jinx', 'Nova', 'Ratchet',
  'Spark', 'Tally', 'Vex', 'Wisp', 'Kite', 'Echo', 'Bolt', 'Moth', 'Patch', 'Zero',
] as const;

const NAME_MAX = 24;
const CALLSIGN_CHANCE = 0.25;

const pick = <T>(list: readonly T[], r: () => number): T => list[Math.min(list.length - 1, Math.floor(r() * list.length))];

/** A random pilot name like "Mara Voss", sometimes "Dax 'Rook' Calloway". `random` returns [0, 1). */
export function randomPilotName(random: () => number = Math.random): string {
  const withCallsign = random() < CALLSIGN_CHANCE;
  const first = pick(FIRST_NAMES, random);
  const last = pick(SURNAMES, random);
  if (withCallsign) {
    const full = `${first} '${pick(CALLSIGNS, random)}' ${last}`;
    if (full.length <= NAME_MAX) return full;
  }
  return `${first} ${last}`;
}
