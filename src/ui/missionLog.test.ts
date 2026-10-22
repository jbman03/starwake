// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { Controller } from '../app/controller';
import { loadGameData } from '../data/load';
import type { StoryMissionDef } from '../data/schemas';
import { InputMode } from '../input/mode';
import { DEFAULT_SETTINGS } from '../save/settings';
import type { PilotStore } from '../save/store';
import { acceptStory, advanceStory } from '../sim/storyMissions';
import { newWorld } from '../sim/world';
import type { UiContext } from './context';
import { showMissionLog } from './missionLog';

const mk = (over: Partial<StoryMissionDef> & Pick<StoryMissionDef, 'id' | 'steps'>): StoryMissionDef => ({
  arc: 'side',
  title: `Title ${over.id}`,
  giver: { name: 'Ansel Voss', title: 'Dockmaster' },
  offer: { where: 'bar', ports: ['halcyon'] },
  text: 'offer',
  acceptText: 'ok',
  declinable: true,
  onComplete: [],
  ...over,
});
const main = mk({ id: 'm1', arc: 'main', title: 'Past the Charts', steps: [{ kind: 'go', system: 'tessaly', text: 'Fly to Tessaly.' }] });
const side = mk({
  id: 's1',
  title: 'Rations Run',
  steps: [{ kind: 'deliver', planet: 'merrow', cargo: { name: 'rations', tons: 2 }, deadlineDays: 6, text: 'Bring the rations to Merrow.' }],
});
const hidden = mk({ id: 'h1', title: 'Quiet Water', steps: [{ kind: 'go', system: 'hushwater', text: 'Find the quiet water.' }] });

let cleanup: (() => void) | undefined;
type MapCall = { preview?: { systemId: string; label: string }; onClose?: () => void };

async function setup(defs: StoryMissionDef[], active: string[] = [], patch: (w: ReturnType<typeof newWorld>) => ReturnType<typeof newWorld> = (w) => w) {
  const real = await loadGameData();
  const data = { ...real, story: Object.fromEntries(defs.map((d) => [d.id, d])) };
  const c = new Controller(data, DEFAULT_SETTINGS, new EventTarget());
  let w = { ...newWorld(data, 1), credits: 5000 };
  for (const id of active) w = acceptStory(w, data, id);
  c.beginSession(patch(w), { id: 'p', name: 'P' }, 'halcyon');
  const root = document.createElement('div');
  document.body.append(root);
  const maps: MapCall[] = [];
  const ctx = {
    root,
    controller: c,
    store: {} as PilotStore,
    inputMode: new InputMode(new EventTarget(), () => DEFAULT_SETTINGS.bindings, 'keyboard'),
    planetImage: () => null,
    mount: (node: HTMLElement, opts: { cleanup?: () => void } = {}) => {
      cleanup?.(); // like the real mount: the previous screen's listeners go
      cleanup = opts.cleanup;
      root.replaceChildren(node);
    },
    unmount: () => root.replaceChildren(),
    go: { mainMenu() {}, planet() {}, pause() {}, map: (o: MapCall = {}) => maps.push(o) },
  } as unknown as UiContext;
  const story = () => root.querySelector<HTMLElement>('[data-testid="log-story"]');
  const item = (id: string) => root.querySelector<HTMLElement>(`[data-story="${id}"]`);
  const btn = (label: string, within: ParentNode = root) =>
    [...within.querySelectorAll('button')].find((b) => b.querySelector('.sw-btn-label')?.textContent === label);
  return { data, c, root, ctx, maps, story, item, btn };
}

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
  document.body.replaceChildren();
});

