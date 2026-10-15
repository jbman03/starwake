import { SaveError, upgradeSave, type PilotSave } from './pilot';

export function exportPilot(p: PilotSave): Blob {
  return new Blob([JSON.stringify(p, null, 2)], { type: 'application/json' });
}

export function exportFileName(p: PilotSave): string {
  // eslint-disable-next-line no-control-regex
  const safe = p.name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim() || 'pilot';
  return `${safe}.starwake.json`;
}

export function importPilot(text: string): PilotSave {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SaveError('invalid', 'not JSON');
  }
  return { ...upgradeSave(raw), id: crypto.randomUUID() };
}
