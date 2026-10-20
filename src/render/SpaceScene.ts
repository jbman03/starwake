import Phaser from 'phaser';
import type { Controller } from '../app/controller';
import type { SystemDef } from '../data/schemas';
import type { InputMode } from '../input/mode';
import { getInsets } from '../input/insets';
import { pointerTypeOf } from '../input/pointer';
import { computeLayout, type Rect } from '../input/touch';
import { SYSTEM_CENTER } from '../sim/rules';
import { npcLabel, targetedNpc } from '../sim/traffic';
import { JUMP_DURATION } from '../sim/world';
import { skipLabel } from '../guide/guide';
import { hotkeyFor } from '../ui/dom';
import { formatMessage } from '../ui/messageText';
import { Hud, type HudGuide } from './hud';
import { Sidebar, SIDEBAR_W } from './sidebar';
import { sidebarInfo } from './sidebarInfo';
import {
  makePlanetTexture,
  makeShipTextures,
  shipTextureKey,
  makeStarfieldTexture,
  makeStarTexture,
  shipFrame,
} from './sprites';

/** Planets and stations are tappable this far beyond their edge... */
const TAP_MARGIN = 12;
/** ...and never with a radius under this (a 44 px wide touch target). */
const MIN_TAP_RADIUS = 22;

/** Narrowest window that gets the sidebar (keyboard mode). */
const SIDEBAR_MIN_WINDOW = 700;

/** How long the arrival streaks and flash last after coming out of a jump (seconds). */
const ARRIVAL_FX_SEC = 0.5;
/** NPC jump streaks are the player's, scaled down. */
const NPC_STREAK_SCALE = 0.4;
/** NPC jumpIn / jumpOut take this long (matches the sim's JUMP_SEC in traffic.ts). */
const NPC_JUMP_SEC = 1.0;
/** The ship shrinks to this scale as it lands. */
const LANDED_SCALE = 0.2;

/** Parallax factor per starfield layer (far → near). */
const PARALLAX = [0.08, 0.22, 0.45];

/**
 * Draws the current system around the player ship. Reads controller.view() every frame.
 * The camera viewport is the layout's view: the whole window in keyboard mode, the region
 * between the touch rails in touch mode, so the ship stays centered in what the player sees.
 */
export class SpaceScene extends Phaser.Scene {
  private stars: Phaser.GameObjects.TileSprite[] = [];
  private bodies: Phaser.GameObjects.Image[] = [];
  /** One sprite per NPC ship, by NPC id. */
  private npcSprites = new Map<string, Phaser.GameObjects.Image>();
  private ship!: Phaser.GameObjects.Image;
  private bracket!: Phaser.GameObjects.Graphics;
  private fx!: Phaser.GameObjects.Graphics;
  /** The white diamond marking a pending site. */
  private siteMark!: Phaser.GameObjects.Graphics;
  private hud!: Hud;
  private sidebar!: Sidebar;
  private builtSystemId: string | null = null;
  private unsubs: (() => void)[] = [];
  /** Seconds of arrival effect left (0 when none). */
  private arrivalLeft = 0;
  private viewport: Rect = { x: 0, y: 0, w: 0, h: 0 };

  constructor(
    private controller: Controller,
    private inputMode: InputMode,
  ) {
    super('space');
  }

