import Phaser from 'phaser';
import type { GameData } from '../data/schemas';
import type { WorldState } from '../sim/types';
import { fitText, radarBlips, radarHeadingTip, sidebarInfo, type SidebarInfo } from './sidebarInfo';

const FONT = '"Trebuchet MS", "Segoe UI", sans-serif';
/** Width of the PC sidebar. */
export const SIDEBAR_W = 200;
const PAD = 12;
/** Longest line of text that fits beside the padding at the smallest font used. */
const MAX_CHARS = 26;
const RADAR_R = 76;
const BAR_H = 8;
const MAP_H = 30;

/**
 * Escape Velocity style right-hand sidebar for keyboard play: radar, shield/armor/fuel bars,
 * nav, target, cargo, credits, date and a Map button. Phaser Graphics and Text at depth 1000,
 * scroll factor 0.
 */
export class Sidebar {
  private g: Phaser.GameObjects.Graphics;
  private radar: Phaser.GameObjects.Graphics;
  private texts: Phaser.GameObjects.Text[] = [];
  private labels: Record<'shields' | 'armor' | 'fuel' | 'nav' | 'secondary' | 'target' | 'targetDetail' | 'cargo' | 'credits' | 'date', Phaser.GameObjects.Text>;
  private mapBtn: Phaser.GameObjects.Text;
  private screenX = 0;
  private readonly x = 0;
  /** The camera that draws the sidebar (the main camera's viewport stops where the sidebar starts). */
  readonly cam: Phaser.Cameras.Scene2D.Camera;
  private h = 0;
  private visible = true;

  constructor(scene: Phaser.Scene, onMap: () => void, mapKeyLabel: () => string | undefined) {
    this.mapKeyLabel = mapKeyLabel;
    this.cam = scene.cameras.add(0, 0, SIDEBAR_W, 1);
    const text = (size: number, color = '#cfd8e3') => {
      const t = scene.add.text(0, 0, '', { fontFamily: FONT, fontSize: `${size}px`, color }).setScrollFactor(0).setDepth(1000);
      this.texts.push(t);
      return t;
    };
    this.g = scene.add.graphics().setScrollFactor(0).setDepth(999);
    this.radar = scene.add.graphics().setScrollFactor(0).setDepth(1000);
    this.labels = {
      shields: text(11, '#8fa0b5'),
      armor: text(11, '#8fa0b5'),
      fuel: text(11, '#8fa0b5'),
      nav: text(13, '#9fe7a0'),
      secondary: text(13, '#b8c4d2'),
      target: text(13, '#e8eef5'),
      targetDetail: text(12, '#b8c4d2'),
      cargo: text(13, '#b8c4d2'),
      credits: text(13, '#e8d9a8'),
      date: text(12, '#8fa0b5'),
    };
    this.mapBtn = scene.add
      .text(0, 0, 'Map', { fontFamily: FONT, fontSize: '14px', color: '#dff0ff', align: 'center', fixedWidth: SIDEBAR_W - PAD * 2, fixedHeight: MAP_H, padding: { top: 6 } })
      .setScrollFactor(0)
      .setDepth(1000)
      .setInteractive({ useHandCursor: true });
    this.mapBtn.on(Phaser.Input.Events.GAMEOBJECT_POINTER_DOWN, () => onMap());
    this.texts.push(this.mapBtn);
  }

  private mapKeyLabel: () => string | undefined;

  /**
   * Place the sidebar with its left edge at screen `x`, full height `h`. It is drawn by its own
   * camera (see `camera`) whose viewport starts at `x`, so its objects use local coordinates.
   */
  layout(x: number, h: number): void {
    this.screenX = x;
    this.cam.setViewport(x, 0, SIDEBAR_W, h);
    this.h = h;
    this.place();
  }

  setVisible(v: boolean): void {
    this.visible = v;
    this.cam.setVisible(v);
    this.g.setVisible(v);
    this.radar.setVisible(v);
    for (const t of this.texts) t.setVisible(v);
  }

  isVisible(): boolean {
    return this.visible;
  }

  /** Every object the sidebar draws, so the other camera can skip them. */
  objects(): Phaser.GameObjects.GameObject[] {
    return [this.g, this.radar, ...this.texts];
  }

  /** Screen rect of the Map button. */
  mapButtonBounds(): { x: number; y: number; w: number; h: number } {
    const b = this.localMapBounds();
    return { ...b, x: this.screenX + b.x };
  }

  private localMapBounds(): { x: number; y: number; w: number; h: number } {
    return { x: this.x + PAD, y: this.h - PAD - MAP_H, w: SIDEBAR_W - PAD * 2, h: MAP_H };
  }

