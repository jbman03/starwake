import type { GameData } from '../data/schemas';
import { SaveError, upgradeSave, worldFromPilot, type PilotSave } from './pilot';

export function exportPilot(p: PilotSave): Blob {
  return new Blob([JSON.stringify(p, null, 2)], { type: 'application/json' });
}

export function exportFileName(p: PilotSave): string {
  // eslint-disable-next-line no-control-regex
  const safe = p.name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim() || 'pilot';
  return `${safe}.starwake.json`;
}

/**
 * Parse an exported pilot and give it a fresh id. Rejects files that aren't valid saves
 * (`invalid`, `futureVersion`) and saves this game data can't load, e.g. an unknown ship or
 * planet id (`unknownContent`), so nothing unloadable lands in the pilot list.
 */
export function importPilot(text: string, data: GameData): PilotSave {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SaveError('invalid', 'not JSON');
  }
  const pilot = upgradeSave(raw);
  try {
    worldFromPilot(pilot, data);
  } catch {
    throw new SaveError('unknownContent', 'pilot refers to a ship, system or planet this game does not have');
  }
  return { ...pilot, id: crypto.randomUUID() };
}
