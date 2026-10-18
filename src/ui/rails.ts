import './rails.css';
import type { Controller } from '../app/controller';
import type { GameData } from '../data/schemas';
import type { ActionId } from '../input/actions';
import type { InputMode } from '../input/mode';
import { getInsets } from '../input/insets';
import { computeLayout, railMetrics, stickFromOffset, type Insets, type Layout, type Rect } from '../input/touch';
import { hudInfo, routeBannerText } from '../render/hudInfo';
import { radarBlips } from '../render/sidebarInfo';
import type { ContextAction } from '../sim/context';
import { jumpDestination, pickLandTarget } from '../sim/rules';
import type { WorldState } from '../sim/types';
import { el } from './dom';
import { isFinalStep, skipLabel } from '../guide/guide';

/** Opacity of Fire, Missile and the stick while the autopilot flies. */
export const AUTOPILOT_DIM = 0.2;
/** World distance shown from the radar's center to its edge. */

/** Text for the bottom-center context button, or null when it should be hidden. */
export function contextLabel(action: ContextAction, world: WorldState, data: GameData): string | null {
  switch (action) {
    case 'land': {
      const id = pickLandTarget(world, data, false);
      return id ? `⬇ LAND ON ${data.planets[id].name.toUpperCase()}` : null;
    }
    case 'plotCourse':
      return '🗺 PLOT COURSE';
    case 'autopilotOut':
      return '⇱ AUTOPILOT TO JUMP POINT';
    case 'jump': {
      const id = jumpDestination(world, data);
      return id ? `JUMP TO ${(data.systems[id]?.name ?? id).toUpperCase()}` : null;
    }
    case 'takeControl':
      return '✋ TAKE CONTROL';
    case 'tow':
      return `CALL TOW (${data.config.towFee} cr)`;
    default:
      return null;
  }
}

export interface RailsOptions {
  /** Element the rail layer is appended to (a full-screen layer above the canvas). */
  parent: HTMLElement;
  controller: Controller;
  inputMode: InputMode;
  /** Screen size; defaults to the window. */
  size?: () => { w: number; h: number };
  /** Safe-area insets; defaults to the measured ones. */
  insets?: () => Insets;
  /** Run update() every animation frame (default true). Tests call update() themselves. */
  autoUpdate?: boolean;
}

export interface Rails {
  element: HTMLElement;
  /** Re-read mode, settings, size and world state and redraw. Called every frame. */
  update(): void;
  dispose(): void;
}

const px = (n: number) => `${n}px`;
const placeRect = (node: HTMLElement, r: Rect) => {
  node.style.left = px(r.x);
  node.style.top = px(r.y);
  node.style.width = px(r.w);
  node.style.height = px(r.h);
};
/**
 * Place a rail at its layout rect. The inset on the rail's screen edge is already part of the
 * rect (the view starts beyond it); it is padded inward so controls stay clear of the notch.
 */
const placeRail = (node: HTMLElement, r: Rect, layout: Layout, pad: number) => {
  const { insets } = layout;
  const atRight = r.x > 0;
  placeRect(node, r);
  node.style.padding = `${pad + insets.top}px ${pad + (atRight ? insets.right : 0)}px ${pad + insets.bottom}px ${pad + (atRight ? 0 : insets.left)}px`;
};
const square = (node: HTMLElement, size: number) => {
  node.style.width = px(size);
  node.style.height = px(size);
};

/**
 * Phone controls: two side rails (stick rail: HUD, Pause, Stop, joystick; button rail: Map, radar
 * → map, Target, Missile, [Thrust], Fire) and a bottom-center context button. Shown only in
 * touch mode during a session. Every control stays inside its rail; only the layer's rails and
 * the context button take pointer events, so taps on the view reach the game.
 */