  private place(): void {
    const x = this.x + PAD;
    const L = this.labels;
    let y = 12;
    // Radar at the top.
    y += RADAR_R * 2 + 12;
    L.shields.setPosition(x, y);
    L.armor.setPosition(x, y + 20);
    L.fuel.setPosition(x, y + 40);
    y += 70;
    L.nav.setPosition(x, y);
    L.secondary.setPosition(x, y + 20);
    y += 50;
    L.target.setPosition(x, y);
    L.targetDetail.setPosition(x, y + 18);
    y += 50;
    L.cargo.setPosition(x, y);
    L.credits.setPosition(x, y + 20);
    L.date.setPosition(x, y + 40);
    const b = this.localMapBounds();
    this.mapBtn.setPosition(b.x, b.y);
  }

  update(world: WorldState, data: GameData, _dtSec: number): void {
    if (!this.visible) return;
    const info = sidebarInfo(world, data);
    const L = this.labels;
    L.shields.setText('Shields');
    L.armor.setText('Armor');
    L.fuel.setText(`Fuel · ${info.jumps === Infinity ? '∞' : info.jumps} ${info.jumps === 1 ? 'jump' : 'jumps'}`);
    L.nav.setText(fitText(`Nav: ${info.nav}`, MAX_CHARS));
    L.secondary.setText(`Secondary: ${info.secondary}`);
    L.target.setText(fitText(info.target ?? 'No target', MAX_CHARS));
    L.targetDetail.setText(info.targetDetail ?? '');
    L.cargo.setText(`Cargo free: ${info.cargoFree}`);
    L.credits.setText(info.credits);
    L.date.setText(info.date);
    const key = this.mapKeyLabel();
    this.mapBtn.setText(key ? `Map (${key})` : 'Map');
    this.draw(world, data, info);
  }

  private draw(world: WorldState, data: GameData, info: SidebarInfo): void {
    const g = this.g;
    g.clear();
    g.fillStyle(0x0b1018, 0.94);
    g.fillRect(this.x, 0, SIDEBAR_W, this.h);
    g.lineStyle(1, 0x3a4a5e, 1);
    g.lineBetween(this.x + 0.5, 0, this.x + 0.5, this.h);

    const x = this.x + PAD;
    const bars: [string, number, number][] = [
      ['shields', info.shields > 0 ? 1 : 0, 0x4aa8ff],
      ['armor', info.armor > 0 ? 1 : 0, 0xc9a24a],
      ['fuel', info.fuelFrac, info.jumps >= 2 ? 0x9fe7a0 : info.jumps === 1 ? 0xffb347 : 0xff5a4f],
    ];
    const first = this.labels.shields.y;
    bars.forEach(([, frac, color], i) => {
      const by = first + i * 20 + 14;
      g.fillStyle(0x1a2433, 1);
      g.fillRect(x, by, SIDEBAR_W - PAD * 2, BAR_H);
      g.fillStyle(color, 1);
      g.fillRect(x, by, Math.round((SIDEBAR_W - PAD * 2) * frac), BAR_H);
    });

    // Radar.
    const cx = this.x + SIDEBAR_W / 2;
    const cy = 12 + RADAR_R;
    const r = this.radar;
    r.clear();
    r.fillStyle(0x070b12, 1);
    r.fillCircle(cx, cy, RADAR_R);
    r.lineStyle(1, 0x7fb2ff, 0.4);
    r.strokeCircle(cx, cy, RADAR_R);
    r.strokeCircle(cx, cy, RADAR_R / 2);
    for (const b of radarBlips(world, data, RADAR_R - 4)) {
      if (b.kind === 'star') {
        r.fillStyle(0xffd27a, 1);
        r.fillCircle(cx + b.x, cy + b.y, 4);
      } else if (b.kind === 'jumpRing') {
        r.lineStyle(1, 0x7fb2ff, 0.9);
        r.strokeCircle(cx + b.x, cy + b.y, 4);
      } else {
        r.fillStyle(b.kind === 'target' ? 0x6fe36f : 0x9fb4cc, 1);
        r.fillCircle(cx + b.x, cy + b.y, 2.5);
      }
    }
    // The ship: a dot with a tick toward its nose.
    const tip = radarHeadingTip(world.ship.heading, 9);
    r.lineStyle(2, 0xffffff, 1);
    r.lineBetween(cx, cy, cx + tip.x, cy + tip.y);
    r.fillStyle(0xffffff, 1);
    r.fillCircle(cx, cy, 2.5);

    // Map button box.
    const m = this.localMapBounds();
    g.fillStyle(0x16263b, 1);
    g.fillRoundedRect(m.x, m.y, m.w, m.h, 5);
    g.lineStyle(1, 0x4c6a92, 1);
    g.strokeRoundedRect(m.x, m.y, m.w, m.h, 5);
  }

}
