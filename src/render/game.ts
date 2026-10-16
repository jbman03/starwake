import Phaser from 'phaser';
import type { Controller } from '../app/controller';
import type { InputMode } from '../input/mode';
import { SpaceScene } from './SpaceScene';
import { makePlanetTexture } from './sprites';

export function createGame(parent: HTMLElement, controller: Controller, inputMode: InputMode): Phaser.Game {
  return new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    backgroundColor: '#000000',
    scale: { mode: Phaser.Scale.RESIZE, width: '100%', height: '100%' },
    scene: [new SpaceScene(controller, inputMode)],
    banner: false,
  });
}

/** Resolves once Phaser has booted (texture manager and scenes ready). */
export function whenGameReady(game: Phaser.Game): Promise<void> {
  if (game.isBooted) return Promise.resolve();
  return new Promise((resolve) => game.events.once(Phaser.Core.Events.READY, () => resolve()));
}

/**
 * Snapshot images of generated planet textures for HTML screens, so src/ui never touches Phaser.
 * Returns a lookup giving a PNG data URL for a planet id, or null if it can't be produced.
 */
export function planetImages(game: Phaser.Game, controller: Controller): (planetId: string) => string | null {
  const cache = new Map<string, string>();
  return (planetId) => {
    const cached = cache.get(planetId);
    if (cached) return cached;
    const planet = controller.data.planets[planetId];
    const scene = game.scene.getScene('space');
    if (!planet || !scene?.textures) return null;
    try {
      const key = makePlanetTexture(scene, planet);
      const src = scene.textures.get(key).getSourceImage() as CanvasImageSource & { width: number; height: number };
      let canvas: HTMLCanvasElement;
      if (src instanceof HTMLCanvasElement) canvas = src;
      else {
        canvas = document.createElement('canvas');
        canvas.width = src.width;
        canvas.height = src.height;
        canvas.getContext('2d')!.drawImage(src, 0, 0);
      }
      const url = canvas.toDataURL('image/png');
      cache.set(planetId, url);
      return url;
    } catch (err) {
      console.warn('planet image unavailable', err);
      return null;
    }
  };
}
