import type { GameData, StoryMissionDef } from '../data/schemas';
import type { StoryAccept } from '../sim/storyMissions';
import type { PilotStore } from '../save/store';
import type { JumpPhase, WorldState } from '../sim/types';
import type { MoodId } from '../audio/moods';
import type { SidebarInfo } from '../render/sidebarInfo';
import type { Hull } from '../sim/combat';
import { hostileAhead } from './combatControl';
import type { Controller, StoryMeet, StorySite } from './controller';

export interface StarwakeTestHook {
  world: () => WorldState;
  data: GameData;
  controller: Controller;
  store: PilotStore;
  /** The story missions the bar here offers today. */
  storyOffers: () => StoryMissionDef[];
  /** The player's jump phase, or null when not jumping. */
  jumpPhase: () => JumpPhase | null;
  /** Set by main: the music mood last chosen (it follows the game every 250 ms), or null before the first. */
  musicMood?: () => MoodId | null;
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
  /** The fight: the player's hull, the selected launcher and every NPC's hull and stance. */
  combatState: () => { player: Hull; secondary: string | null; npcs: { id: string; role: string; hull: Hull; hostile: boolean }[] };
  /** Test-only: add an engaged raider (a `shipId` hull, default kestrel) 400 px ahead of the ship; returns its id. */
  spawnHostile: (shipId?: string) => string;
  /** Test-only: drop the targeted ship to 1 armor and disable it; false with no ship targeted. */
  disableTarget: () => boolean;
  /** Set by SpaceScene: the main camera's viewport in screen px. */
  cameraViewport?: () => { x: number; y: number; w: number; h: number };
  /** Set by SpaceScene: the texture key of the flight ship sprite. */
  flightSpriteTexture?: () => string;
  /** Set by SpaceScene: how many shots (bolts, rockets, seekers) were drawn on the last frame. */
  projectiles?: () => number;
  /** Set by SpaceScene: the targeted ship's hull gauge (0–1) as drawn on the last frame, or null with none. */
  targetBars?: () => { shields: number; armor: number } | null;
  /** Set by SpaceScene: the desktop HUD's autopilot route banner text, or null when hidden. */
  hudBanner?: () => string | null;
  /** Set by SpaceScene: the desktop HUD course line, or null when hidden. */
  hudCourse?: () => string | null;
  /** Set by SpaceScene: the HUD message line's text while it shows, or null. */
  hudMessage?: () => string | null;
  /** Set by SpaceScene: the incoming-hail banner text, or null when hidden. */
  hudHail?: () => string | null;
  /** Set by SpaceScene: the PC HUD's story objective line, or null when hidden. */
  hudObjective?: () => string | null;
  /** Set by SpaceScene: the top-centre banners that are showing, as {name, top, bottom} in screen px. */
  hudBannerBoxes?: () => { name: string; top: number; bottom: number }[];
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
  /** `?calm=1`: no raiders spawn, so no demand hails or attacks (story e2e at fringe systems). */
  calm?: boolean;
  /** Raw data overrides for `?baddata=1`: a shuttle whose maxSpeed is a string. */
  dataOverride?: { ships: unknown };
}

/** Failure-injection flags for e2e tests; always empty unless the test hook is active. */
export function testFlags(search: string = location.search): TestFlags {
  if (!testHookActive()) return { crash: false };
  const q = new URLSearchParams(search);
  const flags: TestFlags = { crash: q.get('crash') === '1' };
  if (q.get('calm') === '1') flags.calm = true;
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
  const combatState: StarwakeTestHook['combatState'] = () => ({
    player: { ...controller.combat.battle.player },
    secondary: controller.combat.battle.secondary,
    npcs: controller.traffic.npcs.map((n) => ({ id: n.id, role: n.role, hull: { ...n.hull }, hostile: controller.combat.isHostile(n, controller.world) })),
  });
  const spawnHostile = (shipId?: string): string => {
    const r = hostileAhead(controller.world, controller.traffic, data, shipId);
    controller.traffic = r.traffic;
    return r.id;
  };
  const disableTarget = (): boolean => {
    const id = controller.traffic.targetId;
    if (!id || !controller.traffic.npcs.some((n) => n.id === id)) return false;
    controller.traffic = {
      ...controller.traffic,
      npcs: controller.traffic.npcs.map((n) => (n.id === id ? { ...n, engaged: false, hull: { ...n.hull, armor: 1, disabled: true } } : n)),
    };
    return true;
  };
  window.__starwake = {
    world: () => controller.world,
    data,
    controller,
    store,
    teleport,
    storyOffers: () => controller.storyOffers(),
    story: () => controller.world.story,
    jumpPhase: () => controller.world.jump?.phase ?? null,
    storySite: () => controller.storySite,
    storyMeet: () => controller.storyMeet,
    acceptStoryNow: (id) => controller.acceptStory(id),
    forceEncounter: (id) => controller.forceEncounter(id),
    combatState,
    spawnHostile,
    disableTarget,
  };
}