describe('mission log: Story section', () => {
  it('shows title, giver, step text, destination and deadline for an active mission', async () => {
    const { ctx, item, data } = await setup([side], ['s1']);
    showMissionLog(ctx, () => {});
    const t = item('s1')!.textContent!;
    expect(t).toContain('Rations Run');
    expect(t).toContain('from Ansel Voss');
    expect(t).toContain('Bring the rations to Merrow.');
    expect(t).toContain(`Merrow, ${data.systems[data.planets.merrow.systemId].name} system`);
    expect(t).toContain('6 days left');
  });

  it('sits above the Jobs list and omits a deadline the step does not have', async () => {
    const { ctx, root, item } = await setup([main], ['m1']);
    showMissionLog(ctx, () => {});
    const story = root.querySelector('[data-testid="log-story"]')!;
    const list = root.querySelector('[data-testid="log-list"]')!;
    expect(story.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(item('m1')!.textContent).toContain('Fly to Tessaly.');
    expect(item('m1')!.textContent).not.toContain('Deadline');
  });

  it('Show on map previews the destination system and returns to the log', async () => {
    const { ctx, item, btn, maps, data } = await setup([side], ['s1']);
    showMissionLog(ctx, () => {});
    btn('Show on map', item('s1')!)!.click();
    expect(maps).toHaveLength(1);
    expect(maps[0].preview).toEqual({ systemId: data.planets.merrow.systemId, label: 'Story: Rations Run' });
    maps[0].onClose!();
    expect(item('s1')).not.toBeNull();
  });

  it('a destination in a system the pilot cannot see yet has no map preview', async () => {
    const { ctx, item, btn } = await setup([hidden], ['h1']);
    showMissionLog(ctx, () => {});
    expect(btn('Show on map', item('h1')!)!.disabled).toBe(true);
    expect(item('h1')!.textContent).not.toContain('Hushwater');
  });

  it('Next lead shows only when nothing is active', async () => {
    const a = await setup([side]);
    showMissionLog(a.ctx, () => {});
    expect(a.story()!.textContent).toContain('Next lead');
    expect(a.story()!.textContent).toContain('Ansel Voss');
    const b = await setup([side], ['s1']);
    showMissionLog(b.ctx, () => {});
    expect(b.story()!.textContent).not.toContain('Next lead');
  });

  it('Abandon is offered for side missions only, asks first, and drops the mission', async () => {
    const { ctx, c, item, btn, root } = await setup([main, side], ['m1', 's1']);
    showMissionLog(ctx, () => {});
    expect(btn('Abandon', item('m1')!)).toBeUndefined();
    btn('Abandon', item('s1')!)!.click();
    root.querySelector<HTMLButtonElement>('.sw-dialog .sw-btn-danger')!.click();
    await new Promise((r) => setTimeout(r, 0));
    expect(c.world.story.active.map((a) => a.id)).toEqual(['m1']);
    expect(item('s1')).toBeNull();
    expect(c.world.story.failed).toEqual([]);
  });

  it('Done lists finished missions with their day', async () => {
    const { ctx, story } = await setup([main, side], [], (w) => ({ ...w, story: { ...w.story, done: ['s1', 'm1'], doneDays: { s1: 12 } } }));
    showMissionLog(ctx, () => {});
    const t = story()!.textContent!;
    expect(t).toContain('Done');
    expect(t).toContain('Rations Run');
    expect(t).toContain('13 Mar 3207'); // day 12 from the 1 Mar start
    expect(t).toContain('Past the Charts');
  });

  it('a mission completed through play records its day', async () => {
    const { ctx, c, story } = await setup([side], ['s1']);
    c.world = advanceStory({ ...c.world, day: 4 }, c.data, { kind: 'landed', planetId: 'merrow' }).world;
    showMissionLog(ctx, () => {});
    expect(story()!.textContent).toContain('5 Mar 3207');
  });

  it('has no Story section when there is nothing to show', async () => {
    const { ctx, story } = await setup([]);
    showMissionLog(ctx, () => {});
    expect(story()!.hidden).toBe(true);
  });
});

describe('mission log: scrolling and labels', () => {
  const press = (code: string) => {
    const e = new KeyboardEvent('keydown', { code, bubbles: true, cancelable: true });
    window.dispatchEvent(e);
    return e;
  };

  it('story buttons have distinct accessible names', async () => {
    const { ctx, item } = await setup([main, side], ['m1', 's1']);
    showMissionLog(ctx, () => {});
    const labels = [...item('s1')!.querySelectorAll('button')].map((b) => b.getAttribute('aria-label'));
    expect(labels).toEqual(['Show Rations Run on map', 'Abandon Rations Run']);
    expect(item('m1')!.querySelector('button')!.getAttribute('aria-label')).toBe('Show Past the Charts on map');
  });

  it('one scroll area is focusable; arrows scroll it when focused and are free when there are no jobs', async () => {
    const { ctx, root } = await setup([side], ['s1'], (w) => ({
      ...w,
      missions: [{ id: 'j1', typeId: 'delivery', originId: 'halcyon', destId: 'merrow', tons: 1, passengers: 0, pay: 1, paidUpfront: false, deadlineDay: null, title: 'J', description: 'd', cargoName: 'c' }],
    }));
    showMissionLog(ctx, () => {});
    const scroll = root.querySelector<HTMLElement>('[data-testid="log-scroll"]')!;
    expect(scroll.tabIndex).toBe(0);
    expect(scroll.contains(root.querySelector('[data-testid="log-story"]'))).toBe(true);
    expect(scroll.contains(root.querySelector('[data-testid="log-list"]'))).toBe(true);
    expect(press('ArrowDown').defaultPrevented).toBe(true); // moves the job selection
    scroll.focus();
    expect(press('ArrowDown').defaultPrevented).toBe(false); // lets the area scroll
  });

  it('arrows are not swallowed with no jobs', async () => {
    const { ctx } = await setup([side], ['s1']);
    showMissionLog(ctx, () => {});
    expect(press('ArrowDown').defaultPrevented).toBe(false);
  });

  it('the jobs empty text yields to "No jobs." when story missions are active', async () => {
    const { ctx, root } = await setup([side], ['s1']);
    showMissionLog(ctx, () => {});
    expect(root.querySelector('[data-testid="log-list"]')!.textContent).toBe('No jobs.');
  });
});
