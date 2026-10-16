import type { Controller } from '../app/controller';
import type { ActionGroup, ActionId } from '../input/actions';
import type { InputMode } from '../input/mode';
import type { PilotStore } from '../save/store';
import { dialogOpen } from './dom';
import { showMainMenu } from './mainMenu';
import { showMap } from './mapPlaceholder';
import { showPauseMenu } from './pauseMenu';
import { showPlanetScreen } from './planetScreen';

export interface MountOpts {
  /** Action groups polled (once per frame, while the sim is paused) for this screen's hotkeys. */
  groups?: readonly ActionGroup[];
  onPress?: (pressed: Set<ActionId>) => void;
  /** Called when the screen is replaced or closed. */
  cleanup?: () => void;
}

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
    map(): void;
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
  let current: { node: HTMLElement; cleanup?: () => void; offInput?: () => void } | null = null;

  const unmount = () => {
    if (!current) return;
    current.offInput?.();
    current.cleanup?.();
    current.node.remove();
    current = null;
  };

  const ctx: UiContext = {
    root,
    controller,
    store,
    inputMode,
    planetImage,
    mount(screen, opts = {}) {
      unmount();
      const { groups, onPress } = opts;
      const offInput =
        groups && onPress
          ? controller.setUiInput(groups, (pressed) => {
              if (!dialogOpen()) onPress(pressed);
            })
          : undefined;
      root.append(screen);
      current = { node: screen, cleanup: opts.cleanup, offInput };
    },
    unmount,
    go: {
      mainMenu: () => showMainMenu(ctx),
      planet: (id, notice) => showPlanetScreen(ctx, id, notice),
      pause: () => showPauseMenu(ctx),
      map: () => showMap(ctx),
    },
  };

  controller.on('landed', (e) => ctx.go.planet(e.planetId));
  controller.on('towed', (e) => ctx.go.planet(e.planetId));
  controller.on('menu', (e) => (e.action === 'pause' ? ctx.go.pause() : ctx.go.map()));
  return ctx;
}
