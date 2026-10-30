import type { Settings } from '../save/settings';
import type { UiContext } from './context';
import { button, el } from './dom';
import { createHotkeyEditor } from './hotkeyEditor';

export type SettingsMode = 'keyboard' | 'touch';
type TabId = 'controls' | 'touch' | 'general';

let uid = 0;

function segmented<T extends string>(
  label: string,
  options: { value: T; text: string }[],
  get: () => T,
  set: (v: T) => void,
): HTMLElement {
  const group = el('div', { class: 'sw-segmented', attrs: { role: 'group', 'aria-label': label } });
  const paint = () =>
    group.replaceChildren(
      ...options.map((o) => {
        const b = button(o.text, () => {
          set(o.value);
          paint();
        });
        b.setAttribute('aria-pressed', String(get() === o.value));
        return b;
      }),
    );
  paint();
  return el('div', { class: 'sw-field' }, [el('div', { class: 'sw-field-label', text: label }), group]);
}

function toggle(label: string, get: () => boolean, set: (v: boolean) => void): HTMLElement {
  const id = `sw-toggle-${++uid}`;
  const input = el('input', { class: 'sw-check', attrs: { type: 'checkbox', id } });
  input.checked = get();
  input.addEventListener('change', () => set(input.checked));
  return el('label', { class: 'sw-field sw-toggle', attrs: { for: id } }, [input, el('span', { text: label })]);
}

function slider(label: string, min: number, max: number, get: () => number, set: (v: number) => void): HTMLElement {
  const id = `sw-range-${++uid}`;
  const out = el('span', { class: 'sw-range-value' });
  const input = el('input', { class: 'sw-range', attrs: { type: 'range', id, min: String(min), max: String(max), step: '1' } });
  input.value = String(Math.round(get() * 100));
  const show = () => (out.textContent = `${input.value}%`);
  show();
  input.addEventListener('input', () => {
    show();
    set(Number(input.value) / 100);
  });
  return el('div', { class: 'sw-field' }, [
    el('label', { class: 'sw-field-label', text: label, attrs: { for: id } }),
    el('div', { class: 'sw-range-row' }, [input, out]),
  ]);
}

/** Settings → General → Replay first flight: restarts the guide for the loaded pilot. */
function replayField(ctx: UiContext): HTMLElement {
  const guide = ctx.controller.guide;
  const note = el('p', { class: 'sw-reason', attrs: { 'aria-live': 'polite' } });
  const replay = button(
    'Replay first flight',
    () => {
      const g = ctx.controller.guide;
      note.textContent = g?.restart()
        ? `The guide starts again at step ${g.current()?.step ?? 1}. Its hints appear on your screens and in flight.`
        : 'The guide has no trade to show from here.';
    },
    { disabled: !guide },
  );
  if (!guide) note.textContent = 'Load a pilot first';
  return el('div', { class: 'sw-field' }, [el('div', { class: 'sw-field-label', text: 'First flight guide' }), replay, note]);
}

/** Settings: Controls (keyboard mode), Touch (touch mode) and General. Every change is saved at once. */
export function showSettings(ctx: UiContext, opts: { mode: SettingsMode; onClose?: () => void }): void {
  const { controller } = ctx;
  const s: Settings = controller.settings;
  const persist = () => controller.settingsChanged();
  const close = opts.onClose ?? (() => ctx.unmount());

  const editor = opts.mode === 'keyboard' ? createHotkeyEditor(ctx) : null;

  const panels: Record<TabId, HTMLElement | null> = {
    controls: editor?.node ?? null,
    touch:
      opts.mode === 'touch'
        ? el('div', { class: 'sw-tab-body' }, [
            toggle('Mirror layout (left-handed)', () => s.touch.mirror, (v) => ((s.touch.mirror = v), persist())),
            segmented('Button size', [
              { value: 'S', text: 'S' },
              { value: 'M', text: 'M' },
              { value: 'L', text: 'L' },
            ], () => s.touch.buttonSize, (v) => ((s.touch.buttonSize = v), persist())),
            slider('Button opacity', 30, 100, () => s.touch.opacity, (v) => ((s.touch.opacity = v), persist())),
            segmented('Steering', [
              { value: 'point', text: 'Point to steer' },
              { value: 'classic', text: 'Classic' },
            ], () => s.touch.steering, (v) => ((s.touch.steering = v), persist())),
            toggle('Vibration', () => s.touch.vibration, (v) => ((s.touch.vibration = v), persist())),
          ])
        : null,
    general: el('div', { class: 'sw-tab-body' }, [
      slider('Music', 0, 100, () => s.musicVolume, (v) => ((s.musicVolume = v), persist())),
      slider('Effects', 0, 100, () => s.sfxVolume, (v) => ((s.sfxVolume = v), persist())),
      toggle('Mute sound (V)', () => s.muted, (v) => ((s.muted = v), persist())),
      segmented('Graphics quality (applies after restart)', [
        { value: 'low', text: 'Low' },
        { value: 'high', text: 'High' },
      ], () => s.quality, (v) => ((s.quality = v), persist())),
      toggle('Auto-land on arrival', () => s.autoLandOnArrival, (v) => ((s.autoLandOnArrival = v), persist())),
      replayField(ctx),
    ]),
  };

  const tabs: { id: TabId; text: string }[] = [
    { id: 'controls', text: 'Controls' },
    { id: 'touch', text: 'Touch' },
    { id: 'general', text: 'General' },
  ];
  const visible = tabs.filter((t) => panels[t.id]);
  let active: TabId = opts.mode === 'touch' ? 'touch' : 'controls';

  const tabBar = el('div', { class: 'sw-tabs', attrs: { role: 'tablist' } });
  const body = el('div', { class: 'sw-tab-panel', attrs: { role: 'tabpanel' } });
  const paint = () => {
    tabBar.replaceChildren(
      ...visible.map((t) =>
        el('button', {
          class: `sw-btn sw-tab${t.id === active ? ' sw-tab-active' : ''}`,
          text: t.text,
          attrs: { type: 'button', role: 'tab', 'aria-selected': String(t.id === active) },
          onClick: () => {
            active = t.id;
            paint();
          },
        }),
      ),
    );
    body.replaceChildren(panels[active]!);
  };
  paint();

  const screen = el('div', { class: 'sw-screen sw-overlay', attrs: { 'data-testid': 'settings-screen' } }, [
    el('div', { class: 'sw-panel sw-menu sw-menu-wide sw-settings' }, [
      el('h1', { class: 'sw-title', text: 'Settings' }),
      tabBar,
      body,
      el('div', { class: 'sw-actions' }, [button('Back', close, { class: 'sw-btn-primary' })]),
    ]),
  ]);

  ctx.mount(screen, {
    groups: ['menus'],
    onPress: (pressed) => {
      if (pressed.has('back')) close();
    },
    cleanup: () => editor?.dispose(),
  });
}
