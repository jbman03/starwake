// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Controller } from '../app/controller';
import { loadGameData } from '../data/load';
import { loadProgress, saveProgress } from '../guide/progress';
import { pickTarget } from '../guide/target';
import { InputMode } from '../input/mode';
import { DEFAULT_SETTINGS } from '../save/settings';
import type { PilotStore } from '../save/store';
import { newWorld } from '../sim/world';
import { createUi } from './context';
import { showExchange } from './exchange';
import { mountGuideHint } from './guideHint';
import { showMissionComputer } from './missionComputer';
import { showSettings } from './settingsScreen';

let seq = 0;

async function setup(opts: { session?: boolean; mode?: 'keyboard' | 'touch' } = {}) {
  const data = await loadGameData();
  const settings = { ...DEFAULT_SETTINGS, touch: { ...DEFAULT_SETTINGS.touch } };
  const c = new Controller(data, settings, new EventTarget());
  const root = document.createElement('div');
  document.body.append(root);
  const inputMode = new InputMode(new EventTarget(), () => settings.bindings, opts.mode ?? 'keyboard');
  const ctx = createUi(root, c, {} as PilotStore, () => null, inputMode);
  const pilotId = `pilot-${++seq}`;
  const world = newWorld(data, 1);
  if (opts.session !== false) c.beginSession(world, { id: pilotId, name: 'P' }, 'halcyon');
  const hint = () => root.querySelector<HTMLElement>('[data-testid="guide-hint"]:not([hidden])');
  const btn = (label: string) =>
    [...root.querySelectorAll('button')].find((b) => (b.querySelector('.sw-btn-label')?.textContent ?? b.textContent) === label);
  return { data, c, root, ctx, pilotId, world, hint, btn };
}

/** True when `a` comes before `b` in document order. */
const before = (a: Element, b: Element) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
});

describe('guide session wiring', () => {
  it('beginSession gives the controller a guide; endSession takes it away', async () => {
    const { c } = await setup();
    expect(c.guide).not.toBeNull();
    c.endSession();
    expect(c.guide).toBeNull();
  });

  it('loading a pilot with an unfinished guide resumes it silently at the same step', async () => {
    const { data, c } = await setup({ session: false });
    const target = pickTarget(newWorld(data, 1), data, 'halcyon')!;
    saveProgress('resume-me', { step: 7, done: false, target, startCredits: 1000 });
    c.beginSession(newWorld(data, 1), { id: 'resume-me', name: 'R' }, 'halcyon');
    expect(c.guide?.current()?.step).toBe(7);
  });

  it('a fresh pilot has no guide running until it is started', async () => {
    const { c } = await setup();
    expect(c.guide?.current()).toBeNull();
  });
});

describe('guide hints in screen panels', () => {
  it('planet screen: the callout sits inside the panel, above the buttons', async () => {
    const { c, ctx, hint, root } = await setup();
    c.guide!.start();
    ctx.go.planet('halcyon');
    const h = hint()!;
    expect(h).not.toBeNull();
    expect(h.closest('.sw-planet-frame')).not.toBeNull();
    expect(h.textContent).toContain('Open the Commodity Exchange (C).');
    expect(before(h, root.querySelector('.sw-planet-frame .sw-actions')!)).toBe(true);
  });

  it('exchange: opening it advances to the Buy step, shown above the trade buttons; buying advances again', async () => {
    const { c, ctx, hint, root, btn, data } = await setup();
    c.guide!.start();
    ctx.go.planet('halcyon');
    btn('Commodity Exchange')!.click();
    const h = hint()!;
    expect(h.closest('.sw-exchange')).not.toBeNull();
    expect(h.textContent).toContain('Buy 10 t (B).');
    expect(before(h, root.querySelector('.sw-ex-actions')!)).toBe(true);
    const good = c.guide!.target()!.good;
    root.querySelector<HTMLElement>(`tr[data-good="${good}"]`)!.click();
    btn('Buy 10')!.click();
    expect(c.world.cargo[good]).toBe(10);
    vi.advanceTimersByTime(300);
    expect(hint()!.textContent).toContain('Mission Computer (M)');
    expect(data.commodities[good]).toBeDefined();
  });

  it('mission computer: the hint sits above Accept/Done; closing it advances', async () => {
    const { c, ctx, hint, root, data } = await setup();
    const target = pickTarget(newWorld(data, 1), data, 'halcyon')!;
    saveProgress(c.pilot!.id, { step: 3, done: false, target, startCredits: 1000 });
    c.guide!.start();
    showMissionComputer(ctx, 'halcyon', () => ctx.go.planet('halcyon'));
    const h = hint()!;
    expect(h.closest('.sw-mc')).not.toBeNull();
    expect(h.textContent).toContain('Jobs pay when you land');
    expect(before(h, root.querySelector('.sw-mc .sw-ex-actions')!)).toBe(true);
    ctx.unmount();
    expect(c.guide!.current()?.step).toBe(5);
  });

  it('star map: the hint sits in the side column above its buttons', async () => {
    const { c, ctx, hint, root, data } = await setup();
    const target = pickTarget(newWorld(data, 1), data, 'halcyon')!;
    saveProgress(c.pilot!.id, { step: 7, done: false, target, startCredits: 1000 });
    c.guide!.start();
    ctx.go.map({ onClose: () => ctx.go.planet('halcyon') });
    const h = hint()!;
    expect(h.closest('.sw-starmap-side')).not.toBeNull();
    expect(h.textContent).toContain(`set a course to ${data.systems[target.system].name}`);
    expect(before(h, root.querySelector('.sw-starmap-side .sw-actions')!)).toBe(true);
  });

  it('no hint is shown when the guide is not running', async () => {
    const { ctx, hint } = await setup();
    ctx.go.planet('halcyon');
    expect(hint()).toBeNull();
    showExchange(ctx, 'halcyon', () => {});
    expect(hint()).toBeNull();
  });
});

