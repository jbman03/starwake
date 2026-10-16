import './ui/styles.css';
import { Controller } from './app/controller';
import { WakeLockManager, vibrateIfEnabled, type WakeLockApi } from './app/device';
import { installTestHook, testFlags } from './app/testHook';
import { createUpdateGate } from './app/updateGate';
import { DataError, loadGameData } from './data/load';
import { InputMode } from './input/mode';
import { createGame, planetImages, whenGameReady } from './render/game';
import { loadSettings } from './save/settings';
import { PilotStore } from './save/store';
import { createUi } from './ui/context';
import { showCrash, showDataError, showUpdatePrompt } from './ui/overlays';
import { mountRails } from './ui/rails';

// Installed first so nothing that goes wrong later can leave a blank screen.
window.addEventListener('error', (e) => {
  if (!e.error && /ResizeObserver/.test(e.message)) return; // benign browser notice
  showCrash(e.error ?? e.message);
});
window.addEventListener('unhandledrejection', (e) => showCrash(e.reason));

/** Service worker registration (production builds only). `onNeedRefresh` fires when a new version is ready. */
async function registerPwa(onNeedRefresh: () => void, restartRef: { run: (() => void) | null }): Promise<void> {
  if (!import.meta.env.PROD) return;
  try {
    const { registerSW } = await import('virtual:pwa-register');
    const updateSW = registerSW({ onNeedRefresh });
    restartRef.run = () => void updateSW(true);
  } catch (err) {
    console.warn('Service worker unavailable', err);
  }
}

async function boot(): Promise<void> {
  const flags = testFlags();
  if (flags.crash) throw new Error('Test crash (?crash=1)');
  const data = await loadGameData(flags.dataOverride);
  const settings = loadSettings();
  const controller = new Controller(data, settings, window);
  const store = new PilotStore();
  controller.store = store;
  installTestHook(controller, data, store);
  const inputMode = new InputMode(window, () => settings.bindings);

  // Nothing stays held when the app is backgrounded.
  const releaseInputs = () => controller.releaseInputs();
  window.addEventListener('blur', releaseInputs);

  // Keep the screen awake while flying.
  const wakeLock = new WakeLockManager(
    (navigator as Navigator & { wakeLock?: WakeLockApi }).wakeLock,
    () => document.visibilityState === 'visible',
  );
  controller.on('flying', (e) => wakeLock.setFlying(e.flying));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') releaseInputs();
    wakeLock.visibilityChanged();
  });

  // A short buzz on landing and jumping, for touch players.
  const buzz = () => vibrateIfEnabled(navigator, settings.touch.vibration, inputMode.mode);
  controller.on('landed', buzz);
  controller.on('jumped', buzz);

  // Updates never interrupt a flight: a new version waits for the next landing or menu.
  const restart: { run: (() => void) | null } = { run: null };
  const gate = createUpdateGate({
    canShow: () => !controller.isFlying,
    show: () => showUpdatePrompt(() => restart.run?.()),
  });
  controller.on('flying', (e) => {
    if (!e.flying) gate.flush();
  });
  void registerPwa(() => gate.notify(), restart);

  const game = createGame(document.getElementById('game')!, controller, inputMode);
  await whenGameReady(game);
  const ui = createUi(document.getElementById('ui')!, controller, store, planetImages(game, controller), inputMode);
  mountRails({ parent: document.getElementById('touch')!, controller, inputMode });
  ui.go.mainMenu();
}

boot().catch((err) => {
  console.error(err);
  if (err instanceof DataError) showDataError(err);
  else showCrash(err);
});
