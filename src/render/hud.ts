import Phaser from 'phaser';
import type { GameData } from '../data/schemas';
import type { WorldState } from '../sim/types';
import { hudInfo, routeBannerText } from './hudInfo';

const MESSAGE_SECONDS = 3;
const FONT = '"Trebuchet MS", "Segoe UI", sans-serif';
const PANEL_W = 210;
const PANEL_H = 164;
/** Extra panel height for the course line. */
const COURSE_H = 22;
/** Space between the status panel and the guide hint under it. */
const GUIDE_GAP = 8;

/** The First Flight guide's hint for the HUD, or null when the guide isn't running. */
export interface HudGuide {
  text: string;
  /** Label of the skip control ("Skip guide", or "Dismiss" on the last card). */
  skip: string;
}

/**
 * Flight HUD drawn by the main camera, fixed to its viewport. Keyboard mode: status panel
 * top-left, autopilot route banner top-center, message line bottom-center. Touch mode: the status panel moves into the left rail
 * (drawn in HTML by src/ui/rails.ts), and the message moves to the top so it never sits under
 * the context button.
 */
export class Hud {
  private panel: Phaser.GameObjects.Graphics;
  private fuel: Phaser.GameObjects.Text;
  private system: Phaser.GameObjects.Text;
  private credits: Phaser.GameObjects.Text;
  private cargo: Phaser.GameObjects.Text;
  private target: Phaser.GameObjects.Text;
  /** "Course: Vesk (2 jumps)" under the target line while a course is plotted. */
  private course: Phaser.GameObjects.Text;
  private panelH = 0;
  private message: Phaser.GameObjects.Text;
  /** Autopilot route banner, top-center (keyboard mode; the rails draw it in touch mode). */
  private banner: Phaser.GameObjects.Text;
  private messageAge = Infinity;
  /** First Flight guide hint: a box under the status panel, within the panel's width. */
  private guideBox: Phaser.GameObjects.Graphics;
  private guideText: Phaser.GameObjects.Text;
  private guideSkip: Phaser.GameObjects.Text;
  private guideKey = '';
  private statics: Phaser.GameObjects.GameObject[] = [];
  private touchMode = false;
  private viewW = 0;
  private viewH = 0;

  constructor(scene: Phaser.Scene, onGuideSkip: () => void = () => {}) {
    const text = (x: number, y: number, size: number, color = '#cfd8e3') =>
      scene.add.text(x, y, '', { fontFamily: FONT, fontSize: `${size}px`, color }).setScrollFactor(0).setDepth(1000);

    this.panel = scene.add.graphics().setScrollFactor(0).setDepth(999);
    this.drawPanel(PANEL_H);
    this.system = text(20, 16, 15, '#e8eef5');
    this.statics.push(text(20, 42, 12, '#8fa0b5').setText('Shields'), text(20, 58, 12, '#8fa0b5').setText('Armor'));
    this.fuel = text(20, 82, 13);
    this.credits = text(20, 104, 13, '#e8d9a8');
    this.cargo = text(20, 126, 13, '#b8c4d2');
    this.target = text(20, 148, 13, '#b8c4d2');
    this.course = text(20, 170, 13, '#9fe7a0').setVisible(false);
    this.message = text(0, 0, 15, '#ffffff').setOrigin(0.5, 1);
    this.banner = scene.add
      .text(0, 14, '', {
        fontFamily: FONT,
        fontSize: '14px',
        color: '#dff7df',
        backgroundColor: 'rgba(16, 36, 22, 0.85)',
        padding: { x: 12, y: 6 },
      })
      .setOrigin(0.5, 0)
      .setScrollFactor(0)
      .setDepth(1000)
      .setVisible(false);
    this.guideBox = scene.add.graphics().setScrollFactor(0).setDepth(999).setVisible(false);
    this.guideText = scene.add
      .text(20, 0, '', { fontFamily: FONT, fontSize: '13px', color: '#eef3f9', lineSpacing: 2, wordWrap: { width: PANEL_W - 20, useAdvancedWrap: true } })
      .setScrollFactor(0)
      .setDepth(1000)
      .setVisible(false);
    this.guideSkip = scene.add
      .text(20, 0, '', { fontFamily: FONT, fontSize: '12px', color: '#7fb2ff', padding: { x: 0, y: 4 } })
      .setScrollFactor(0)
      .setDepth(1000)
      .setVisible(false)
      .setInteractive({ useHandCursor: true });
    this.guideSkip.on(Phaser.Input.Events.GAMEOBJECT_POINTER_DOWN, () => onGuideSkip());
    this.setLayout(scene.scale.width, scene.scale.height, false);
  }

