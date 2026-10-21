import { SaveError, worldFromPilot, type PilotSave } from '../save/pilot';
import type { GameData } from '../data/schemas';
import { formatDate } from '../sim/calendar';
import { visibleSystems } from '../sim/galaxy';
import { netWorth, shipDisplayName } from '../sim/shipyard';
import { importPilot } from '../save/transfer';
import { newWorld } from '../sim/world';
import type { UiContext } from './context';
import { replayWhere } from './guideHint';
import { showHowToPlay } from './howToPlay';
import { showSettings } from './settingsScreen';
import { button, confirmDialog, el, formatCredits, hotkeyFor, promptDialog } from './dom';
import { randomPilotName } from '../save/pilotNames';

export const NAME_MAX = 24;
export const DEFAULT_NAME = 'Pilot';
export const MSG_USED_BACKUP = 'Your last save was damaged; loaded the previous one.';

/** Trim to 1–24 characters; empty becomes "Pilot". */
export function cleanPilotName(raw: string): string {
  return raw.trim().slice(0, NAME_MAX).trim() || DEFAULT_NAME;
}

export function saveErrorText(err: unknown, verb: string): string {
  if (err instanceof SaveError && err.code === 'futureVersion') return `This pilot was saved by a newer version of Starwake and can't be ${verb}.`;
  if (err instanceof SaveError && err.code === 'unknownContent') {
    return `This pilot couldn't be ${verb}: it uses a ship, system or planet this version of Starwake doesn't have.`;
  }
  return `This pilot couldn't be ${verb}: the file or save is damaged.`;
}

/** The lines of a pilot's main-menu card. */
export interface PilotCard {
  name: string;
  shipLine: string;
  credits: string;
  netWorth: string;
  date: string;
  explored: string;
  jobs: string;
}

export function pilotCard(save: PilotSave, data: GameData): PilotCard {
  const hull = data.ships[save.shipId]?.name ?? save.shipId;
  const ship = shipDisplayName(save.shipName, save.shipId, data).slice(0, NAME_MAX);
  const visible = new Set(visibleSystems(data, save.flags).map((s) => s.id));
  // A pre-chart save has no known systems; count the opening chart plus where the pilot is, like the loader.
  const known = save.known.length ? save.known : [...data.config.knownAtStart, save.systemId];
  const seen = new Set(known.filter((id) => visible.has(id)));
  return {
    name: save.name,
    shipLine: `${ship} — ${hull}`,
    credits: formatCredits(save.credits),
    netWorth: formatCredits(netWorth(save, data)),
    date: formatDate(save.day, data.config),
    explored: `${seen.size}/${visible.size} systems`,
    jobs: `${save.stats.jobsDone} ${save.stats.jobsDone === 1 ? 'job' : 'jobs'}`,
  };
}

