import { exportFileName, exportPilot } from '../save/transfer';
import type { UiContext } from './context';
import { showSettings } from './settingsScreen';
import { button, confirmDialog, el, formatCredits, hotkeyFor } from './dom';

/** Opened by the `pause` action; the sim stays paused until Resume or `back`. */
export function showPauseMenu(ctx: UiContext): void {
  const { controller, root } = ctx;
  const { data } = controller;
  const status = el('p', { class: 'sw-status', attrs: { 'aria-live': 'polite' } });

  const resume = () => {
    ctx.unmount();
    controller.startFlight();
  };

  const save = async () => {
    const planet = controller.lastPlanetId ? data.planets[controller.lastPlanetId]?.name : undefined;
    try {
      await controller.save();
      status.textContent = `Saved at ${planet ?? 'your last planet'}.`;
    } catch (err) {
      status.textContent = `Save failed: ${err instanceof Error ? err.message : String(err)}`;
    }
  };

  const exportCurrent = () => {
    const p = controller.snapshot();
    if (!p) return;
    const url = URL.createObjectURL(exportPilot(p));
    const a = el('a', { attrs: { href: url, download: exportFileName(p) } });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    status.textContent = `Exported ${exportFileName(p)}.`;
  };

  const quit = async () => {
    const ok = await confirmDialog(root, {
      title: 'Quit to main menu?',
      message: 'Unsaved progress since your last landing will be lost.',
      confirm: 'Quit',
      danger: true,
    });
    if (!ok) return;
    controller.endSession();
    ctx.go.mainMenu();
  };

  const towTo = controller.towDestination();
  const buttons = el('div', { class: 'sw-actions' }, [
    button('Resume', resume, { class: 'sw-btn-primary', hotkey: hotkeyFor(controller.settings.bindings, 'back') }),
    button('Save (at last planet)', () => void save()),
    towTo
      ? button(`Call for tow — ${formatCredits(data.config.towFee)}`, () => {
          // Lands at the destination; the planet screen replaces this menu.
          controller.callTow();
        })
      : null,
    button('Settings', () => showSettings(ctx, { mode: 'keyboard', onClose: () => showPauseMenu(ctx) })),
    button('Export pilot', exportCurrent),
    button('Quit to main menu', () => void quit(), { class: 'sw-btn-danger' }),
  ]);

  const screen = el('div', { class: 'sw-screen sw-overlay', attrs: { 'data-testid': 'pause-menu' } }, [
    el('div', { class: 'sw-panel sw-menu' }, [el('h1', { class: 'sw-title', text: 'Paused' }), buttons, status]),
  ]);

  ctx.mount(screen, {
    groups: ['menus'],
    onPress: (pressed) => {
      if (pressed.has('back')) resume();
    },
  });
}
