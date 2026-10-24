import { expect, test, type Page } from '@playwright/test';
import { leavePlanet, newPilot, trackErrors, waitForFlight } from './helpers';

/** Adds fixture story missions through the dev test hook (data/story.json ships empty until the content task). */
async function injectMissions(page: Page): Promise<void> {
  await page.evaluate(() => {
    const h = window.__starwake!;
    const base = {
      arc: 'side' as const,
      giver: { name: 'Ansel Voss', title: 'Dockmaster' },
      offer: { where: 'bar' as const, ports: ['halcyon'] },
      text: 'offer',
      acceptText: 'ok',
      declinable: true,
      onComplete: [],
    };
    h.data.story['e2e-scan'] = {
      ...base,
      id: 'e2e-scan',
      title: 'The Skerry Wreck',
      steps: [
        { kind: 'scan', system: 'skerry', site: { label: 'Wreck' }, text: 'Scan the wreck.' },
        { kind: 'land', planet: 'gull-rock', text: 'Land at Gull Rock.' },
      ],
    };
    h.data.story['e2e-meet'] = {
      ...base,
      id: 'e2e-meet',
      title: 'A Word at Calder',
      steps: [
        {
          kind: 'meet',
          system: 'calder',
          ship: { name: 'Orrin Vale', shipId: 'courier', government: 'concord' },
          card: {
            title: 'Orrin Vale hails',
            text: 'A courier holds station and asks for a word.',
            choices: [{ label: 'Hear him out', outcomes: [{ type: 'message', text: 'He presses a chart into your hands.' }] }],
          },
          text: 'Meet Orrin Vale.',
        },
        { kind: 'land', planet: 'halcyon', text: 'Land at Halcyon.' },
      ],
    };
  });
}

const stepOf = (page: Page, id: string) =>
  page.evaluate((i) => window.__starwake!.story().active.find((a) => a.id === i)?.step ?? null, id);

