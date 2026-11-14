import './ui/styles.css';
import { Mixer } from './audio/mixer';
import { moodFor } from './audio/moods';
import { Music } from './audio/music';
import { battleSounds, SoundBoard } from './audio/sfx';
import { Controller } from './app/controller';
import { WakeLockManager, vibrateIfEnabled, type WakeLockApi } from './app/device';
import { installTestHook, testFlags } from './app/testHook';
import { createUpdateGate } from './app/updateGate';
import { installZoomBlock, fitToScreen, restoreViewport, type GuardWindow, type ScreenWindow } from './app/viewportGuard';
import { DataError } from './data/load';
import { bootData } from './plugins/boot';
import { PluginStore } from './plugins/store';
import { InputMode } from './input/mode';
import { createGame, planetImages, whenGameReady } from './render/game';
import { loadSettings } from './save/settings';
import { PilotStore } from './save/store';
import { createUi } from './ui/context';
import { setUiClickSound } from './ui/dom';
import { hideUpdatePrompt, showCrash, showDataError, showUpdatePrompt } from './ui/overlays';
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
  // The base data plus the enabled plug-ins; a plug-in that doesn't load never stops the game (editor spec §3).
  const plugins = new PluginStore();
  const { data } = await bootData(plugins, flags.dataOverride);
  const settings = loadSettings();
  const controller = new Controller(data, settings, window);
  controller.calm = flags.calm === true;
  const store = new PilotStore();
  controller.store = store;
  installTestHook(controller, data, store);
  const inputMode = new InputMode(window, () => settings.bindings);
  // The page knows the input mode, so touch play hides keyboard hotkey chips (phone playtest bug 8).
  const markInput = (mode: string) => (document.documentElement.dataset.input = mode);
  markInput(inputMode.mode);
  inputMode.onChange(markInput);

  // Sound: the audio context wakes on the first key or tap; events play their effects.
  const mixer = new Mixer(() => settings);
  const sound = new SoundBoard(() => settings, data.audio, mixer);
  // Volume sliders, the mute toggle and the V key all end in controller.settingsChanged().
  controller.on('settings', () => mixer.apply());
  // Touch pointerdown and Escape are not activating gestures, so keep listening until the context runs.
  const unlockEvents = ['pointerdown', 'pointerup', 'touchend', 'click', 'keydown', 'keyup'];
  const unlockSound = () => {
    mixer.unlock();
    if (!mixer.running()) return;
    for (const t of unlockEvents) window.removeEventListener(t, unlockSound);
  };
  for (const t of unlockEvents) window.addEventListener(t, unlockSound);
  setUiClickSound(() => sound.play('uiClick'));
  controller.on('landed', () => sound.play('land'));
  controller.on('missionsCompleted', () => sound.play('paid'));
  controller.on('sfx', (e) => sound.play(e.sfx));
  controller.on('battle', (e) => battleSounds(e.events, data.audio.gunVoices).forEach((s) => sound.play(s)));
  // A beam hums while it fires: each poll keeps it going, and it stops on its own 0.1 s after the last.
  setInterval(() => {
    if (document.visibilityState === 'visible' && controller.isFlying && controller.battleView().beams.length > 0) sound.play('beam');
  }, 50);
  // The hum follows the engine, and stops whenever flight is paused or the ship is not flying.
  setInterval(() => sound.setThrust(document.visibilityState === 'visible' && controller.isFlying && controller.view().thrusting), 50);

  // Music follows the mood of the moment, scheduled a little ahead on the audio clock. It fades out
  // with the pause menu and back in when flight resumes (or the menu leads to a planet or the main
  // menu); the star map, cards and planet screens keep it playing.
  const music = new Music(mixer, data.audio.moods);
  if (window.__starwake) window.__starwake.musicMood = () => music.mood();
  let menuPaused = false;
  const resumeMusic = () => {
    if (!menuPaused) return;
    menuPaused = false;
    music.resume();
  };
  controller.on('menu', (e) => {
    if (e.action !== 'pause') return;
    menuPaused = true;
    music.pause();
  });
  controller.on('flying', (e) => e.flying && resumeMusic());
  setInterval(() => {
    try {
      const input = controller.musicInput();
      music.setMood(moodFor(input));
      if (input.screen !== 'flying') resumeMusic(); // a tow or Quit left the pause menu
      music.tick();
    } catch {
      // music never breaks the game
    }
  }, 250);

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
    mixer.setHidden(document.visibilityState === 'hidden');
    wakeLock.visibilityChanged();
  });

  // A short buzz on landing and jumping, for touch players.
  const buzz = () => vibrateIfEnabled(navigator, settings.touch.vibration, inputMode.mode);
  controller.on('landed', buzz);
  controller.on('jumped', buzz);

  // Updates never interrupt a flight, and never show at the pause/map menus (Restart there would
  // discard progress): only on a planet screen or the main menu. Takeoff withdraws the banner.
  const restart: { run: (() => void) | null } = { run: null };
  const gate = createUpdateGate({
    canShow: () => controller.landedPlanetId !== null || controller.pilot === null,
    show: () =>
      showUpdatePrompt(
        () => restart.run?.(),
        () => gate.dismissed(),
      ),
    hide: hideUpdatePrompt,
  });
  controller.on('flying', (e) => {
    if (e.flying) gate.suspend();
  });
  controller.on('landed', () => gate.flush());
  controller.on('towed', () => gate.flush());
  // Covers loading a pilot (lands without an event) and quitting to the main menu.
  setInterval(() => gate.flush(), 1000);
  void registerPwa(() => gate.notify(), restart);

  const game = createGame(document.getElementById('game')!, controller, inputMode);
  await whenGameReady(game);
  // iPhone browsers can leave the page zoomed or scrolled after a planet screen; the canvas can't
  // undo that, so block page zoom and put the page back whenever flight resumes or the page moves.
  installZoomBlock(window as unknown as GuardWindow);
  // refresh() alone reuses the size Phaser last cached for the container; re-read it first, or a stale portrait size
  // sticks (playtest, Nov 14: the ship at the bottom of the screen after a rotation while paused).
  const remeasure = () => {
    game.scale.getParentBounds();
    game.scale.refresh();
  };
  const restore = () => restoreViewport(window as unknown as GuardWindow, remeasure);
  // Keep the game the size of the visible screen, paused or not: WebKit can leave the full-screen container at its
  // portrait size after a rotation, and it settles late, so look again shortly after each change.
  const gameEl = document.getElementById('game')!;
  const fit = () => fitToScreen(window as unknown as ScreenWindow, gameEl, remeasure);
  const fitSoon = () => {
    fit();
    for (const ms of [150, 600]) setTimeout(fit, ms);
  };
  window.addEventListener('resize', fitSoon);
  window.addEventListener('orientationchange', fitSoon);
  window.visualViewport?.addEventListener('resize', fitSoon);
  controller.on('flying', (e) => {
    if (!e.flying) return;
    restore();
    fitSoon();
  });
  window.visualViewport?.addEventListener('resize', () => controller.isFlying && restore());
  window.visualViewport?.addEventListener('scroll', () => controller.isFlying && restore());
  const ui = createUi(document.getElementById('ui')!, controller, store, planetImages(game, controller), inputMode);
  mountRails({ parent: document.getElementById('touch')!, controller, inputMode });
  ui.go.mainMenu();
}

boot().catch((err) => {
  console.error(err);
  if (err instanceof DataError) showDataError(err);
  else showCrash(err);
});