describe('skip and replay', () => {
  it('Skip guide asks to confirm: Cancel keeps it, Skip guide ends it for good', async () => {
    const { c, ctx, hint, root, pilotId } = await setup();
    c.guide!.start();
    ctx.go.planet('halcyon');
    const skip = () => hint()!.querySelector<HTMLButtonElement>('[data-testid="guide-skip"]')!;
    expect(skip().textContent).toBe('Skip guide');
    skip().click();
    const dialog = root.querySelector('[role="dialog"]')!;
    expect(dialog.textContent).toContain('Skip the guide?');
    [...dialog.querySelectorAll('button')].find((b) => b.textContent === 'Cancel')!.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(c.guide!.current()?.step).toBe(1);
    skip().click();
    const again = root.querySelector('[role="dialog"]')!;
    [...again.querySelectorAll('button')].find((b) => b.textContent === 'Skip guide')!.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(c.guide!.current()).toBeNull();
    expect(hint()).toBeNull();
    expect(loadProgress(pilotId)?.done).toBe(true);
  });

  it('the final card is dismissed without a confirm', async () => {
    const { c, ctx, hint, root, data } = await setup();
    const target = pickTarget(newWorld(data, 1), data, 'halcyon')!;
    saveProgress(c.pilot!.id, { step: 11, done: false, target, startCredits: 1000, profit: 420 });
    c.guide!.start();
    ctx.go.planet('halcyon');
    expect(hint()!.textContent).toContain('Nice trade! You made 420 cr.');
    const dismiss = hint()!.querySelector<HTMLButtonElement>('[data-testid="guide-skip"]')!;
    expect(dismiss.textContent).toBe('Dismiss');
    dismiss.click();
    expect(root.querySelector('[role="dialog"]')).toBeNull();
    expect(c.guide!.current()).toBeNull();
  });

  it('a skip asked for in flight pauses, confirms, then resumes flight', async () => {
    const { c, root } = await setup();
    c.guide!.start();
    c.leavePlanet();
    expect(c.isFlying).toBe(true);
    c.requestGuideSkip();
    expect(c.isFlying).toBe(false);
    const dialog = root.querySelector('[role="dialog"]')!;
    [...dialog.querySelectorAll('button')].find((b) => b.textContent === 'Skip guide')!.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(c.guide!.current()).toBeNull();
    expect(c.isFlying).toBe(true);
  });

  it('Settings → General → Replay first flight restarts the guide from step 1', async () => {
    const { c, ctx, data, btn, root } = await setup();
    const target = pickTarget(newWorld(data, 1), data, 'halcyon')!;
    saveProgress(c.pilot!.id, { step: 9, done: false, target, startCredits: 1000 }); // mid-guide: replay must not resume it
    showSettings(ctx, { mode: 'keyboard' });
    btn('General')!.click();
    const replay = btn('Replay first flight')!;
    expect(replay.disabled).toBe(false);
    replay.click();
    expect(c.guide!.current()?.step).toBe(1);
    expect(loadProgress(c.pilot!.id)).toMatchObject({ step: 1, done: false });
    expect(root.textContent).toContain('The guide starts again');
  });

  it('Replay first flight is disabled with a reason when no pilot is loaded', async () => {
    const { ctx, btn, root } = await setup({ session: false });
    showSettings(ctx, { mode: 'keyboard' });
    btn('General')!.click();
    expect(btn('Replay first flight')!.disabled).toBe(true);
    expect(root.textContent).toContain('Load a pilot first');
  });
});

describe('mountGuideHint', () => {
  it('follows the guide: text on change, hidden when finished, Skip calls onSkip', async () => {
    const { c } = await setup();
    const box = document.createElement('div');
    const onSkip = vi.fn();
    const dispose = mountGuideHint(box, c.guide!, { onSkip });
    expect(box.hidden).toBe(true);
    c.guide!.start();
    expect(box.hidden).toBe(false);
    expect(box.querySelector('[data-testid="guide-text"]')!.textContent).toContain('Commodity Exchange');
    expect(box.textContent).toContain('Step 1 of 11');
    box.querySelector<HTMLButtonElement>('[data-testid="guide-skip"]')!.click();
    expect(onSkip).toHaveBeenCalledTimes(1);
    c.guide!.skip();
    expect(box.hidden).toBe(true);
    dispose();
    c.guide!.restart();
    expect(box.hidden).toBe(true); // no longer listening
  });
});
