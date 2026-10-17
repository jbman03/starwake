import type { Controller } from '../app/controller';
import { isFinalStep, skipLabel, type Guide } from '../guide/guide';
import type { GuideState } from '../guide/steps';
import type { ActionId } from '../input/actions';
import type { Bindings } from '../input/bindings';
import { button, confirmDialog, el, hotkeyFor } from './dom';

/** The screens the guide can tell apart (GuideState.screen minus flight and other). */
export type GuideScreen = 'planet' | 'exchange' | 'missions' | 'map';

/** Where the guide can be replayed from, for the skip and offer dialogs. */
export function replayWhere(bindings: Bindings): string {
  const k = hotkeyFor(bindings, 'howToPlay');
  return `Settings → General or How to Play${k ? ` (${k})` : ''}`;
}

/**
 * Key labels for hint text, from the player's bindings. On a planet the star map is the planet
 * group's openMap (the flight `map` key opens the Mission Computer there).
 */
export function guideKey(bindings: () => Bindings, landed: () => boolean): (action: ActionId) => string {
  return (action) => {
    const a: ActionId = action === 'map' && landed() ? 'openMap' : action;
    return hotkeyFor(bindings(), a) ?? 'unbound';
  };
}

/** The snapshot Guide.update() reads, for whatever screen (if any) is open. */
export function guideState(controller: Controller, screen: GuideScreen | 'other' | null): GuideState {
  return {
    screen: screen ?? (controller.isFlying ? 'flight' : 'other'),
    world: controller.world,
    landedPlanetId: controller.landedPlanetId,
  };
}

/**
 * Skip (asking first) or, on the final card, dismiss. Resolves true when the guide ended.
 * Never touches flight: callers in flight pause and resume around it.
 */
export async function confirmSkipGuide(parent: HTMLElement, guide: Guide, bindings: Bindings): Promise<boolean> {
  if (!guide.current()) return false;
  if (isFinalStep(guide.current())) {
    guide.skip();
    return true;
  }
  const ok = await confirmDialog(parent, {
    title: 'Skip the guide?',
    message: `You can replay it any time from ${replayWhere(bindings)}.`,
    confirm: 'Skip guide',
    cancel: 'Cancel',
  });
  if (ok) guide.skip();
  return ok;
}

/**
 * Render the guide's current hint into `container` (a callout card: step, text, Skip guide) and
 * keep it current on every guide change. Hidden while there is no hint. Returns an unsubscribe.
 */
export function mountGuideHint(container: HTMLElement, guide: Guide, opts: { onSkip: () => void }): () => void {
  container.classList.add('sw-guide');
  container.setAttribute('data-testid', 'guide-hint');
  container.setAttribute('role', 'status');
  const step = el('div', { class: 'sw-guide-step' });
  const text = el('p', { class: 'sw-guide-text', attrs: { 'data-testid': 'guide-text' } });
  const skip = button('Skip guide', () => opts.onSkip(), { class: 'sw-guide-skip' });
  skip.setAttribute('data-testid', 'guide-skip');
  container.replaceChildren(el('div', { class: 'sw-guide-body' }, [step, text]), skip);

  const render = () => {
    const c = guide.current();
    container.hidden = c === null;
    if (!c) return;
    step.textContent = isFinalStep(c) ? 'First flight · done' : `First flight · Step ${c.step} of ${c.total}`;
    text.textContent = c.text;
    skip.querySelector('.sw-btn-label')!.textContent = skipLabel(c);
  };
  render();
  return guide.on('change', render);
}

/** A hint card for a screen panel, wired to the session's guide (empty and hidden without one). */
export function guideCard(controller: Controller, parent: HTMLElement): { node: HTMLElement; dispose: () => void } {
  const node = el('div');
  node.hidden = true;
  const guide = controller.guide;
  if (!guide) return { node, dispose: () => {} };
  const dispose = mountGuideHint(node, guide, {
    onSkip: () => void confirmSkipGuide(parent, guide, controller.settings.bindings),
  });
  return { node, dispose };
}
