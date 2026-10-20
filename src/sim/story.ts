import type { WorldState } from './types';

export const MAX_NOTES = 20;

export function hasFlag(w: WorldState, f: string): boolean {
  return w.flags.includes(f);
}

/** Idempotent: setting a flag twice leaves one entry (and the same world object). */
export function setFlag(w: WorldState, f: string): WorldState {
  return hasFlag(w, f) ? w : { ...w, flags: [...w.flags, f] };
}

/** Newest first; the same text is never stored twice; at most MAX_NOTES kept. */
export function addNote(w: WorldState, text: string): WorldState {
  if (w.notes.some((n) => n.text === text)) return w;
  return { ...w, notes: [{ day: w.day, text }, ...w.notes].slice(0, MAX_NOTES) };
}
