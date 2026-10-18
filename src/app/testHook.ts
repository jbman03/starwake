import type { GameData } from '../data/schemas';
import type { PilotStore } from '../save/store';
import type { WorldState } from '../sim/types';
import type { SidebarInfo } from '../render/sidebarInfo';
import type { Controller } from './controller';

export interface StarwakeTestHook {
  world: () => WorldState;
  data: GameData;
  controller: Controller;
  store: PilotStore;
  /** Set by SpaceScene: the main camera's viewport in screen px. */
  cameraViewport?: () => { x: number; y: number; w: number; h: number };
  /** Set by SpaceScene: the desktop HUD's autopilot route banner text, or null when hidden. */
  hudBanner?: () => string | null;
  /** Set by SpaceScene: the desktop HUD course line, or null when hidden. */
  hudCourse?: () => string | null;
  /** Set by SpaceScene: the desktop HUD's guide hint and its skip control's screen box, or null when hidden. */
  hudGuide?: () => { text: string; skip: { x: number; y: number; w: number; h: number } } | null;
  /** Set by SpaceScene: whether the PC sidebar is showing, and what it shows. */
  sidebar?: () => { visible: boolean; info: SidebarInfo };
  /** Set by SpaceScene: a planet's on-screen position, or null if not in the current system. */
  planetScreenPos?: (planetId: string) => { x: number; y: number } | null;
}

declare global {
  interface Window {
    __starwake?: StarwakeTestHook;
  }
}

/** True in dev builds only; production builds never expose the hook or honour test flags. */
export function testHookActive(): boolean {
  return import.meta.env.DEV;
}

export interface TestFlags {
  /** `?crash=1`: throw during boot. */
  crash: boolean;
  /** Raw data overrides for `?baddata=1`: a shuttle whose maxSpeed is a string. */
  dataOverride?: { ships: unknown };
}

/** Failure-injection flags for e2e tests; always empty unless the test hook is active. */
export function testFlags(search: string = location.search): TestFlags {
  if (!testHookActive()) return { crash: false };
  const q = new URLSearchParams(search);
  const flags: TestFlags = { crash: q.get('crash') === '1' };
  if (q.get('baddata') === '1') {
    flags.dataOverride = {
      ships: [
        { id: 'shuttle', name: 'Wayfarer Shuttle', turnRate: 180, acceleration: 150, maxSpeed: 'fast', fuelCapacity: 300, radius: 14 },
      ],
    };
  }
  return flags;
}

/** Exposes game internals to e2e tests in dev builds. */
export function installTestHook(controller: Controller, data: GameData, store: PilotStore): void {
  if (!testHookActive()) return;
  window.__starwake = { world: () => controller.world, data, controller, store };
}
