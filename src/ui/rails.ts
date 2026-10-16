import './rails.css';
import type { Controller } from '../app/controller';
import type { GameData } from '../data/schemas';
import type { ActionId } from '../input/actions';
import type { InputMode } from '../input/mode';
import { computeLayout, railMetrics, stickFromOffset, type Layout, type Rect } from '../input/touch';
import { hudInfo } from '../render/hudInfo';
import type { ContextAction } from '../sim/context';
import { jumpDestination, pickLandTarget } from '../sim/rules';
import type { WorldState } from '../sim/types';
import { el } from './dom';

/** Opacity of Fire, Missile and the stick while the autopilot flies. */
export const AUTOPILOT_DIM = 0.2;
/** World distance shown from the radar's center to its edge. */
const RADAR_RANGE = 2500;

/** Text for the bottom-center context button, or null when it should be hidden. */
export function contextLabel(action: ContextAction, world: WorldState, data: GameData): string | null {
  switch (action) {
    case 'land': {
      const id = pickLandTarget(world, data, false);
      return id ? `⬇ LAND ON ${data.planets[id].name.toUpperCase()}` : null;
    }
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
 * Place a rail. The rail touching a screen edge grows by that edge's safe-area inset (phone
 * notch, rounded corners) and pads its content by the same amount, so controls are never clipped.
 */
const placeRail = (node: HTMLElement, r: Rect, screenW: number, pad: number) => {
  const atRight = r.x > 0 && r.x + r.w >= screenW;
  const inset = `env(safe-area-inset-${atRight ? 'right' : 'left'}, 0px)`;
  node.style.left = px(r.x);
  node.style.top = px(r.y);
  node.style.height = px(r.h);
  node.style.width = `calc(${px(r.w)} + ${inset})`;
  // The right rail grows leftwards (it can't grow past the screen edge).
  node.style.marginLeft = atRight ? `calc(-1 * ${inset})` : '';
  const p = px(pad);
  node.style.padding =
    `calc(${p} + env(safe-area-inset-top, 0px)) ` +
    `calc(${p} + ${atRight ? inset : '0px'}) ` +
    `calc(${p} + env(safe-area-inset-bottom, 0px)) ` +
    `calc(${p} + ${atRight ? '0px' : inset})`;
};
const square = (node: HTMLElement, size: number) => {
  node.style.width = px(size);
  node.style.height = px(size);
};

/**
 * Phone controls: two side rails (stick rail: HUD, Pause, Stop, joystick; button rail: radar
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
  const target = el('div', { class: 'sw-rail-line sw-rail-dim' });
  const pause = holdButton('pause', 'II', 'pause', 'Pause', 'sw-rail-pause');
  const bar = (name: string, cls: string) =>
    el('div', { class: 'sw-rail-bar' }, [el('span', { text: name }), el('i', { class: cls })]);
  const hud = el('div', { class: 'sw-rail-hud', attrs: { 'data-rail-control': '', 'data-control': 'hud' } }, [
    el('div', { class: 'sw-rail-hud-top' }, [sysName, pause]),
    bar('Shields', 'sw-bar-shield'),
    bar('Armor', 'sw-bar-armor'),
    fuel,
    target,
  ]);
  // Pause sits inside the HUD box; it is checked through the HUD's box, so it isn't listed twice.
  pause.removeAttribute('data-rail-control');
  const stop = holdButton('stop', 'STOP', 'autoStop', 'Auto-stop');
  const knob = el('div', { class: 'sw-stick-knob' });
  const stick = el(
    'div',
    { class: 'sw-stick', attrs: { role: 'slider', 'aria-label': 'Steering stick', 'data-rail-control': '', 'data-control': 'stick' } },
    [knob],
  );
  const stickRail = el('div', { class: 'sw-rail', attrs: { 'data-rail': 'stick' } }, [
    hud,
    el('div', { class: 'sw-rail-spacer' }),
    stop,
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
  const targetBtn = holdButton('target', 'TGT', 'nextTarget', 'Next target');
  const missile = holdButton('missile', 'MSL', 'fireSecondary', 'Fire missile');
  const thrust = holdButton('thrust', 'THR', 'thrust', 'Thrust');
  const fire = holdButton('fire', 'FIRE', 'firePrimary', 'Fire', 'sw-rail-fire');
  const buttonRail = el('div', { class: 'sw-rail', attrs: { 'data-rail': 'buttons' } }, [
    radar,
    el('div', { class: 'sw-rail-spacer' }),
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

  const layer = el('div', { class: 'sw-touch', attrs: { 'data-testid': 'touch-rails' } }, [stickRail, buttonRail, contextBtn]);
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

  const applyLayout = (w: number, h: number, layout: Layout) => {
    const s = controller.settings.touch;
    const key = `${w}x${h}|${s.mirror}|${s.buttonSize}|${s.steering}`;
    if (key === lastKey) return;
    lastKey = key;
    const m = railMetrics(layout, s, s.steering);
    layer.dataset.size = `${w}x${h}`;
    layer.dataset.view = JSON.stringify(layout.view);
    layer.dataset.clear = JSON.stringify(layout.clear);
    layer.classList.toggle('sw-touch-overlay', layout.overlayRails);
    placeRail(stickRail, layout.leftRail, w, m.pad);
    placeRail(buttonRail, layout.rightRail, w, m.pad);
    for (const rail of [stickRail, buttonRail]) rail.style.gap = px(m.gap);
    hud.style.height = px(m.hud);
    for (const b of [stop, targetBtn, missile, thrust]) square(b, m.button);
    square(fire, m.fire);
    square(stick, m.stick);
    square(radar, m.radar);
    radar.hidden = m.radar < 24;
    radarCanvas.width = Math.max(1, Math.round(m.radar));
    radarCanvas.height = radarCanvas.width;
    thrust.hidden = s.steering !== 'classic';
    if (thrust.hidden) touch.release('thrust');
    // Bottom-center of the view.
    contextBtn.style.left = px(layout.view.x + layout.view.w / 2);
    contextBtn.style.bottom = `calc(${px(h - (layout.view.y + layout.view.h) + 12)} + env(safe-area-inset-bottom, 0px))`;
    contextBtn.style.maxWidth = px(Math.max(0, layout.clear.w - 16));
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
    applyLayout(w, h, computeLayout(w, h, controller.settings.touch));
    layer.style.setProperty('--sw-touch-opacity', String(controller.settings.touch.opacity));

    const { world, data } = controller;
    const autopilot = world.assist.kind === 'autopilot';
    for (const node of [fire, missile, stick]) node.style.opacity = autopilot ? String(AUTOPILOT_DIM) : '';

    const info = hudInfo(world, data);
    sysName.textContent = info.system;
    fuel.textContent = info.fuel;
    fuel.style.color = info.fuelColor;
    target.textContent = info.target;

    const label = controller.isFlying ? contextLabel(controller.currentContext(), world, data) : null;
    if (label !== lastLabel) {
      lastLabel = label;
      contextBtn.textContent = label ?? '';
      contextBtn.hidden = label === null;
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
  const k = (m - 4) / RADAR_RANGE;
  for (const p of Object.values(data.planets)) {
    if (p.systemId !== world.systemId) continue;
    let dx = (p.pos.x - world.ship.pos.x) * k;
    let dy = (p.pos.y - world.ship.pos.y) * k;
    const d = Math.hypot(dx, dy);
    if (d > m - 4) {
      dx *= (m - 4) / d;
      dy *= (m - 4) / d;
    }
    g.fillStyle = p.id === world.targetPlanetId ? '#6fe36f' : '#9fb4cc';
    g.beginPath();
    g.arc(m + dx, m + dy, 2.5, 0, Math.PI * 2);
    g.fill();
  }
  g.fillStyle = '#ffffff';
  g.fillRect(m - 1.5, m - 1.5, 3, 3);
}
