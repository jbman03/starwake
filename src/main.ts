import { Controller } from './app/controller';
import { installTestHook } from './app/testHook';
import { loadGameData } from './data/load';
import { createGame } from './render/game';
import { loadSettings } from './save/settings';

async function boot(): Promise<void> {
  const data = await loadGameData();
  const settings = loadSettings();
  const controller = new Controller(data, settings, window);
  installTestHook(controller, data);
  // Until menus arrive (Task 9), boot straight into flight at the start planet.
  controller.startFlight();
  createGame(document.getElementById('game')!, controller);
}

boot().catch((err) => {
  console.error(err);
  const ui = document.getElementById('ui');
  if (ui) ui.textContent = `Starwake failed to start: ${err instanceof Error ? err.message : String(err)}`;
});