test.describe('desktop', () => {
  test.use({ viewport: { width: 1280, height: 720 } });

  test('a scan site at Skerry: fly beside it, press Y, the next step shows', async ({ page }) => {
    const errors = trackErrors(page);
    await newPilot(page, 'Scanner');
    await injectMissions(page);
    await page.evaluate(() => {
      const h = window.__starwake!;
      if (!h.acceptStoryNow('e2e-scan').ok) throw new Error('accept refused');
      h.teleport('skerry-light');
    });
    await leavePlanet(page);
    const site = await page.evaluate(() => window.__starwake!.storySite());
    expect(site).toMatchObject({ missionId: 'e2e-scan', label: 'Wreck' });
    const d = Math.hypot(site!.pos.x, site!.pos.y);
    expect(d).toBeGreaterThanOrEqual(600);
    expect(d).toBeLessThanOrEqual(1000);
    await expect.poll(() => page.evaluate(() => window.__starwake!.siteScreenPos!() !== null)).toBe(true);

    // Out of reach: nothing happens.
    await page.keyboard.press('y');
    expect(await stepOf(page, 'e2e-scan')).toBe(0);

    // Park beside the site (the test hook is the only way to skip the flight).
    await page.evaluate((pos) => {
      const c = window.__starwake!.controller;
      c.world = { ...c.world, ship: { ...c.world.ship, pos: { x: pos.x + 10, y: pos.y }, vel: { x: 0, y: 0 } } };
    }, site!.pos);
    await page.keyboard.press('y');
    await expect.poll(() => stepOf(page, 'e2e-scan')).toBe(1);
    await expect.poll(() => page.evaluate(() => window.__starwake!.hudMessage!())).toContain('Land at Gull Rock.');
    expect(await page.evaluate(() => window.__starwake!.storySite())).toBeNull();
    expect(errors).toEqual([]);
  });

  test('M1 at Skerry: the notice, Tab to the Dead lantern, G to fly there, Y to scan it', async ({ page }) => {
    test.setTimeout(90_000);
    const errors = trackErrors(page);
    await newPilot(page, 'Lantern');
    await page.evaluate(() => {
      const h = window.__starwake!;
      if (!h.acceptStoryNow('m1-lights-out').ok) throw new Error('accept refused');
      h.teleport('skerry-light');
    });
    // Landing at the port says the site is out in space, with the bound target key.
    await expect(page.getByTestId('planet-screen')).toContainText('The Dead lantern is out in space, not at this port. Target it with Tab and fly beside it.');
    await leavePlanet(page);
    await expect.poll(() => page.evaluate(() => window.__starwake!.hudObjective!())).toMatch(/^Objective: scan the Dead lantern — out in space, \d+ px$/);

    await page.keyboard.press('Tab');
    await expect.poll(() => page.evaluate(() => window.__starwake!.controller.targetedSite()?.label ?? null)).toBe('Dead lantern');
    await expect.poll(() => page.evaluate(() => window.__starwake!.sidebar!().info.target)).toMatch(/^Dead lantern — \d+ px$/);

    await page.keyboard.press('g');
    await expect.poll(() => page.evaluate(() => window.__starwake!.hudBanner!())).toBe('Autopilot → Dead lantern');
    await page.waitForFunction(() => window.__starwake!.controller.currentContext() === 'openSite', undefined, { timeout: 60_000 });
    await page.keyboard.press('y');
    await expect.poll(() => page.evaluate(() => window.__starwake!.story().done)).toContain('m1-lights-out');
    expect(await page.evaluate(() => window.__starwake!.hudObjective!())).toBeNull();
    expect(errors).toEqual([]);
  });

  test('the objective stacks below an open hail banner without overlapping it', async ({ page }) => {
    const errors = trackErrors(page);
    await newPilot(page, 'Stacker');
    await page.evaluate(() => {
      const h = window.__starwake!;
      h.acceptStoryNow('m1-lights-out');
      h.teleport('skerry-light');
    });
    await leavePlanet(page);
    await page.evaluate(() => {
      const h = window.__starwake!;
      const hail = Object.values(h.data.encounters).find((e) => e.kind === 'hail')!;
      h.forceEncounter(hail.id);
    });
    await expect.poll(() => page.evaluate(() => window.__starwake!.hudHail!())).not.toBeNull();
    const boxes = await page.evaluate(() => window.__starwake!.hudBannerBoxes!());
    const hail = boxes.find((b) => b.name === 'hail')!;
    const obj = boxes.find((b) => b.name === 'objective')!;
    expect(hail && obj).toBeTruthy();
    expect(obj.top).toBeGreaterThanOrEqual(hail.bottom);
    expect(errors).toEqual([]);
  });

  test('a meet ship hails with a banner; Y opens its card and the choice advances the step', async ({ page }) => {
    const errors = trackErrors(page);
    await newPilot(page, 'Greeter');
    await injectMissions(page);
    await page.evaluate(() => window.__starwake!.acceptStoryNow('e2e-meet'));
    await leavePlanet(page);
    await expect.poll(() => page.evaluate(() => window.__starwake!.hudHail!())).toBe('Incoming hail — Orrin Vale (Y to answer)');
    await expect.poll(() => page.evaluate(() => window.__starwake!.traffic!().some((n) => n.label.startsWith('Orrin Vale')))).toBe(true);

    await page.keyboard.press('y');
    const card = page.getByTestId('encounter-card');
    await expect(card).toContainText('A courier holds station');
    await page.keyboard.press('1');
    await expect(page.getByTestId('encounter-outcome')).toContainText('Land at Halcyon.');
    await card.getByRole('button', { name: /Done/ }).click();
    await waitForFlight(page);
    expect(await stepOf(page, 'e2e-meet')).toBe(1);
    expect(await page.evaluate(() => window.__starwake!.storyMeet())).toBeNull();
    expect(errors).toEqual([]);
  });

  test('the M4 choice locks the other side: Concord is friend on the pilot card, Free Reach is not chosen', async ({ page }) => {
    test.setTimeout(60_000);
    const errors = trackErrors(page);
    await newPilot(page, 'Chooser');
    await page.evaluate(() => {
      const c = window.__starwake!.controller;
      // M4 at its choice (the meet step), with the lane open, as if the earlier steps were done.
      c.world = {
        ...c.world,
        flags: [...c.world.flags, 'dimming-lane'],
        story: { ...c.world.story, active: [{ id: 'm4-past-the-charts', step: 2, deadlineDay: null }] },
      };
      window.__starwake!.teleport('cairn-rest');
    });
    await leavePlanet(page);
    await expect.poll(() => page.evaluate(() => window.__starwake!.hudHail!())).toBe('Incoming hail — Bram Kettle (Y to answer)');
    await page.keyboard.press('y');
    const card = page.getByTestId('encounter-card');
    await expect(card).toContainText('Bram Kettle');
    await card.getByRole('button', { name: /Give the evidence to Corrin/ }).click();
    await expect(page.getByTestId('encounter-outcome')).toBeVisible();
    await card.getByRole('button', { name: /Done/ }).click();
    await waitForFlight(page);

    const after = await page.evaluate(() => ({ flags: window.__starwake!.world().flags, done: window.__starwake!.story().done }));
    expect(after.done).toContain('m4-past-the-charts');
    expect(after.flags).toContain('side-concord');
    expect(after.flags).not.toContain('side-reach');

    // Land to save, then quit to the main menu: the pilot card shows the standing.
    await page.evaluate(() => window.__starwake!.teleport('cairn-rest'));
    await expect(page.getByTestId('planet-screen')).toBeVisible();
    await page.getByRole('button', { name: /^Leave/ }).click();
    await waitForFlight(page);
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Quit to main menu' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Quit' }).click();
    await expect(page.getByTestId('main-menu')).toContainText('Concord: friend');
    expect(errors).toEqual([]);
  });
});

