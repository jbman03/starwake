import Phaser from 'phaser';
import type { GameData } from '../data/schemas';
import type { Settings } from '../save/settings';
import type { Battle, BattleEvent } from '../sim/battle';
import { PLAYER_ID } from '../sim/combat';
import { hashString } from '../sim/random';
import { targetedNpc, type Traffic } from '../sim/traffic';
import type { Vec2 } from '../sim/vec';
import {
  burstParticles,
  FX_COLORS,
  hullBars,
  particleCount,
  projectileDrawPos,
  pushTrail,
  shotColor,
  sparkCount,
  sparkPoints,
  type Particle,
} from './combatFx';

/** How long each effect lasts (s). */
const RING_SEC = 0.3;
const ARMOR_FLASH_SEC = 0.15;
const BURST_SEC = 0.9;
const BURST_FLASH_SEC = 0.3;
/** A bolt is drawn as a line this long, back along its path. */
const BOLT_LEN = 10;
/** The hull gauge under the targeted ship: bar height, gap, and how far under the ship's edge. */
const GAUGE_H = 3;
const GAUGE_GAP = 1;
const GAUGE_DROP = 8;
const SIM_DT = 1 / 60;

interface Ring { targetId: string; pos: Vec2; t: number }
interface Flash { pos: Vec2; t: number }
interface Burst { pos: Vec2; parts: Particle[]; scale: number; t: number }

/** Where the player is drawn this frame. */
export interface PlayerDraw {
  pos: Vec2;
  /** Offset from the sim position to the drawn (interpolated) one. */
  offset: Vec2;
  radius: number;
}

/**
 * The fight drawn in world space: bolts, rockets and seekers with trails, beams, shield-hit rings,
 * armor-hit flashes, explosions, sparks on disabled ships and the target's hull gauge. Two
 * Graphics objects, redrawn every frame; both are registered as world objects.
 */
export class CombatLayer {
  private g: Phaser.GameObjects.Graphics;
  /** Additive glow under the bright parts. */
  private glow: Phaser.GameObjects.Graphics;
  private trails = new Map<number, Vec2[]>();
  private rings: Ring[] = [];
  private flashes: Flash[] = [];
  private bursts: Burst[] = [];
  /** Last known radius of each ship, so a ship removed on its destruction still blows up to size. */
  private radii = new Map<string, number>();
  private drawnShots = 0;
  private bars: { shields: number; armor: number } | null = null;
  private readonly particles: number;
  private readonly sparks: number;

  constructor(scene: Phaser.Scene, register: (o: Phaser.GameObjects.GameObject) => void, quality: Settings['quality']) {
    this.glow = scene.add.graphics().setDepth(11).setBlendMode(Phaser.BlendModes.ADD);
    this.g = scene.add.graphics().setDepth(12);
    register(this.glow);
    register(this.g);
    this.particles = particleCount(quality);
    this.sparks = sparkCount(quality);
  }

  /** Forget every effect (a jump or landing leaves the fight behind). */
  clear(): void {
    this.trails.clear();
    this.rings = [];
    this.flashes = [];
    this.bursts = [];
    this.radii.clear();
    this.g.clear();
    this.glow.clear();
    this.drawnShots = 0;
    this.bars = null;
  }

  /** Start the effects for one tick of fight events. */
  onEvents(events: readonly BattleEvent[], player: PlayerDraw): void {
    for (const e of events) {
      if (e.type === 'hit') {
        if (e.shield) this.rings.push({ targetId: e.targetId, pos: { ...e.pos }, t: 0 });
        else this.flashes.push({ pos: { ...e.pos }, t: 0 });
      } else if (e.type === 'destroyed') {
        this.burst(e.pos, hashString(e.id, e.pos.x, e.pos.y), this.radii.get(e.id) ?? 16);
      } else if (e.type === 'playerDestroyed') {
        this.burst(e.pos, hashString(PLAYER_ID, e.pos.x, e.pos.y), player.radius);
      }
    }
  }

  private burst(pos: Vec2, seed: number, radius: number): void {
    this.bursts.push({ pos: { ...pos }, parts: burstParticles(seed, this.particles), scale: Math.max(0.7, radius / 16), t: 0 });
  }

  /** Shots drawn on the last frame (e2e checks). */
  projectileCount(): number {
    return this.drawnShots;
  }

  /** The targeted ship's gauge as drawn on the last frame, or null with none. */
  targetBars(): { shields: number; armor: number } | null {
    return this.bars;
  }