export function mountRails(opts: RailsOptions): Rails {
  const { controller, inputMode } = opts;
  const { touch } = controller;
  const size = opts.size ?? (() => ({ w: window.innerWidth, h: window.innerHeight }));

  /** A button that holds `action` down while a finger is on it. */
  const holdButton = (control: string, text: string, action: ActionId, label: string, extra = '') => {
    const b = el('button', {
      class: `sw-rail-btn ${extra}`.trim(),
      text,
      attrs: { type: 'button', 'aria-label': label, 'data-rail-control': '', 'data-control': control },
    });
    const up = () => touch.release(action);
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      capture(b, e);
      touch.press(action);
    });
    b.addEventListener('pointerup', up);
    b.addEventListener('pointercancel', up);
    b.addEventListener('lostpointercapture', up);
    return b;
  };

  // ---- stick rail ----------------------------------------------------------
  const sysName = el('span', { class: 'sw-rail-sys' });
  const fuel = el('div', { class: 'sw-rail-line' });
  const credits = el('div', { class: 'sw-rail-line sw-rail-dim', attrs: { 'data-testid': 'rail-credits' } });
  const cargo = el('div', { class: 'sw-rail-line sw-rail-dim', attrs: { 'data-testid': 'rail-cargo' } });
  const target = el('div', { class: 'sw-rail-line sw-rail-dim' });
  const course = el('div', { class: 'sw-rail-line sw-rail-course', attrs: { 'data-testid': 'rail-course' } });
  course.hidden = true;
  const pause = holdButton('pause', 'II', 'pause', 'Pause', 'sw-rail-pause');
  const bar = (name: string, cls: string) =>
    el('div', { class: 'sw-rail-bar' }, [el('span', { text: name }), el('i', { class: cls })]);
  const hud = el('div', { class: 'sw-rail-hud', attrs: { 'data-rail-control': '', 'data-control': 'hud' } }, [
    el('div', { class: 'sw-rail-hud-top' }, [sysName, pause]),
    bar('Shields', 'sw-bar-shield'),
    bar('Armor', 'sw-bar-armor'),
    fuel,
    credits,
    cargo,
    target,
    course,
  ]);
  // Pause sits inside the HUD box; it is checked through the HUD's box, so it isn't listed twice.
  pause.removeAttribute('data-rail-control');
  const stop = holdButton('stop', 'STOP', 'autoStop', 'Auto-stop');
  // First Flight guide: its hint under the HUD and Skip guide beside Stop, only while it runs.
  const guideText = el('div', {
    class: 'sw-rail-guide',
    attrs: { 'data-testid': 'rail-guide', role: 'status', 'data-rail-control': '', 'data-control': 'guide-hint' },
  });
  guideText.hidden = true;
  const guideSkip = el('button', {
    class: 'sw-rail-btn sw-rail-skip',
    text: 'Skip guide',
    attrs: { type: 'button', 'data-rail-control': '', 'data-control': 'guide-skip' },
  }) as HTMLButtonElement;
  guideSkip.hidden = true;
  // A click (finger lifted on it), not pointerdown: Stop is 4 px away, and a thumb sliding off cancels.
  guideSkip.addEventListener('click', (e) => {
    e.preventDefault();
    controller.requestGuideSkip();
  });
  const spacer = el('div', { class: 'sw-rail-spacer' });
  const knob = el('div', { class: 'sw-stick-knob' });
  const stick = el(
    'div',
    { class: 'sw-stick', attrs: { role: 'slider', 'aria-label': 'Steering stick', 'data-rail-control': '', 'data-control': 'stick' } },
    [knob],
  );
  const stickRail = el('div', { class: 'sw-rail', attrs: { 'data-rail': 'stick' } }, [
    hud,
    guideText,
    spacer,
    el('div', { class: 'sw-rail-row' }, [stop, guideSkip]),
    stick,
  ]);

  // ---- button rail ---------------------------------------------------------
  const radarCanvas = el('canvas', { class: 'sw-radar-canvas' }) as HTMLCanvasElement;
  const radar = el(
    'button',
    { class: 'sw-rail-btn sw-radar', attrs: { type: 'button', 'aria-label': 'Star map', 'data-rail-control': '', 'data-control': 'radar' } },
    [radarCanvas],
  );
  radar.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    touch.press('map');
    touch.release('map');
  });
  // The labelled Map button: always shown (the radar hides on tight screens), same press as the radar.
  const mapBtn = el('button', {
    class: 'sw-rail-btn sw-rail-map',
    text: 'Map',
    attrs: { type: 'button', 'aria-label': 'Star map', 'data-rail-control': '', 'data-control': 'map' },
  });
  mapBtn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    touch.press('map');
    touch.release('map');
  });
  const targetBtn = holdButton('target', 'TGT', 'nextTarget', 'Next target');
  const missile = holdButton('missile', 'MSL', 'fireSecondary', 'Fire missile');
  const thrust = holdButton('thrust', 'THR', 'thrust', 'Thrust');
  const fire = holdButton('fire', 'FIRE', 'firePrimary', 'Fire', 'sw-rail-fire');
  const buttonSpacer = el('div', { class: 'sw-rail-spacer' });
  const buttonRail = el('div', { class: 'sw-rail', attrs: { 'data-rail': 'buttons' } }, [
    mapBtn,
    radar,
    buttonSpacer,
    targetBtn,
    missile,
    thrust,
    fire,
  ]);

  // ---- context button ------------------------------------------------------
  const contextBtn = el('button', {
    class: 'sw-context',
    attrs: { type: 'button', 'data-testid': 'context-button' },
  }) as HTMLButtonElement;
  contextBtn.hidden = true;
  contextBtn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    controller.doContextAction();
  });

  // ---- autopilot route banner (top-center of the clear region) -------------
  const banner = el('div', { class: 'sw-route-banner', attrs: { 'data-testid': 'route-banner', role: 'status' } });
  banner.hidden = true;

  const layer = el('div', { class: 'sw-touch', attrs: { 'data-testid': 'touch-rails' } }, [stickRail, buttonRail, contextBtn, banner]);
  layer.hidden = true;
  layer.addEventListener('contextmenu', (e) => e.preventDefault());
  opts.parent.append(layer);

  // ---- joystick ------------------------------------------------------------
  let stickPointer: number | null = null;
  const moveStick = (e: PointerEvent) => {
    const r = stick.getBoundingClientRect();
    const radius = r.width / 2;
    const s = stickFromOffset(e.clientX - (r.left + radius), e.clientY - (r.top + radius), radius);
    touch.setStick(s.angle, s.magnitude);
    const k = s.magnitude * radius;
    knob.style.transform = `translate(${Math.cos(s.angle) * k}px, ${Math.sin(s.angle) * k}px)`;
  };
  const endStick = () => {
    stickPointer = null;
    touch.clearStick();
    knob.style.transform = '';
  };
  stick.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    stickPointer = e.pointerId;
    capture(stick, e);
    moveStick(e);
  });
  stick.addEventListener('pointermove', (e) => {
    if (e.pointerId === stickPointer) moveStick(e);
  });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) {
    stick.addEventListener(type, (e) => {
      if (e.pointerId === stickPointer) endStick();
    });
  }

  // ---- per-frame update ----------------------------------------------------
  let shown = false;
  let lastKey = '';
  let lastLabel: string | null = null;
  let lastRoute: string | null = null;
  let lastHint: string | null = null;

  const applyLayout = (w: number, h: number, layout: Layout, hintOn: boolean) => {
    const s = controller.settings.touch;
    const key = `${w}x${h}|${JSON.stringify(layout.insets)}|${s.mirror}|${s.buttonSize}|${s.steering}|${hintOn}`;
    if (key === lastKey) return;
    lastKey = key;
    const m = railMetrics(layout, s, s.steering, hintOn);
    layer.dataset.size = `${w}x${h}`;
    layer.dataset.view = JSON.stringify(layout.view);
    layer.dataset.clear = JSON.stringify(layout.clear);
    layer.classList.toggle('sw-touch-overlay', layout.overlayRails);
    placeRail(stickRail, layout.leftRail, layout, m.pad);
    placeRail(buttonRail, layout.rightRail, layout, m.pad);
    for (const rail of [stickRail, buttonRail]) rail.style.gap = px(m.gap);
    // The spacer is flexible room, not an item: cancel the extra gap the flex layout gives it.
    for (const sp of [spacer, buttonSpacer]) sp.style.marginTop = px(-m.gap);
    hud.style.height = px(m.hud);
    guideText.style.height = px(m.hint);
    guideText.hidden = !hintOn;
    guideSkip.hidden = !hintOn;
    if (hintOn) square(guideSkip, m.skip);
    square(stop, m.stop);
    for (const b of [targetBtn, missile, thrust]) square(b, m.button);
    square(fire, m.fire);
    square(stick, m.stick);
    mapBtn.style.height = px(m.map);
    mapBtn.style.width = px(m.fire); // as wide as Fire, which always fits the rail
    square(radar, m.radar);
    radar.hidden = m.radar < 24;
    radarCanvas.width = Math.max(1, Math.round(m.radar));
    radarCanvas.height = radarCanvas.width;
    thrust.hidden = s.steering !== 'classic';
    if (thrust.hidden) touch.release('thrust');
    // Bottom-center of the view.
    contextBtn.style.left = px(layout.view.x + layout.view.w / 2);
    contextBtn.style.bottom = px(h - (layout.view.y + layout.view.h) + 12 + layout.insets.bottom);
    contextBtn.style.maxWidth = px(Math.max(0, layout.clear.w - 16));
    // Top-center of the view, kept inside the clear region so it never covers a rail.
    banner.style.left = px(layout.clear.x + layout.clear.w / 2);
    banner.style.top = px(Math.max(layout.view.y, layout.clear.y) + 8 + layout.insets.top);
    banner.style.maxWidth = px(Math.max(0, layout.clear.w - 16));
  };

  const update = () => {
    const visible = inputMode.mode === 'touch' && controller.pilot !== null;
    if (!visible) {
      if (shown) {
        touch.releaseAll();
        endStick();
      }
      shown = false;
      layer.hidden = true;
      return;
    }
    shown = true;
    layer.hidden = false;
    const { w, h } = size();
    // The final card belongs to the screens it is reached on; the rail shows steps 1–10 only.
    const current = controller.guide?.current() ?? null;
    const hint = isFinalStep(current) ? null : current;
    applyLayout(w, h, computeLayout(w, h, controller.settings.touch, (opts.insets ?? getInsets)()), hint !== null);
    if ((hint?.text ?? null) !== lastHint) {
      lastHint = hint?.text ?? null;
      guideText.textContent = lastHint ?? '';
      guideText.title = lastHint ?? '';
      guideSkip.textContent = skipLabel(hint);
    }
    layer.style.setProperty('--sw-touch-opacity', String(controller.settings.touch.opacity));

    const { world, data } = controller;
    const autopilot = world.assist.kind === 'autopilot';
    for (const node of [fire, missile, stick]) node.style.opacity = autopilot ? String(AUTOPILOT_DIM) : '';

    const info = hudInfo(world, data);
    sysName.textContent = info.system;
    fuel.textContent = info.fuel;
    fuel.style.color = info.fuelColor;
    credits.textContent = info.credits;
    cargo.textContent = info.cargo;
    target.textContent = info.target;
    course.textContent = info.nextHop ?? '';
    course.hidden = info.nextHop === null;

    const label = controller.isFlying ? contextLabel(controller.currentContext(), world, data) : null;
    if (label !== lastLabel) {
      lastLabel = label;
      contextBtn.textContent = label ?? '';
      contextBtn.hidden = label === null;
    }

    const route = controller.isFlying ? routeBannerText(world, data) : null;
    if (route !== lastRoute) {
      lastRoute = route;
      banner.textContent = route ?? '';
      banner.hidden = route === null;
    }

    if (!radar.hidden) drawRadar(radarCanvas, world, data);
  };

  let raf = 0;
  if (opts.autoUpdate !== false) {
    const loop = () => {
      update();
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
  }

  return {
    element: layer,
    update,
    dispose() {
      cancelAnimationFrame(raf);
      touch.releaseAll();
      layer.remove();
    },
  };
}