/** Title screen: pilot list (Load / Rename / Delete), New Pilot and Import. */
export function showMainMenu(ctx: UiContext): void {
  const { controller, store, root } = ctx;
  const { data } = controller;
  const list = el('ul', { class: 'sw-pilots', attrs: { 'aria-label': 'Pilots' } });
  const status = el('p', { class: 'sw-status', attrs: { 'aria-live': 'polite' } });
  const say = (text: string) => (status.textContent = text);
  let busy = false;

  /** Run one async action at a time so double taps can't double-create or double-load. */
  const guarded = (fn: () => Promise<void>) => async () => {
    if (busy) return;
    busy = true;
    try {
      await fn();
    } catch (err) {
      console.warn(err);
      say(`Something went wrong: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      busy = false;
    }
  };

  async function refresh(): Promise<void> {
    const pilots = (await store.list()).sort((a, b) => b.savedAt.localeCompare(a.savedAt));
    if (pilots.length === 0) {
      list.replaceChildren(el('li', { class: 'sw-empty', text: 'No pilots yet. Create one to begin.' }));
      return;
    }
    list.replaceChildren(
      ...pilots.map((p) => {
        const c = pilotCard(p.save, data);
        return el('li', { class: 'sw-pilot' }, [
          el('div', { class: 'sw-pilot-meta' }, [
            el('div', { class: 'sw-pilot-name', text: c.name }),
            el('div', { class: 'sw-pilot-ship', text: c.shipLine }),
            el('div', { class: 'sw-pilot-saved', text: `${c.credits} · net worth ${c.netWorth}` }),
            el('div', { class: 'sw-pilot-saved', text: `${c.date} · ${c.explored} · ${c.jobs} done` }),
          ]),
          el('div', { class: 'sw-pilot-actions' }, [
            button('Load', guarded(() => load(p.id)), { class: 'sw-btn-primary' }),
            button('Rename', guarded(() => rename(p.id, p.name))),
            button('Delete', guarded(() => remove(p.id, p.name)), { class: 'sw-btn-danger' }),
          ]),
        ]);
      }),
    );
  }

  async function newPilot(): Promise<void> {
    const raw = await promptDialog(root, {
      title: 'New Pilot',
      label: 'Pilot name',
      value: randomPilotName(),
      maxLength: NAME_MAX,
      confirm: 'Create',
      randomize: randomPilotName,
    });
    if (raw === null) return;
    const planetId = data.config.startPlanetId;
    controller.beginSession(newWorld(data), { id: crypto.randomUUID(), name: cleanPilotName(raw) }, planetId);
    let notice: string | undefined;
    try {
      await controller.save();
    } catch (err) {
      notice = `Couldn't save the new pilot: ${err instanceof Error ? err.message : String(err)}`;
    }
    ctx.go.planet(planetId, notice);
    await offerGuide();
  }

  /** New pilots are asked once whether to take the First Flight guide (Settings can replay it). */
  async function offerGuide(): Promise<void> {
    const guide = controller.guide;
    if (!guide) return;
    const yes = await confirmDialog(root, {
      title: 'Take the guided first flight? (about 5 minutes)',
      message: `One trade from start to finish: buy low here, fly, sell high. You can replay it later from ${replayWhere(controller.settings.bindings)}.`,
      confirm: 'Start guide',
      cancel: 'Skip',
    });
    // The pilot may have quit meanwhile; only start the guide this session still owns.
    if (yes && controller.guide === guide) guide.start();
  }

  async function load(id: string): Promise<void> {
    try {
      const { pilot, usedBackup } = await store.load(id);
      const world = worldFromPilot(pilot, data);
      controller.beginSession(world, { id: pilot.id, name: pilot.name }, pilot.planetId);
      ctx.go.planet(pilot.planetId, usedBackup ? MSG_USED_BACKUP : undefined);
    } catch (err) {
      say(saveErrorText(err, 'loaded'));
    }
  }

  async function rename(id: string, current: string): Promise<void> {
    const raw = await promptDialog(root, {
      title: 'Rename Pilot',
      label: 'Pilot name',
      value: current,
      maxLength: NAME_MAX,
      confirm: 'Rename',
    });
    if (raw === null) return;
    await store.rename(id, cleanPilotName(raw));
    await refresh();
  }

  async function remove(id: string, name: string): Promise<void> {
    const ok = await confirmDialog(root, {
      title: `Delete pilot "${name}"?`,
      message: 'This cannot be undone. Export the pilot first if you want a copy.',
      confirm: 'Delete',
      danger: true,
    });
    if (!ok) return;
    await store.remove(id);
    say(`Deleted ${name}.`);
    await refresh();
  }

  const file = el('input', { class: 'sw-hidden', attrs: { type: 'file', accept: '.json,application/json', 'aria-label': 'Pilot file' } });
  file.addEventListener('change', () => {
    const f = file.files?.[0];
    file.value = '';
    if (!f) return;
    void guarded(async () => {
      try {
        const p = importPilot(await f.text(), data);
        await store.save(p);
        say(`Imported ${p.name}.`);
        await refresh();
      } catch (err) {
        say(saveErrorText(err, 'imported'));
      }
    })();
  });

  const openHowToPlay = () => showHowToPlay(ctx, { onClose: () => showMainMenu(ctx) });

  const screen = el('div', { class: 'sw-screen sw-main-menu', attrs: { 'data-testid': 'main-menu' } }, [
    el('div', { class: 'sw-panel sw-menu sw-menu-wide' }, [
      el('h1', { class: 'sw-logo', text: 'STARWAKE' }),
      el('div', { class: 'sw-actions sw-actions-row' }, [
        button('New Pilot', guarded(newPilot), { class: 'sw-btn-primary' }),
        button('Import pilot', () => file.click()),
        button('How to Play', openHowToPlay, { hotkey: hotkeyFor(controller.settings.bindings, 'menuHowToPlay') }),
        button('Settings', () => showSettings(ctx, { mode: ctx.inputMode.mode, onClose: () => showMainMenu(ctx) })),
      ]),
      list,
      status,
      file,
    ]),
  ]);

  ctx.mount(screen, {
    groups: ['menus'],
    onPress: (pressed) => {
      if (pressed.has('menuHowToPlay')) openHowToPlay();
    },
  });
  void refresh().catch((err) => say(`Couldn't read saved pilots: ${err instanceof Error ? err.message : String(err)}`));
}
