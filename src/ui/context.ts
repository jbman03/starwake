import type { Controller } from '../app/controller';
import type { ActionGroup, ActionId } from '../input/actions';
import type { InputMode } from '../input/mode';
import type { PilotStore } from '../save/store';
import { Guide } from '../guide/guide';
import { dialogOpen } from './dom';
import { showEncounterCard } from './encounterCard';
import { confirmSkipGuide, guideKey, guideState, type GuideScreen } from './guideHint';
import { showMainMenu } from './mainMenu';
import { showMissionLog } from './missionLog';
import { showPauseMenu } from './pauseMenu';
import { showPlanetScreen } from './planetScreen';
import { showStarMap } from './starMap';

export interface MountOpts {
  /** Action groups polled (once per frame, while the sim is paused) for this screen's hotkeys. */
  groups?: readonly ActionGroup[];
  onPress?: (pressed: Set<ActionId>) => void;
  /** Called when the screen is replaced or closed. */
  cleanup?: () => void;
  /** Which screen this is, for the First Flight guide (anything else counts as 'other'). */
  guide?: GuideScreen;
}

/** How often (ms) the guide re-reads the world while a session runs (flight, trades). */
export const GUIDE_TICK_MS = 250;

export interface UiContext {
  root: HTMLElement;
  controller: Controller;
  store: PilotStore;
  /** Keyboard or touch: picks the settings tab and whether touch rails show. */
  inputMode: InputMode;
  /** PNG data URL of a planet's generated sprite, or null if unavailable. */
  planetImage: (planetId: string) => string | null;
  /** Replace the open screen with `screen`. */
  mount(screen: HTMLElement, opts?: MountOpts): void;
  /** Close the open screen (back to the flight view). */
  unmount(): void;
  go: {
    mainMenu(): void;
    planet(planetId: string, notice?: string): void;
    pause(): void;
    /** Star map; closing it runs `onClose` (default: resume flight). */
    map(opts?: { onClose?: () => void; initialSelection?: string; preview?: { systemId: string; label: string } }): void;
  };
}

/** Builds the UI context and routes controller events (landing, tow, menu keys) to screens. */
export function createUi(
  root: HTMLElement,
  controller: Controller,
  store: PilotStore,
  planetImage: (planetId: string) => string | null,
  inputMode: InputMode,
): UiContext {
  let current: { node: HTMLElement; cleanup?: () => void; offInput?: () => void; guide: GuideScreen | 'other' } | null = null;

  /** Feed the guide what the player is looking at now. */
  const feedGuide = () => controller.guide?.update(guideState(controller, current ? current.guide : null));

  const close = () => {
    if (!current) return;
    current.offInput?.();
    current.cleanup?.();
    current.node.remove();
    current = null;
  };
  const unmount = () => {
    close();
    feedGuide();
  };

  const ctx: UiContext = {
    root,
    controller,
    store,
    inputMode,
    planetImage,
    mount(screen, opts = {}) {
      close(); // no guide update for the moment in between screens
      const { groups, onPress } = opts;
      const offInput =
        groups && onPress
          ? controller.setUiInput(groups, (pressed) => {
              if (!dialogOpen()) onPress(pressed);
            })
          : undefined;
      root.append(screen);
      current = { node: screen, cleanup: opts.cleanup, offInput, guide: opts.guide ?? 'other' };
      feedGuide();
    },
    unmount,
    go: {
      mainMenu: () => showMainMenu(ctx),
      planet: (id, notice) => showPlanetScreen(ctx, id, notice),
      pause: () => showPauseMenu(ctx),
      map: (opts) => showStarMap(ctx, opts),
    },
  };

  // ---- First Flight guide: one per session, fed on every screen change and on a timer ----------
  let tick: ReturnType<typeof setInterval> | undefined;
  const endGuide = () => {
    if (tick !== undefined) clearInterval(tick);
    tick = undefined;
    controller.guide = null;
  };
  controller.on('session', (e) => {
    endGuide();
    if (!e.active) return;
    const guide = new Guide(controller, controller.data, {
      mode: () => inputMode.mode,
      key: guideKey(() => controller.settings.bindings, () => controller.landedPlanetId !== null),
    });
    controller.guide = guide;
    if (guide.resumable()) guide.start();
    tick = setInterval(feedGuide, GUIDE_TICK_MS);
  });
  controller.on('flying', feedGuide);
  // From the flight HUD or rail: pause while the confirm is open, then fly on.
  controller.on('guideSkip', () => {
    const guide = controller.guide;
    if (!guide?.current() || dialogOpen()) return;
    const wasFlying = controller.isFlying;
    if (wasFlying) controller.pauseFlight();
    void confirmSkipGuide(root, guide, controller.settings.bindings).then(() => {
      if (wasFlying && !current && controller.pilot) controller.startFlight();
    });
  });

  controller.on('landed', (e) => ctx.go.planet(e.planetId));
  controller.on('towed', (e) => ctx.go.planet(e.planetId));
  controller.on('encounter', () => {
    const view = controller.encounterView();
    if (view) showEncounterCard(ctx, view, (i) => controller.chooseEncounter(i)?.messages ?? null);
    else controller.startFlight();
  });
  controller.on('menu', (e) => {
    if (e.action === 'pause') ctx.go.pause();
    else if (e.action === 'map') ctx.go.map();
    else showMissionLog(ctx, () => controller.startFlight()); // flight is paused, as for the map
  });
  return ctx;
}