  /**
   * Redraw. `dt` ages the effects (0 while flight is paused); `timeSec` drives the sparks;
   * `alpha` is the interpolation factor the ship is drawn with.
   */
  update(dt: number, timeSec: number, battle: Readonly<Battle>, traffic: Traffic, data: GameData, alpha: number, player: PlayerDraw): void {
    const g = this.g;
    const glow = this.glow;
    g.clear();
    glow.clear();
    for (const n of traffic.npcs) this.radii.set(n.id, data.ships[n.shipId]?.radius ?? 16);
    const shipPos = (id: string): Vec2 | null => {
      if (id === PLAYER_ID) return player.pos;
      const n = traffic.npcs.find((x) => x.id === id);
      return n ? n.ship.pos : null;
    };

    // Beams: this tick's, one frame each. The player's start from the drawn ship.
    for (const b of battle.beams) {
      const off = b.ownerId === PLAYER_ID ? player.offset : { x: 0, y: 0 };
      const c = shotColor(b.ownerId);
      const x0 = b.from.x + off.x, y0 = b.from.y + off.y, x1 = b.to.x + off.x, y1 = b.to.y + off.y;
      glow.lineStyle(7, c, 0.25);
      glow.lineBetween(x0, y0, x1, y1);
      g.lineStyle(2, c, 0.95);
      g.lineBetween(x0, y0, x1, y1);
    }

    // Projectiles: bolts as short lines, rockets and seekers as a bright head with a fading trail.
    const live = new Set<number>();
    for (const p of battle.projectiles) {
      live.add(p.id);
      const at = projectileDrawPos(p, alpha, SIM_DT);
      if (p.kind === 'bolt') {
        const sp = Math.hypot(p.vel.x, p.vel.y) || 1;
        const tx = at.x - (p.vel.x / sp) * BOLT_LEN, ty = at.y - (p.vel.y / sp) * BOLT_LEN;
        const c = shotColor(p.ownerId);
        glow.lineStyle(5, c, 0.3);
        glow.lineBetween(tx, ty, at.x, at.y);
        g.lineStyle(2, c, 1);
        g.lineBetween(tx, ty, at.x, at.y);
        continue;
      }
      const trail = pushTrail(this.trails.get(p.id) ?? [], at);
      this.trails.set(p.id, trail);
      for (let i = 1; i < trail.length; i++) {
        g.lineStyle(3 - i * 0.4, FX_COLORS.missileTrail, 0.8 * (1 - i / trail.length));
        g.lineBetween(trail[i - 1].x, trail[i - 1].y, trail[i].x, trail[i].y);
      }
      glow.fillStyle(FX_COLORS.missileTrail, 0.35);
      glow.fillCircle(at.x, at.y, 6);
      g.fillStyle(FX_COLORS.missileHead, 1);
      g.fillCircle(at.x, at.y, 2.5);
    }
    for (const id of this.trails.keys()) if (!live.has(id)) this.trails.delete(id);
    this.drawnShots = battle.projectiles.length;

    // Shield rings follow the ship that was hit; armor hits are a brief hot flash.
    this.rings = this.rings.filter((r) => (r.t += dt) < RING_SEC);
    for (const r of this.rings) {
      const at = shipPos(r.targetId) ?? r.pos;
      const rad = (this.radii.get(r.targetId) ?? player.radius) + 4 + (r.t / RING_SEC) * 8;
      g.lineStyle(2, FX_COLORS.shield, 0.85 * (1 - r.t / RING_SEC));
      g.strokeCircle(at.x, at.y, rad);
    }
    this.flashes = this.flashes.filter((f) => (f.t += dt) < ARMOR_FLASH_SEC);
    for (const f of this.flashes) {
      const k = 1 - f.t / ARMOR_FLASH_SEC;
      glow.fillStyle(FX_COLORS.armorHit, 0.7 * k);
      glow.fillCircle(f.pos.x, f.pos.y, 3 + 5 * (1 - k));
    }

    // Explosions: a flash, then particles flying out and fading.
    this.bursts = this.bursts.filter((b) => (b.t += dt) < BURST_SEC);
    for (const b of this.bursts) {
      const k = b.t / BURST_SEC;
      if (b.t < BURST_FLASH_SEC) {
        const f = b.t / BURST_FLASH_SEC;
        glow.fillStyle(0xfff4d0, 0.8 * (1 - f));
        glow.fillCircle(b.pos.x, b.pos.y, (10 + 26 * f) * b.scale);
      }
      const travel = b.t * (1 - k / 2); // slowing as it goes
      for (const p of b.parts) {
        const x = b.pos.x + p.dx * p.speed * travel * b.scale;
        const y = b.pos.y + p.dy * p.speed * travel * b.scale;
        g.fillStyle(FX_COLORS.explosion[p.color], 1 - k);
        g.fillCircle(x, y, p.size * (1 - k * 0.5));
      }
    }

    // Sparks on disabled ships, the player's too.
    const spark = (seed: number, at: Vec2, radius: number) => {
      sparkPoints(seed, timeSec, radius, this.sparks).forEach((o, i) => {
        const c = FX_COLORS.spark[i % FX_COLORS.spark.length];
        glow.fillStyle(c, 0.9);
        glow.fillCircle(at.x + o.x, at.y + o.y, 1.6);
        g.lineStyle(1, c, 0.9);
        g.lineBetween(at.x + o.x - 2, at.y + o.y, at.x + o.x + 2, at.y + o.y);
      });
    };
    for (const n of traffic.npcs) {
      if (n.hull.disabled && n.phase === 'fly') spark(hashString(n.id), n.ship.pos, this.radii.get(n.id) ?? 16);
    }
    if (battle.player.disabled && !battle.playerDestroyed) spark(hashString(PLAYER_ID), player.pos, player.radius);

    // The targeted ship's hull gauge: shields over armor, under the ship.
    const t = targetedNpc(traffic);
    this.bars = null;
    if (t && t.phase === 'fly') {
      const radius = this.radii.get(t.id) ?? 16;
      const w = Math.max(28, radius * 2);
      const x = t.ship.pos.x - w / 2;
      const y = t.ship.pos.y + radius + GAUGE_DROP;
      const bars = hullBars(t.hull);
      ([[bars.shields, FX_COLORS.barShield], [bars.armor, FX_COLORS.barArmor]] as const).forEach(([frac, c], i) => {
        const by = y + i * (GAUGE_H + GAUGE_GAP);
        g.fillStyle(FX_COLORS.barTrack, 0.85);
        g.fillRect(x, by, w, GAUGE_H);
        g.fillStyle(c, 1);
        g.fillRect(x, by, w * frac, GAUGE_H);
      });
      this.bars = bars;
    }
  }
}
