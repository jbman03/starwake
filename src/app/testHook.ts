import type { GameData, StoryMissionDef } from '../data/schemas';
import type { StoryAccept } from '../sim/storyMissions';
import type { PilotStore } from '../save/store';
import type { WorldState } from '../sim/types';
import type { SidebarInfo } from '../render/sidebarInfo';
import type { Controller, StoryMeet, StorySite } from './controller';

export interface StarwakeTestHook {
  world: () => WorldState;
  data: GameData;
  controller: Controller;
  store: PilotStore;
  /** The story missions the bar here offers today. */
  storyOffers: () => StoryMissionDef[];
  /** The story progress held in the world. */
  story: () => WorldState['story'];
  /** The scan or find site of a story step in this system (even a find site not yet in view), or null. */
  storySite: () => StorySite | null;
  /** The story meet ship waiting in this system, or null. */
  storyMeet: () => StoryMeet | null;
  /** Test-only: take a story mission as the bar would, whatever the pilot's location. */
  acceptStoryNow: (id: string) => StoryAccept;
  /** Test-only: put the world at `planetId` (in its system) and land there, as a real landing would. */
  teleport: (planetId: string) => void;
  /** Set by SpaceScene: the main camera's viewport in screen px. */
  cameraViewport?: () => { x: number; y: number; w: number; h: number };
  /** Set by SpaceScene: the texture key of the flight ship sprite. */
  flightSpriteTexture?: () => string;
  /** Set by SpaceScene: the desktop HUD's autopilot route banner text, or null when hidden. */
  hudBanner?: () => string | null;
  /** Set by SpaceScene: the desktop HUD course line, or null when hidden. */
  hudCourse?: () => string | null;
  /** Set by SpaceScene: the HUD message line's text while it shows, or null. */
  hudMessage?: () => string | null;
  /** Set by SpaceScene: the incoming-hail banner text, or null when hidden. */
  hudHail?: () => string | null;
  /** Set by SpaceScene: the pending site's on-screen position, or null when there is none. */
  siteScreenPos?: () => { x: number; y: number } | null;
  /** Test-only: make `id` the pending encounter (a hail now, or a site 200 px ahead of the ship). */
  forceEncounter: (id: string) => void;
  /** Set by SpaceScene: the desktop HUD's guide hint and its skip control's screen box, or null when hidden. */
  hudGuide?: () => { text: string; skip: { x: number; y: number; w: number; h: number } } | null;
  /** Set by SpaceScene: whether the PC sidebar is showing, and what it shows. */
  sidebar?: () => { visible: boolean; info: SidebarInfo };
  /** Set by SpaceScene: the NPC ships in this system with their on-screen position (null before a sprite exists). */
  traffic?: () => { id: string; label: string; texture: string | null; tint: number | null; screen: { x: number; y: number } | null }[];
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
  const teleport = (planetId: string): void => {
    const planet = data.planets[planetId];
    if (!planet) throw new Error(`teleport: unknown planet ${planetId}`);
    const c = controller as unknown as { landAt(id: string): void; emit(e: { type: 'landed'; planetId: string }): void };
    controller.world = {
      ...controller.world,
      systemId: planet.systemId,
      route: [],
      ship: { ...controller.world.ship, pos: { ...planet.pos }, vel: { x: 0, y: 0 } },
    };
    c.landAt(planetId);
    c.emit({ type: 'landed', planetId });
  };
  window.__starwake = { world: () => controller.world, data, controller, store, teleport, storyOffers: () => controller.storyOffers(), story: () => controller.world.story, storySite: () => controller.storySite, storyMeet: () => controller.storyMeet, acceptStoryNow: (id) => controller.acceptStory(id), forceEncounter: (id) => controller.forceEncounter(id) };
}
