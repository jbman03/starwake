import type { GameData } from '../data/schemas';
import type { PilotStore } from '../save/store';
import type { WorldState } from '../sim/types';
import type { Controller } from './controller';

export interface StarwakeTestHook {
  world: () => WorldState;
  data: GameData;
  controller: Controller;
  store: PilotStore;
  /** Set by SpaceScene: the main camera's viewport in screen px. */
  cameraViewport?: () => { x: number; y: number; w: number; h: number };
  /** Set by SpaceScene: a planet's on-screen position, or null if not in the current system. */
  planetScreenPos?: (planetId: string) => { x: number; y: number } | null;
}

declare global {
  interface Window {
    __starwake?: StarwakeTestHook;
  }
}

/** Exposes game internals to e2e tests in dev builds or when the URL contains `test`. */
export function installTestHook(controller: Controller, data: GameData, store: PilotStore): void {
  if (!import.meta.env.DEV && !location.href.includes('test')) return;
  window.__starwake = { world: () => controller.world, data, controller, store };
}
