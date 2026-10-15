import Phaser from 'phaser';
import type { Controller } from '../app/controller';
import { SpaceScene } from './SpaceScene';

export function createGame(parent: HTMLElement, controller: Controller): Phaser.Game {
  return new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    backgroundColor: '#000000',
    scale: { mode: Phaser.Scale.RESIZE, width: '100%', height: '100%' },
    scene: [new SpaceScene(controller)],
    banner: false,
  });
}