test.describe('story hulls', () => {
  test.use({ viewport: { width: 1280, height: 720 } });

  test('a Concord friend who finished the Relight arc can buy the Lantern-tender at Concordance', async ({ page }) => {
    const errors = trackErrors(page);
    await newPilot(page, 'Tender');
    await page.evaluate(() => {
      const h = window.__starwake!;
      const c = h.controller;
      c.world = {
        ...c.world,
        credits: 500_000,
        flags: [...c.world.flags, 'concord-done'],
        standing: { ...c.world.standing, concord: 'friend' },
      };
      h.teleport('concordance');
    });
    await expect(page.getByTestId('planet-screen')).toContainText('Concordance');
    await page.keyboard.press('KeyY');
    const shop = page.getByTestId('shipyard');
    await expect(shop).toBeVisible();
    const tile = shop.locator('[data-item="lantern-tender"]');
    await expect(tile).not.toContainText('???');
    await expect(tile).toContainText('Lantern-tender');
    await tile.click();
    await expect(shop.getByRole('button', { name: 'Buy', exact: true })).toBeEnabled();
    expect(errors).toEqual([]);
  });
});

test.describe('phone', () => {
  test.use({ hasTouch: true, viewport: { width: 844, height: 390 } });

  test('a meet hail is the context button only; tapping it opens the card', async ({ page }) => {
    test.setTimeout(60_000);
    const errors = trackErrors(page);
    await newPilot(page, 'Tap Greeter');
    await injectMissions(page);
    await page.evaluate(() => window.__starwake!.acceptStoryNow('e2e-meet'));
    await page.getByRole('button', { name: /^Leave/ }).tap();
    await waitForFlight(page);
    await page.touchscreen.tap(422, 30); // touch mode: rails on

    const ctxBtn = page.getByTestId('context-button');
    await expect(ctxBtn).toHaveText('Answer hail');
    expect(await page.evaluate(() => window.__starwake!.hudHail?.() ?? null)).toBeNull();
    await ctxBtn.tap();
    const card = page.getByTestId('encounter-card');
    await expect(card).toBeVisible();
    await card.getByRole('button', { name: /Hear him out/ }).tap();
    await expect(page.getByTestId('encounter-outcome')).toContainText('Land at Halcyon.');
    expect(errors).toEqual([]);
  });
  test('M1 on a phone: Fly to Dead lantern, then Scan Dead lantern, with nothing new over the view', async ({ page }) => {
    test.setTimeout(90_000);
    const errors = trackErrors(page);
    await newPilot(page, 'Tap Lantern');
    await page.evaluate(() => {
      const h = window.__starwake!;
      if (!h.acceptStoryNow('m1-lights-out').ok) throw new Error('accept refused');
      h.teleport('skerry-light');
    });
    await expect(page.getByTestId('planet-screen')).toContainText('Target it with the TGT button and fly beside it.');
    await page.getByRole('button', { name: /^Leave/ }).tap();
    await waitForFlight(page);
    await page.touchscreen.tap(422, 30); // touch mode: rails on

    const ctxBtn = page.getByTestId('context-button');
    await expect(ctxBtn).toHaveText('Fly to Dead lantern');
    const objective = page.getByTestId('rail-objective');
    await expect(objective).toBeVisible();
    await expect(objective).toHaveText(/^Scan Dead lantern · \d+ px$/);
    // Nothing but the context button may cover the clear view: the objective lives in the HUD box in the stick rail.
    const { clear, box, hud } = await page.evaluate(() => {
      const layer = document.querySelector<HTMLElement>('[data-testid="touch-rails"]')!;
      const o = document.querySelector('[data-testid="rail-objective"]')!.getBoundingClientRect();
      const h = document.querySelector('[data-control="hud"]')!.getBoundingClientRect();
      return { clear: JSON.parse(layer.dataset.clear!) as { x: number; y: number; w: number; h: number }, box: o.toJSON(), hud: h.toJSON() };
    });
    const overlaps = box.left < clear.x + clear.w && clear.x < box.right && box.top < clear.y + clear.h && clear.y < box.bottom;
    expect(overlaps).toBe(false);
    expect(box.bottom).toBeLessThanOrEqual(hud.bottom + 1);
    expect(box.top).toBeGreaterThanOrEqual(hud.top);

    await ctxBtn.tap();
    await expect(ctxBtn).toHaveText('✋ TAKE CONTROL');
    await expect(ctxBtn).toHaveText('Scan Dead lantern', { timeout: 60_000 });
    await expect(objective).toHaveText('Tap Scan');
    await ctxBtn.tap();
    await expect.poll(() => page.evaluate(() => window.__starwake!.story().done)).toContain('m1-lights-out');
    await expect(objective).toBeHidden();
    expect(errors).toEqual([]);
  });
  test('the mission log with two story missions and several jobs keeps its buttons on screen', async ({ page }) => {
    const errors = trackErrors(page);
    await newPilot(page, 'Logger');
    await injectMissions(page);
    await page.evaluate(() => {
      const h = window.__starwake!;
      h.acceptStoryNow('e2e-scan');
      h.acceptStoryNow('e2e-meet');
      const c = h.controller;
      const job = (i: number) => ({
        id: `job${i}`, typeId: 'delivery', originId: 'halcyon', destId: 'merrow', tons: 1, passengers: 0, pay: 100,
        paidUpfront: false, deadlineDay: 40, title: `Job number ${i}`, description: 'A job.', cargoName: 'rations',
      });
      c.world = { ...c.world, missions: [...c.world.missions, job(1), job(2), job(3), job(4), job(5)] };
    });
    await page.getByRole('button', { name: /^Mission Log/ }).tap();
    const log = page.getByTestId('mission-log');
    await expect(log).toBeVisible();
    await expect(log).toContainText('The Skerry Wreck');
    await expect(log).toContainText('A Word at Calder');
    const vp = page.viewportSize()!;
    const over = await page.evaluate(() => {
      const d = document.scrollingElement!;
      return { x: d.scrollWidth - window.innerWidth, y: d.scrollHeight - window.innerHeight };
    });
    expect(over.x).toBeLessThanOrEqual(0);
    expect(over.y).toBeLessThanOrEqual(0);
    const actions = log.locator('.sw-ex-actions button:visible');
    expect(await actions.count()).toBeGreaterThanOrEqual(3);
    for (let i = 0; i < (await actions.count()); i++) {
      const b = (await actions.nth(i).boundingBox())!;
      expect(b.y).toBeGreaterThanOrEqual(0);
      expect(b.y + b.height).toBeLessThanOrEqual(vp.height);
    }
    await log.getByRole('button', { name: /^Done/ }).tap();
    expect(errors).toEqual([]);
  });
});