  create(): void {
    const { data, settings } = this.controller;
    const layers = settings.quality === 'low' ? [1] : [0, 1, 2];
    for (const layer of layers) {
      const ts = this.add
        .tileSprite(0, 0, this.scale.width, this.scale.height, makeStarfieldTexture(this, layer))
        .setOrigin(0)
        .setScrollFactor(0)
        .setDepth(-100 + layer);
      ts.setData('parallax', PARALLAX[layer]);
      this.stars.push(ts);
    }

    for (const def of Object.values(data.ships)) makeShipTextures(this, def);
    const world = this.controller.world;
    this.ship = this.add.image(0, 0, `ship:${world.shipId}`, shipFrame(world.ship.heading)).setDepth(10);
    this.bracket = this.add.graphics().setDepth(5);
    this.fx = this.add.graphics().setDepth(20);
    this.siteMark = this.add.graphics().setDepth(6);
    this.hud = new Hud(this, () => this.controller.requestGuideSkip());

    this.sidebar = new Sidebar(
      this,
      () => {
        this.controller.touch.press('map');
        this.controller.touch.release('map');
      },
      () => hotkeyFor(this.controller.settings.bindings, 'map'),
    );

    // The sidebar is drawn by its own camera; the main camera and that one skip each other's objects.
    const sb = this.sidebar.objects();
    this.cameras.main.ignore(sb);
    this.sidebar.cam.ignore(this.children.list.filter((o) => !sb.includes(o)));

    this.buildSystem(world.systemId);

    this.unsubs.push(
      this.controller.on('jumped', (e) => this.buildSystem(e.toSystemId)),
      this.controller.on('arrived', () => (this.arrivalLeft = ARRIVAL_FX_SEC)),
      this.controller.on('message', (e) =>
        this.hud.showMessage(
          formatMessage(
            e.text,
            (a) => hotkeyFor(this.controller.settings.bindings, a) ?? null,
            this.inputMode.mode === 'touch',
          ),
        ),
      ),
    );

    this.applyLayout();
    this.installTestHook();
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.unsubs.forEach((u) => u()));
  }

  /** The sidebar shows in keyboard mode on windows wide enough for it. */
  private sidebarShowing(): boolean {
    return this.inputMode.mode !== 'touch' && this.scale.width >= SIDEBAR_MIN_WINDOW;
  }

  /** The view rect for the current window size and input mode, in whole pixels. */
  private currentView(): Rect {
    const { width, height } = this.scale;
    const v =
      this.inputMode.mode === 'touch'
        ? computeLayout(width, height, this.controller.settings.touch, getInsets()).view
        : { x: 0, y: 0, w: this.sidebarShowing() ? width - SIDEBAR_W : width, h: height };
    return { x: Math.round(v.x), y: Math.round(v.y), w: Math.round(v.w), h: Math.round(v.h) };
  }

  /** Fit the camera, starfield and HUD to the view. Cheap when nothing changed; runs every frame. */
  private applyLayout(): void {
    const v = this.currentView();
    const old = this.viewport;
    if (v.x === old.x && v.y === old.y && v.w === old.w && v.h === old.h) return;
    this.viewport = v;
    this.cameras.main.setViewport(v.x, v.y, v.w, v.h);
    for (const ts of this.stars) ts.setSize(v.w, v.h);
    const sidebar = this.sidebarShowing();
    this.hud.setLayout(v.w, v.h, this.inputMode.mode === 'touch', sidebar);
    this.sidebar.setVisible(sidebar);
    if (sidebar) this.sidebar.layout(this.scale.width - SIDEBAR_W, this.scale.height);
  }

  /** e2e helpers: the camera viewport and where a planet is on screen. */
  private installTestHook(): void {
    const hook = window.__starwake;
    if (!hook) return;
    hook.cameraViewport = () => {
      const c = this.cameras.main;
      return { x: c.x, y: c.y, w: c.width, h: c.height };
    };
    hook.sidebar = () => ({
      visible: this.sidebar.isVisible(),
      info: sidebarInfo(this.controller.world, this.controller.data, this.controller.traffic),
    });
    hook.traffic = () => {
      const c = this.cameras.main;
      return this.controller.traffic.npcs.map((n) => {
        const img = this.npcSprites.get(n.id);
        return {
          id: n.id,
          label: npcLabel(n, this.controller.data),
          texture: img?.texture.key ?? null,
          tint: img ? img.tintTopLeft : null,
          screen: img ? { x: c.x + (img.x - c.worldView.x) * c.zoom, y: c.y + (img.y - c.worldView.y) * c.zoom } : null,
        };
      });
    };
    hook.flightSpriteTexture = () => this.ship.texture.key;
    hook.hudBanner = () => this.hud.bannerText();
    hook.hudHail = () => this.hud.hailText();
    hook.siteScreenPos = () => {
      const pos = this.controller.sitePos();
      const c = this.cameras.main;
      return pos ? { x: c.x + (pos.x - c.worldView.x) * c.zoom, y: c.y + (pos.y - c.worldView.y) * c.zoom } : null;
    };
    hook.hudCourse = () => this.hud.courseText();
    hook.hudGuide = () => this.hud.guideInfo();
    hook.planetScreenPos = (id) => {
      const p = this.controller.data.planets[id];
      if (!p || p.systemId !== this.builtSystemId) return null;
      const c = this.cameras.main;
      return { x: c.x + (p.pos.x - c.worldView.x) * c.zoom, y: c.y + (p.pos.y - c.worldView.y) * c.zoom };
    };
  }

  /**
   * Register a game-world object created after startup. The sidebar camera draws only the
   * sidebar, so every other object must be hidden from it; do this for any new world object.
   */
  private addWorldObject(o: Phaser.GameObjects.GameObject): void {
    this.sidebar.cam.ignore(o);
  }

  /** Rebuild the star and planets for a system. */
  private buildSystem(systemId: string): void {
    if (this.builtSystemId === systemId) return;
    this.builtSystemId = systemId;
    this.bodies.forEach((b) => b.destroy());
    this.bodies = [];
    const { data } = this.controller;
    const sys: SystemDef = data.systems[systemId];
    const star = this.add.image(SYSTEM_CENTER.x, SYSTEM_CENTER.y, makeStarTexture(this, sys)).setDepth(0).setBlendMode(Phaser.BlendModes.ADD);
    this.addWorldObject(star);
    this.bodies.push(star);
    for (const p of Object.values(data.planets)) {
      if (p.systemId !== systemId) continue;
      const img = this.add.image(p.pos.x, p.pos.y, makePlanetTexture(this, p)).setDepth(1);
      const r = Math.max(MIN_TAP_RADIUS, p.radius + TAP_MARGIN);
      img.setInteractive(new Phaser.Geom.Circle(img.width / 2, img.height / 2, r), Phaser.Geom.Circle.Contains);
      // Mouse click: select only. Touch tap: select and land.
      img.on(Phaser.Input.Events.GAMEOBJECT_POINTER_DOWN, (pointer: Phaser.Input.Pointer) =>
        this.controller.tapPlanet(p.id, pointerTypeOf(pointer.event, pointer.wasTouch)),
      );
      this.addWorldObject(img);
      this.bodies.push(img);
    }
  }

  update(): void {
    // Real elapsed time: Phaser's smoothed delta lags behind wall-clock when frames are slow,
    // and the fixed stepper already clamps long frames.
    const dt = this.game.loop.rawDelta / 1000;
    this.controller.update(dt);
    const { world, prevShip, alpha, data, landingT, thrusting } = this.controller.view();
    if (world.systemId !== this.builtSystemId) this.buildSystem(world.systemId);
    this.applyLayout();

    // Interpolated ship position; camera stays centered on it.
    const x = prevShip.pos.x + (world.ship.pos.x - prevShip.pos.x) * alpha;
    const y = prevShip.pos.y + (world.ship.pos.y - prevShip.pos.y) * alpha;
    const shipKey = shipTextureKey(data.ships[world.shipId] ?? Object.values(data.ships)[0]!);
    if (this.ship.texture.key !== shipKey) this.ship.setTexture(shipKey);
    // Landing shrinks and fades the ship (take-off runs it backwards); on the planet screen it is hidden.
    const shrink = landingT ?? 0;
    this.ship
      .setPosition(x, y)
      .setFrame(shipFrame(world.ship.heading))
      .setScale(1 - (1 - LANDED_SCALE) * shrink)
      .setAlpha(1 - shrink)
      .setVisible(this.controller.landedPlanetId === null);
    const cam = this.cameras.main;
    cam.centerOn(x, y);

    // Starfield: tile offset follows camera scroll scaled per layer, so layers never jitter
    // relative to each other (all derived from the same interpolated camera position).
    for (const ts of this.stars) {
      const k = ts.getData('parallax') as number;
      ts.setTilePosition(cam.scrollX * k, cam.scrollY * k);
    }

    this.updateNpcs();
    this.drawBracket(world.targetPlanetId);
    this.fx.clear();
    this.arrivalLeft = Math.max(0, this.arrivalLeft - dt);
    if (thrusting && landingT === null) this.drawFlame(x, y, world.ship.heading, data.ships[world.shipId]?.radius ?? 14);
    this.drawNpcFx();
    this.drawJumpFx(x, y);
    this.drawSite();
    this.hud.update(world, data, dt, this.guideHint(), this.controller.traffic, this.hailBanner());
    this.sidebar.update(world, data, dt, this.controller.traffic, this.controller.sitePos());
  }

  /** "Incoming hail — Name (Y to answer)" while a hail is open, else null. */
  private hailBanner(): string | null {
    const p = this.controller.pending;
    if (p?.kind !== 'hail' || !this.controller.isFlying) return null;
    const key = hotkeyFor(this.controller.settings.bindings, 'interact') ?? 'unbound';
    return `Incoming hail — ${p.npcName} (${key} to answer)`;
  }

  /** A white diamond at the pending site (nothing while there isn't one). */
  private drawSite(): void {
    const g = this.siteMark;
    g.clear();
    const pos = this.controller.sitePos();
    if (!pos) return;
    const r = 12;
    g.lineStyle(2, 0xffffff, 0.95);
    g.fillStyle(0xffffff, 0.25);
    g.beginPath();
    g.moveTo(pos.x, pos.y - r);
    g.lineTo(pos.x + r, pos.y);
    g.lineTo(pos.x, pos.y + r);
    g.lineTo(pos.x - r, pos.y);
    g.closePath();
    g.fillPath();
    g.strokePath();
  }

  /** The First Flight guide's current hint for the HUD, or null. */
  private guideHint(): HudGuide | null {
    const guide = this.controller.guide;
    const c = guide?.current();
    if (!c) return null;
    return { text: c.text, skip: skipLabel(c) };
  }

  private drawBracket(targetId: string | null): void {
    const g = this.bracket;
    g.clear();
    const { data, world } = this.controller.view();
    const { traffic } = this.controller;
    let cx0: number, cy0: number, r: number;
    const npc = targetedNpc(traffic);
    const sprite = npc ? this.npcSprites.get(npc.id) : undefined;
    if (npc && sprite) {
      cx0 = sprite.x;
      cy0 = sprite.y;
      r = data.ships[npc.shipId].radius + 10;
    } else {
      const p = targetId ? data.planets[targetId] : undefined;
      if (!p || p.systemId !== world.systemId) return;
      cx0 = p.pos.x;
      cy0 = p.pos.y;
      r = p.radius + 10;
    }
    const arm = Math.max(8, r * 0.3);
    g.lineStyle(2, 0x6fe36f, 0.9);
    for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const cx = cx0 + sx * r, cy = cy0 + sy * r;
      g.beginPath();
      g.moveTo(cx, cy - sy * arm);
      g.lineTo(cx, cy);
      g.lineTo(cx - sx * arm, cy);
      g.strokePath();
    }
  }

  /** Keep one tinted sprite per NPC: create new ones, move and fade the rest, drop the departed. */
  private updateNpcs(): void {
    const { data } = this.controller;
    const seen = new Set<string>();
    for (const n of this.controller.traffic.npcs) {
      seen.add(n.id);
      const def = data.ships[n.shipId];
      let img = this.npcSprites.get(n.id);
      // Ids are not unique across sessions: a reseed can reuse an id for a different ship.
      const sig = `${n.shipId}|${n.government}`;
      if (img && img.getData('sig') !== sig) {
        img.destroy();
        img = undefined;
      }
      if (!img) {
        img = this.add.image(n.ship.pos.x, n.ship.pos.y, shipTextureKey(def), shipFrame(n.ship.heading)).setDepth(9);
        const color = data.governments[n.government]?.color;
        if (color) img.setTint(parseInt(color.slice(1), 16));
        const hit = Math.max(MIN_TAP_RADIUS, def.radius + TAP_MARGIN);
        img.setInteractive(new Phaser.Geom.Circle(img.width / 2, img.height / 2, hit), Phaser.Geom.Circle.Contains);
        img.on(Phaser.Input.Events.GAMEOBJECT_POINTER_DOWN, () => this.controller.targetShip(n.id));
        img.setData('sig', sig);
        this.addWorldObject(img);
        this.npcSprites.set(n.id, img);
      }
      // Simple fades: arriving ships fade in, landing and leaving ones fade out.
      const fade =
        n.phase === 'jumpIn' ? Math.min(1, n.phaseT / 1.0) : n.phase === 'jumpOut' ? Math.max(0, 1 - n.phaseT / 1.0) : n.phase === 'land' ? Math.max(0, 1 - n.phaseT / 0.4) : 1;
      img.setPosition(n.ship.pos.x, n.ship.pos.y).setFrame(shipFrame(n.ship.heading)).setAlpha(fade).setVisible(fade > 0);
    }
    for (const [id, img] of this.npcSprites) {
      if (seen.has(id)) continue;
      img.destroy();
      this.npcSprites.delete(id);
    }
  }

  /** Engine flame: a flickering stack of triangles just behind a ship that is thrusting. */
  private drawFlame(x: number, y: number, heading: number, radius: number): void {
    const g = this.fx;
    const dx = Math.cos(heading), dy = Math.sin(heading);
    const flicker = 0.75 + 0.25 * Math.sin(this.time.now * 0.06 + x) + 0.1 * Math.sin(this.time.now * 0.17);
    const layers: [number, number, number][] = [
      [0xff7a2a, 1, 0.8],
      [0xffc14a, 0.7, 0.9],
      [0xffffff, 0.4, 0.95],
    ];
    for (const [color, size, alpha] of layers) {
      const len = radius * 1.6 * size * flicker;
      const half = radius * 0.4 * size;
      const bx = x - dx * radius * 0.8, by = y - dy * radius * 0.8;
      g.fillStyle(color, alpha);
      g.fillTriangle(bx - dy * half, by + dx * half, bx + dy * half, by - dx * half, bx - dx * len, by - dy * len);
    }
  }

  /** Flames behind thrusting NPCs, and jump streaks at NPCs arriving or leaving. */
  private drawNpcFx(): void {
    const { data } = this.controller;
    for (const n of this.controller.traffic.npcs) {
      const img = this.npcSprites.get(n.id);
      if (!img) continue;
      if (n.thrusting && n.phase === 'fly') this.drawFlame(n.ship.pos.x, n.ship.pos.y, n.ship.heading, data.ships[n.shipId]?.radius ?? 14);
      if (n.phase === 'jumpIn' || n.phase === 'jumpOut') {
        const t = Math.min(1, n.phaseT / NPC_JUMP_SEC);
        this.drawStreaks(n.ship.pos.x, n.ship.pos.y, n.ship.heading, n.phase === 'jumpOut' ? t : 1 - t, NPC_STREAK_SCALE, 10);
      }
    }
  }

  /** Star streaks behind a ship at progress `t` (0 calm to 1 full), `scale` shrinking the whole pattern. */
  private drawStreaks(x: number, y: number, h: number, t: number, scale: number, count: number): void {
    const g = this.fx;
    const dx = Math.cos(h), dy = Math.sin(h);
    const len = (60 + t * t * 900) * scale;
    g.lineStyle(1.5, 0xcfe4ff, 0.35 + 0.5 * t);
    for (let i = 0; i < count; i++) {
      // Deterministic spread so streaks don't flicker frame to frame.
      const off = (((i * 97) % 28) - 14) * 22 * scale;
      const ahead = (((i * 53) % 17) * 30 - 200) * scale;
      const sx = x - dy * off + dx * ahead, sy = y + dx * off + dy * ahead;
      g.beginPath();
      g.moveTo(sx, sy);
      g.lineTo(sx - dx * len, sy - dy * len);
      g.strokePath();
    }
  }

  private drawFlash(alpha: number): void {
    if (alpha <= 0) return;
    const cam = this.cameras.main;
    this.fx.fillStyle(0xffffff, alpha * 0.85);
    this.fx.fillRect(cam.scrollX, cam.scrollY, cam.width, cam.height);
  }

  /**
   * Hyperspace effect around the player: star streaks behind the ship, then a white flash. On
   * arrival the same effect plays backwards (streaks shorten, the flash fades) for ARRIVAL_FX_SEC.
   */
  private drawJumpFx(x: number, y: number): void {
    const { jump, ship } = this.controller.world;
    if (jump) {
      const t = Math.min(1, jump.t / JUMP_DURATION);
      this.drawStreaks(x, y, ship.heading, t, 1, 28);
      this.drawFlash(t > 0.75 ? (t - 0.75) / 0.25 : 0);
    } else if (this.arrivalLeft > 0) {
      const t = this.arrivalLeft / ARRIVAL_FX_SEC;
      this.drawStreaks(x, y, ship.heading, t, 1, 28);
      this.drawFlash(t);
    }
  }
}