  /** Size of the camera viewport the HUD is drawn in, and whether touch rails are showing. */
  setLayout(viewW: number, viewH: number, touchMode: boolean): void {
    if (viewW === this.viewW && viewH === this.viewH && touchMode === this.touchMode) return;
    this.viewW = viewW;
    this.viewH = viewH;
    this.touchMode = touchMode;
    for (const o of [this.panel, this.system, this.fuel, this.credits, this.cargo, this.target, ...this.statics]) {
      (o as unknown as Phaser.GameObjects.Components.Visible).setVisible(!touchMode);
    }
    if (touchMode) this.course.setVisible(false);
    this.banner.setPosition(viewW / 2, 14);
    // Touch mode: the message sits below the (HTML) route banner, clear of the context button.
    if (touchMode) this.message.setOrigin(0.5, 0).setPosition(viewW / 2, 56);
    else this.message.setOrigin(0.5, 1).setPosition(viewW / 2, viewH - 28);
  }


  private drawPanel(height: number): void {
    if (height === this.panelH) return;
    this.panelH = height;
    const g = this.panel;
    g.clear();
    g.fillStyle(0x0b1018, 0.72);
    g.fillRoundedRect(10, 10, PANEL_W, height, 6);
    g.lineStyle(1, 0x3a4a5e, 0.9);
    g.strokeRoundedRect(10, 10, PANEL_W, height, 6);
    // Shields and armor: static full bars until combat exists.
    for (const [y, color] of [[46, 0x4aa8ff], [62, 0xc9a24a]] as const) {
      g.fillStyle(color, 1);
      g.fillRect(84, y, PANEL_W - 84, 8);
    }
  }

  /** The course line's text when it is showing (e2e checks), else null. */
  courseText(): string | null {
    return this.course.visible ? this.course.text : null;
  }

  /** The guide hint's text and the skip control's screen box when showing (e2e checks), else null. */
  guideInfo(): { text: string; skip: { x: number; y: number; w: number; h: number } } | null {
    if (!this.guideText.visible) return null;
    const b = this.guideSkip.getBounds();
    return { text: this.guideText.text, skip: { x: b.x, y: b.y, w: b.width, h: b.height } };
  }

  /** The route banner's text when it is showing (e2e checks), else null. */
  bannerText(): string | null {
    return this.banner.visible ? this.banner.text : null;
  }

  /** The hint box under the status panel (the touch rail draws its own in touch mode). */
  private drawGuide(guide: HudGuide | null): void {
    const key = guide ? `${this.panelH}|${guide.skip}|${guide.text}` : '';
    if (key === this.guideKey) return;
    this.guideKey = key;
    for (const o of [this.guideBox, this.guideText, this.guideSkip]) o.setVisible(guide !== null);
    if (!guide) return;
    const top = 10 + this.panelH + GUIDE_GAP;
    this.guideText.setText(guide.text).setPosition(20, top + 8);
    this.guideSkip.setText(`${guide.skip} ›`).setPosition(20, top + 8 + this.guideText.height + 2);
    const h = this.guideText.height + this.guideSkip.height + 18;
    const g = this.guideBox;
    g.clear();
    g.fillStyle(0x121f31, 0.9);
    g.fillRoundedRect(10, top, PANEL_W, h, 6);
    g.lineStyle(1, 0x4c6a92, 1);
    g.strokeRoundedRect(10, top, PANEL_W, h, 6);
    g.fillStyle(0x7fb2ff, 1);
    g.fillRect(10, top + 4, 3, h - 8);
  }

  showMessage(text: string): void {
    this.message.setText(text).setAlpha(1);
    this.messageAge = 0;
  }

  update(world: WorldState, data: GameData, dtSec: number, guide: HudGuide | null = null): void {
    if (!this.touchMode) {
      const info = hudInfo(world, data);
      this.system.setText(info.system);
      this.fuel.setText(info.fuel).setColor(info.fuelColor);
      this.credits.setText(info.credits);
      this.cargo.setText(info.cargo);
      this.target.setText(info.target);
      this.course.setText(info.nextHop ?? '').setVisible(info.nextHop !== null);
      this.drawPanel(info.nextHop === null ? PANEL_H : PANEL_H + COURSE_H);
    }
    this.drawGuide(this.touchMode ? null : guide);
    const route = this.touchMode ? null : routeBannerText(world, data);
    if (route === null) this.banner.setVisible(false);
    else if (!this.banner.visible || this.banner.text !== route) this.banner.setText(route).setVisible(true);

    this.messageAge += dtSec;
    const fade = 0.5;
    this.message.setAlpha(this.messageAge < MESSAGE_SECONDS - fade ? 1 : Math.max(0, (MESSAGE_SECONDS - this.messageAge) / fade));
  }
}
