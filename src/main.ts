import './ui/styles.css';
import { Controller } from './app/controller';
import { installTestHook } from './app/testHook';
import { loadGameData } from './data/load';
import { InputMode } from './input/mode';
import { createGame, planetImages, whenGameReady } from './render/game';
import { loadSettings } from './save/settings';
import { PilotStore } from './save/store';
import { createUi } from './ui/context';
import { mountRails } from './ui/rails';

async function boot(): Promise<void> {
  const data = await loadGameData();
  const settings = loadSettings();
  const controller = new Controller(data, settings, window);
  const store = new PilotStore();
  controller.store = store;
  installTestHook(controller, data, store);
  const inputMode = new InputMode(window, () => settings.bindings);
  const game = createGame(document.getElementById('game')!, controller, inputMode);
  await whenGameReady(game);
  const ui = createUi(document.getElementById('ui')!, controller, store, planetImages(game, controller), inputMode);
  mountRails({ parent: document.getElementById('touch')!, controller, inputMode });
  ui.go.mainMenu();
}

boot().catch((err) => {
  console.error(err);
  const ui = document.getElementById('ui');
  if (ui) ui.textContent = `Starwake failed to start: ${err instanceof Error ? err.message : String(err)}`;
});