/** Keep receiving a finger's events after it slides off the control. */
function capture(node: HTMLElement, e: PointerEvent): void {
  try {
    if (e.pointerId !== undefined) node.setPointerCapture(e.pointerId);
  } catch {
    // Synthetic events (tests) have no active pointer to capture.
  }
}

/** Tiny radar: the ship at the center, planets as dots (the target in green), north up. */
function drawRadar(canvas: HTMLCanvasElement, world: WorldState, data: GameData): void {
  const g = canvas.getContext('2d');
  if (!g) return;
  const s = canvas.width;
  const m = s / 2;
  g.clearRect(0, 0, s, s);
  g.strokeStyle = 'rgba(127,178,255,0.35)';
  g.beginPath();
  g.arc(m, m, m - 1, 0, Math.PI * 2);
  g.stroke();
  for (const b of radarBlips(world, data, m - 4)) {
    if (b.kind !== 'planet' && b.kind !== 'target') continue;
    g.fillStyle = b.kind === 'target' ? '#6fe36f' : '#9fb4cc';
    g.beginPath();
    g.arc(m + b.x, m + b.y, 2.5, 0, Math.PI * 2);
    g.fill();
  }
  g.fillStyle = '#ffffff';
  g.fillRect(m - 1.5, m - 1.5, 3, 3);
}
