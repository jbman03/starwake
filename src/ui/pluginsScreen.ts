import { loadRawGameData, type RawGameData } from '../data/load';
import { pluginBoot } from '../plugins/boot';
import { checkPlugins, pluginSummary, readPlugin } from '../plugins/format';
import { PluginStore, type StoredPlugin } from '../plugins/store';
import type { UiContext } from './context';
import { button, confirmDialog, el } from './dom';

/** Where the Starwake Editor lives, next to the game. */
export const EDITOR_URL = './editor.html';

/** The status line for one installed plug-in, from what this session booted with. */
export function pluginStatus(p: StoredPlugin, active: readonly string[], problems: Record<string, string[]>): string {
  const on = active.includes(p.plugin.id);
  if (p.enabled && on) return 'Active';
  if (!p.enabled && on) return 'Off: restart to unload it';
  if (!p.enabled) return 'Off';
  const own = problems[p.plugin.id];
  if (own) return `Not loaded: ${own[0]}`;
  if (problems.combined) return 'Not loaded: it clashes with another plug-in';
  return 'On: restart to load it';
}

/**
 * The Plug-ins screen (editor spec §4), from the main menu: what is installed and its state, On/Off and Remove,
 * Import plug-in (refused with its problems when it would not load), Open the Editor and Restart now.
 */
export function showPluginsScreen(ctx: UiContext, onClose: () => void, store: PluginStore = new PluginStore()): void {
  const boot = pluginBoot();
  let raw: RawGameData | null = boot?.raw ?? null;
  let changed = false;
  const list = el('div', { class: 'sw-escort-list', attrs: { 'data-testid': 'plugin-list' } });
  const status = el('p', { class: 'sw-status', attrs: { 'aria-live': 'polite', 'data-testid': 'plugin-status' } });
  const restart = button('Restart now', () => location.reload(), { class: 'sw-btn-primary' });
  restart.hidden = true;
  const say = (text: string, bad = false) => {
    status.textContent = text;
    status.classList.toggle('sw-status-bad', bad);
  };
  const baseRaw = async (): Promise<RawGameData> => (raw ??= await loadRawGameData());

  async function render(): Promise<void> {
    let installed: StoredPlugin[] = [];
    try {
      installed = await store.list();
    } catch {
      say('Plug-ins need browser storage, which is not available here (a private window?).', true);
    }
    const r = await baseRaw();
    restart.hidden = !changed;
    list.replaceChildren(
      ...(installed.length === 0
        ? [el('p', { class: 'sw-empty', text: 'No plug-ins yet. Import a .starwake.json file someone shared, or make your own in the Starwake Editor.' })]
        : installed.map((p) =>
            el('div', { class: 'sw-escort-row', attrs: { 'data-plugin': p.plugin.id } }, [
              el('span', { text: `${p.plugin.name} ${p.plugin.version}${p.plugin.author ? ` · by ${p.plugin.author}` : ''}` }),
              el('span', { class: 'sw-reason', text: [p.plugin.description, pluginSummary(r, p.plugin)].filter(Boolean).join(' — ') }),
              el('span', { class: 'sw-reason', text: pluginStatus(p, boot?.active ?? [], boot?.problems ?? {}), attrs: { 'data-testid': 'plugin-state' } }),
              button(p.enabled ? 'Turn off' : 'Turn on', () => void toggle(p)),
              button('Remove', () => void remove(p), { class: 'sw-btn-danger' }),
            ]),
          )),
    );
  }

  async function toggle(p: StoredPlugin): Promise<void> {
    await store.setEnabled(p.plugin.id, !p.enabled);
    changed = true;
    say(`${p.plugin.name} turned ${p.enabled ? 'off' : 'on'}. Restart to apply.`);
    await render();
  }

  async function remove(p: StoredPlugin): Promise<void> {
    const ok = await confirmDialog(ctx.root, {
      title: `Remove ${p.plugin.name}?`,
      message: 'Pilots who use its ships, outfits or ports will not load until it is installed again.',
      confirm: 'Remove',
      danger: true,
    });
    if (!ok) return;
    await store.remove(p.plugin.id);
    changed = true;
    say(`Removed ${p.plugin.name}. Restart to apply.`);
    await render();
  }

  const file = el('input', { class: 'sw-hidden', attrs: { type: 'file', accept: '.json,application/json', 'aria-label': 'Plug-in file', 'data-testid': 'plugin-file' } });
  file.addEventListener('change', () => {
    const f = (file as HTMLInputElement).files?.[0];
    (file as HTMLInputElement).value = '';
    if (!f) return;
    void (async () => {
      const read = readPlugin(await f.text());
      if (!read.ok) return say(`Not a Starwake plug-in: ${read.issues.slice(0, 3).join('; ')}`, true);
      const issues = checkPlugins(await baseRaw(), [read.plugin]);
      if (issues) return say(`${read.plugin.name} would not load: ${issues.slice(0, 3).join('; ')}`, true);
      await store.put(read.plugin, true);
      changed = true;
      say(`Installed ${read.plugin.name}. Restart to load it.`);
      await render();
    })().catch((err) => say(`Couldn't install it: ${err instanceof Error ? err.message : String(err)}`, true));
  });

  const close = () => {
    ctx.unmount();
    onClose();
  };
  const screen = el('div', { class: 'sw-screen sw-main-menu', attrs: { 'data-testid': 'plugins-screen' } }, [
    el('div', { class: 'sw-panel sw-menu sw-menu-wide' }, [
      el('h1', { class: 'sw-title', text: 'Plug-ins' }),
      el('p', { class: 'sw-planet-desc', text: 'Plug-ins add ships, outfits, goods, ports, encounters and stories made by other players. A plug-in that would not load is refused, so the game itself always works.' }),
      list,
      status,
      el('div', { class: 'sw-actions sw-actions-row' }, [
        button('Import plug-in', () => file.click(), { class: 'sw-btn-primary' }),
        button('Open the Editor', () => window.open(EDITOR_URL, '_blank')),
        restart,
        button('Back', close),
      ]),
      file,
    ]),
  ]);
  ctx.mount(screen, {
    groups: ['menus'],
    onPress: (pressed) => {
      if (pressed.has('back')) close();
    },
  });
  void render();
}
