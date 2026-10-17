import Phaser from 'phaser';
import type { Controller } from '../app/controller';
import type { SystemDef } from '../data/schemas';
import type { InputMode } from '../input/mode';
import { getInsets } from '../input/insets';
import { pointerTypeOf } from '../input/pointer';
import { computeLayout, type Rect } from '../input/touch';
import { SYSTEM_CENTER } from '../sim/rules';
import { JUMP_DURATION } from '../sim/world';
import { skipLabel } from '../guide/guide';
import { Hud, type HudGuide } from './hud';
import {
  makePlanetTexture,
  makeShipTextures,
  makeStarfieldTexture,
  makeStarTexture,
  shipFrame,
} from './sprites';

/** Planets and stations are tappable this far beyond their edge... */
const TAP_MARGIN = 12;
/** ...and never with a radius under this (a 44 px wide touch target). */
const MIN_TAP_RADIUS = 22;

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
  private ship!: Phaser.GameObjects.Image;
  private bracket!: Phaser.GameObjects.Graphics;
  private fx!: Phaser.GameObjects.Graphics;
  private hud!: Hud;
  private builtSystemId: string | null = null;
  private unsubs: (() => void)[] = [];
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
    this.hud = new Hud(this, () => this.controller.requestGuideSkip());

    this.buildSystem(world.systemId);

    this.unsubs.push(
      this.controller.on('jumped', (e) => this.buildSystem(e.toSystemId)),
      this.controller.on('message', (e) => this.hud.showMessage(e.text)),
    );

    this.applyLayout();
    this.installTestHook();
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.unsubs.forEach((u) => u()));
  }

  /** The view rect for the current window size and input mode, in whole pixels. */
  private currentView(): Rect {
    const { width, height } = this.scale;
    const v =
      this.inputMode.mode === 'touch'
        ? computeLayout(width, height, this.controller.settings.touch, getInsets()).view
        : { x: 0, y: 0, w: width, h: height };
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
    this.hud.setLayout(v.w, v.h, this.inputMode.mode === 'touch');
  }

  /** e2e helpers: the camera viewport and where a planet is on screen. */
  private installTestHook(): void {
    const hook = window.__starwake;
    if (!hook) return;
    hook.cameraViewport = () => {
      const c = this.cameras.main;
      return { x: c.x, y: c.y, w: c.width, h: c.height };
    };
    hook.hudBanner = () => this.hud.bannerText();
    hook.hudCourse = () => this.hud.courseText();
    hook.hudGuide = () => this.hud.guideInfo();
    hook.planetScreenPos = (id) => {
      const p = this.controller.data.planets[id];
      if (!p || p.systemId !== this.builtSystemId) return null;
      const c = this.cameras.main;
      return { x: c.x + (p.pos.x - c.worldView.x) * c.zoom, y: c.y + (p.pos.y - c.worldView.y) * c.zoom };
    };
  }

  /** Rebuild the star and planets for a system. */
  private buildSystem(systemId: string): void {
    if (this.builtSystemId === systemId) return;
    this.builtSystemId = systemId;
    this.bodies.forEach((b) => b.destroy());
    this.bodies = [];
    const { data } = this.controller;
    const sys: SystemDef = data.systems[systemId];
    this.bodies.push(
      this.add.image(SYSTEM_CENTER.x, SYSTEM_CENTER.y, makeStarTexture(this, sys)).setDepth(0).setBlendMode(Phaser.BlendModes.ADD),
    );
    for (const p of Object.values(data.planets)) {
      if (p.systemId !== systemId) continue;
      const img = this.add.image(p.pos.x, p.pos.y, makePlanetTexture(this, p)).setDepth(1);
      const r = Math.max(MIN_TAP_RADIUS, p.radius + TAP_MARGIN);
      img.setInteractive(new Phaser.Geom.Circle(img.width / 2, img.height / 2, r), Phaser.Geom.Circle.Contains);
      // Mouse click: select only. Touch tap: select and land.
      img.on(Phaser.Input.Events.GAMEOBJECT_POINTER_DOWN, (pointer: Phaser.Input.Pointer) =>
        this.controller.tapPlanet(p.id, pointerTypeOf(pointer.event, pointer.wasTouch)),
      );
      this.bodies.push(img);
    }
  }

  update(): void {
    // Real elapsed time: Phaser's smoothed delta lags behind wall-clock when frames are slow,
    // and the fixed stepper already clamps long frames.
    const dt = this.game.loop.rawDelta / 1000;
    this.controller.update(dt);
    const { world, prevShip, alpha, data } = this.controller.view();
    if (world.systemId !== this.builtSystemId) this.buildSystem(world.systemId);
    this.applyLayout();

    // Interpolated ship position; camera stays centered on it.
    const x = prevShip.pos.x + (world.ship.pos.x - prevShip.pos.x) * alpha;
    const y = prevShip.pos.y + (world.ship.pos.y - prevShip.pos.y) * alpha;
    this.ship.setPosition(x, y).setFrame(shipFrame(world.ship.heading));
    const cam = this.cameras.main;
    cam.centerOn(x, y);

    // Starfield: tile offset follows camera scroll scaled per layer, so layers never jitter
    // relative to each other (all derived from the same interpolated camera position).
    for (const ts of this.stars) {
      const k = ts.getData('parallax') as number;
      ts.setTilePosition(cam.scrollX * k, cam.scrollY * k);
    }

    this.drawBracket(world.targetPlanetId);
    this.drawJumpFx(x, y);
    this.hud.update(world, data, dt, this.guideHint());
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
    const p = targetId ? this.controller.data.planets[targetId] : undefined;
    if (!p || p.systemId !== this.controller.world.systemId) return;
    const r = p.radius + 10;
    const arm = Math.max(8, r * 0.3);
    g.lineStyle(2, 0x6fe36f, 0.9);
    for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const cx = p.pos.x + sx * r, cy = p.pos.y + sy * r;
      g.beginPath();
      g.moveTo(cx, cy - sy * arm);
      g.lineTo(cx, cy);
      g.lineTo(cx - sx * arm, cy);
      g.strokePath();
    }
  }

  /** Brief hyperspace effect: star streaks behind the ship, then a white flash. */
  private drawJumpFx(x: number, y: number): void {
    const g = this.fx;
    g.clear();
    const jump = this.controller.world.jump;
    if (!jump) return;
    const t = Math.min(1, jump.t / JUMP_DURATION);
    const h = this.controller.world.ship.heading;
    const dx = Math.cos(h), dy = Math.sin(h);
    const len = 60 + t * t * 900;
    g.lineStyle(1.5, 0xcfe4ff, 0.35 + 0.5 * t);
    for (let i = 0; i < 28; i++) {
      // Deterministic spread so streaks don't flicker frame to frame.
      const off = ((i * 97) % 28 - 14) * 22;
      const ahead = ((i * 53) % 17) * 30 - 200;
      const sx = x - dy * off + dx * ahead, sy = y + dx * off + dy * ahead;
      g.beginPath();
      g.moveTo(sx, sy);
      g.lineTo(sx - dx * len, sy - dy * len);
      g.strokePath();
    }
    const flash = t > 0.75 ? (t - 0.75) / 0.25 : 0;
    if (flash > 0) {
      const cam = this.cameras.main;
      g.fillStyle(0xffffff, flash * 0.85);
      g.fillRect(cam.scrollX, cam.scrollY, cam.width, cam.height);
    }
  }
}
