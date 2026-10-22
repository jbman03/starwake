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
