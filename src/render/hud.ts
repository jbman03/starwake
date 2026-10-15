import Phaser from 'phaser';
import type { GameData } from '../data/schemas';
import type { WorldState } from '../sim/types';
import { dist } from '../sim/vec';

export const FUEL_COLORS = { normal: '#9fe7a0', low: '#ffb347', empty: '#ff5a4f' } as const;

export function fuelJumps(world: WorldState, data: GameData): number {
  const per = data.config.fuelPerJump;
  return per > 0 ? Math.floor(world.ship.fuel / per) : Infinity;
}

export function fuelColor(jumps: number): string {
  return jumps >= 2 ? FUEL_COLORS.normal : jumps === 1 ? FUEL_COLORS.low : FUEL_COLORS.empty;
}

const MESSAGE_SECONDS = 3;
const FONT = '"Trebuchet MS", "Segoe UI", sans-serif';
const PANEL_W = 210;

/** Desktop flight HUD: status panel top-left, message line bottom-center. Fixed to the screen. */
export class Hud {
  private panel: Phaser.GameObjects.Graphics;
  private fuel: Phaser.GameObjects.Text;
  private system: Phaser.GameObjects.Text;
  private target: Phaser.GameObjects.Text;
  private message: Phaser.GameObjects.Text;
  private messageAge = Infinity;

  constructor(private scene: Phaser.Scene) {
    const text = (x: number, y: number, size: number, color = '#cfd8e3') =>
      scene.add.text(x, y, '', { fontFamily: FONT, fontSize: `${size}px`, color }).setScrollFactor(0).setDepth(1000);

    this.panel = scene.add.graphics().setScrollFactor(0).setDepth(999);
    this.drawPanel();
    this.system = text(20, 16, 15, '#e8eef5');
    text(20, 42, 12, '#8fa0b5').setText('Shields');
    text(20, 58, 12, '#8fa0b5').setText('Armor');
    this.fuel = text(20, 82, 13);
    this.target = text(20, 104, 13, '#b8c4d2');
    this.message = text(0, 0, 15, '#ffffff').setOrigin(0.5, 1);
    this.layout();
    scene.scale.on('resize', this.layout, this);
  }

  private drawPanel(): void {
    const g = this.panel;
    g.clear();
    g.fillStyle(0x0b1018, 0.72);
    g.fillRoundedRect(10, 10, PANEL_W, 120, 6);
    g.lineStyle(1, 0x3a4a5e, 0.9);
    g.strokeRoundedRect(10, 10, PANEL_W, 120, 6);
    // Shields and armor: static full bars until combat exists.
    for (const [y, color] of [[46, 0x4aa8ff], [62, 0xc9a24a]] as const) {
      g.fillStyle(color, 1);
      g.fillRect(84, y, PANEL_W - 84, 8);
    }
  }

  private layout(): void {
    const { width, height } = this.scene.scale;
    this.message.setPosition(width / 2, height - 28);
  }

  showMessage(text: string): void {
    this.message.setText(text).setAlpha(1);
    this.messageAge = 0;
  }

  update(world: WorldState, data: GameData, dtSec: number): void {
    this.system.setText(data.systems[world.systemId]?.name ?? world.systemId);

    const jumps = fuelJumps(world, data);
    this.fuel.setText(`Fuel: ${jumps} jumps`).setColor(fuelColor(jumps));

    const t = world.targetPlanetId ? data.planets[world.targetPlanetId] : undefined;
    this.target.setText(
      t && t.systemId === world.systemId ? `Target: ${t.name}  ${Math.round(dist(t.pos, world.ship.pos))}` : 'Target: none',
    );

    this.messageAge += dtSec;
    const fade = 0.5;
    this.message.setAlpha(this.messageAge < MESSAGE_SECONDS - fade ? 1 : Math.max(0, (MESSAGE_SECONDS - this.messageAge) / fade));
  }

  destroy(): void {
    this.scene.scale.off('resize', this.layout, this);
  }
}
