import { expect, test, type Page } from '@playwright/test';
import { newPilot, trackErrors } from './helpers';

const SHOT = '.superpowers/sdd/2026-10-16-starwake-cycle1-trade-missions/task-11-missions.png';

/** Nothing scrolls sideways, and every visible button and list row is a ≥ 44px target inside the viewport. */
async function checkFits(page: Page, testid: string, buttonCount: number): Promise<void> {
  const overflow = await page.evaluate((id) => {
    const node = document.querySelector<HTMLElement>(`[data-testid="${id}"]`)!;
    const doc = document.scrollingElement!;
    return { doc: doc.scrollWidth - window.innerWidth, node: node.scrollWidth - node.clientWidth };
  }, testid);
  expect(overflow.doc).toBeLessThanOrEqual(0);
  expect(overflow.node).toBeLessThanOrEqual(0);
  const targets = page.getByTestId(testid).locator('button:visible, .sw-mc-row');
  const n = await targets.count();
  expect(n).toBeGreaterThanOrEqual(buttonCount);
  const vp = page.viewportSize()!;
  for (let i = 0; i < n; i++) {
    const b = (await targets.nth(i).boundingBox())!;
    const name = await targets.nth(i).textContent();
    expect(b.height, `${name} height`).toBeGreaterThanOrEqual(44);
    expect(b.width, `${name} width`).toBeGreaterThanOrEqual(44);
    expect(b.x + b.width, `${name} right edge`).toBeLessThanOrEqual(vp.width);
  }
  // The action buttons (not the scrolling list) are on screen.
  const buttons = page.getByTestId(testid).locator('button:visible');
  for (let i = 0; i < (await buttons.count()); i++) {
    const b = (await buttons.nth(i).boundingBox())!;
    expect(b.y + b.height, `${await buttons.nth(i).textContent()} bottom edge`).toBeLessThanOrEqual(vp.height);
  }
}

/** Advance the date until Halcyon posts a Cargo delivery (always one jump away); returns its offer id. */
async function findDelivery(page: Page): Promise<string> {
  return page.evaluate(() => {
    const h = window.__starwake!;
    for (let i = 0; i < 100; i++) {
      const o = h.controller.offers().find((x) => x.typeId === 'delivery' && !x.paidUpfront);
      if (o) return o.offerId;
      h.controller.world = { ...h.controller.world, day: h.controller.world.day + 1 };
    }
    throw new Error('no delivery offer found');
  });
}

test.describe('desktop', () => {
  test.use({ viewport: { width: 1280, height: 720 } });

  test('accept a delivery at Halcyon, fly to its port, and the completion dialog pays out', async ({ page }) => {
    test.setTimeout(90_000);
    const errors = trackErrors(page);
    await newPilot(page, 'Courier');
    const offerId = await findDelivery(page);
    const offer = await page.evaluate((id) => {
      const o = window.__starwake!.controller.offers().find((x) => x.offerId === id)!;
      const d = window.__starwake!.data;
      return { title: o.title, pay: o.pay, tons: o.tons, destId: o.destId, destSystem: d.planets[o.destId].systemId };
    }, offerId);
    expect(offer.destSystem).not.toBe('calder');

    await page.keyboard.press('KeyM');
    const mc = page.getByTestId('mission-computer');
    await expect(mc).toBeVisible();
    expect(await mc.locator('.sw-mc-row').count()).toBeGreaterThanOrEqual(3);
    await mc.locator(`[data-offer="${offerId}"]`).click();
    await expect(mc.getByTestId('mc-detail')).toContainText(offer.title);
    await page.screenshot({ path: SHOT });

    const credits0 = await page.evaluate(() => window.__starwake!.world().credits);
    await page.keyboard.press('Enter'); // accept
    await expect(mc.getByTestId('mc-message')).toContainText('Accepted');
    await expect(mc.locator(`[data-offer="${offerId}"]`)).toHaveCount(0);
    expect(await page.evaluate(() => window.__starwake!.world().missions.length)).toBe(1);
    expect(await page.evaluate(() => window.__starwake!.world().cargo)).toEqual({}); // job cargo is not trade cargo

    await page.keyboard.press('Escape');
    await expect(mc).toBeHidden();
    await expect(page.getByTestId('planet-screen')).toBeVisible();

    // K: the log lists it; Show on map selects the destination system; closing the map returns to the log.
    await page.keyboard.press('KeyK');
    const log = page.getByTestId('mission-log');
    await expect(log).toBeVisible();
    await expect(log.getByTestId('log-detail')).toContainText(offer.title);
    await expect(log.getByTestId('log-detail')).toContainText('days left');
    await log.getByRole('button', { name: /^Show on map/ }).click();
    const map = page.getByTestId('star-map');
    await expect(map).toBeVisible();
    await expect(map.locator(`[data-system="${offer.destSystem}"].sw-map-selected`)).toHaveCount(1);
    await map.getByRole('button', { name: /^Close/ }).click();
    await expect(log).toBeVisible();
    await page.keyboard.press('KeyK');
    await expect(log).toBeHidden();

    // Leave; K in flight pauses and shows the log, Esc resumes.
    await page.keyboard.press('KeyL');
    await page.waitForFunction(() => window.__starwake!.controller.isFlying);
    await page.waitForTimeout(100);
    await page.keyboard.press('KeyK');
    await expect(log).toBeVisible();
    expect(await page.evaluate(() => window.__starwake!.controller.isFlying)).toBe(false);
    await page.keyboard.press('Escape');
    await expect(log).toBeHidden();
    await page.waitForFunction(() => window.__starwake!.controller.isFlying);

    // Course to the destination system, autopilot out, jump.
    expect(await page.evaluate((s) => window.__starwake!.controller.plotRoute(s).ok, offer.destSystem)).toBe(true);
    await page.waitForTimeout(100);
    await page.keyboard.press('KeyG');
    await page.waitForFunction(() => window.__starwake!.world().assist.kind === 'autopilot');
    await page.waitForFunction(() => window.__starwake!.world().assist.kind === 'none', null, { timeout: 30_000 });
    await page.keyboard.press('KeyJ');
    await page.waitForFunction((s) => window.__starwake!.world().systemId === s, offer.destSystem, { timeout: 10_000 });

    // Land at the destination port (tap-style: autopilots there and lands).
    await page.evaluate((id) => window.__starwake!.controller.tapPlanet(id, 'touch'), offer.destId);
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 40_000 });
    await expect(dialog).toContainText(`Mission complete: ${offer.title}`);
    await expect(dialog).toContainText(`Paid ${offer.pay.toLocaleString('en-US')} cr.`);
    const w = await page.evaluate(() => window.__starwake!.world());
    expect(w.credits).toBe(credits0 + offer.pay);
    expect(w.missions).toEqual([]);
    await dialog.getByRole('button', { name: 'OK' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByTestId('planet-screen')).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('the pause menu has a Mission Log button', async ({ page }) => {
    const errors = trackErrors(page);
    await newPilot(page, 'Pause');
    await page.keyboard.press('KeyL');
    await page.waitForFunction(() => window.__starwake!.controller.isFlying);
    await page.waitForTimeout(100);
    await page.keyboard.press('Escape');
    await page.getByTestId('pause-menu').getByRole('button', { name: /^Mission Log/ }).click();
    const log = page.getByTestId('mission-log');
    await expect(log).toBeVisible();
    await expect(log).toContainText('No active missions.');
    await log.getByRole('button', { name: /^Done/ }).click();
    await expect(page.getByTestId('pause-menu')).toBeVisible();
    expect(errors).toEqual([]);
  });
});

test.describe('phone (touch, landscape)', () => {
  test.use({ hasTouch: true, viewport: { width: 844, height: 390 } });

  test('the mission computer and log fit 844×390 with 44px targets; the rail HUD shows credits and cargo inside the rail', async ({
    page,
  }) => {
    const errors = trackErrors(page);
    await newPilot(page, 'Pocket');
    const offerId = await findDelivery(page);

    await page.getByRole('button', { name: /^Mission Computer/ }).tap();
    const mc = page.getByTestId('mission-computer');
    await expect(mc).toBeVisible();
    await checkFits(page, 'mission-computer', 2 + 3); // Accept, Done + at least three job rows
    await mc.locator(`[data-offer="${offerId}"]`).tap();
    await mc.getByRole('button', { name: /^Accept Mission/ }).tap();
    await expect(mc.getByTestId('mc-message')).toContainText('Accepted');
    await checkFits(page, 'mission-computer', 2 + 2);
    await mc.getByRole('button', { name: /^Done/ }).tap();

    await page.getByRole('button', { name: /^Mission Log/ }).tap();
    const log = page.getByTestId('mission-log');
    await expect(log).toBeVisible();
    await checkFits(page, 'mission-log', 3 + 1); // Show on map, Abandon, Done + the job row
    await log.getByRole('button', { name: /^Done/ }).tap();

    await page.getByRole('button', { name: /^Leave/ }).tap();
    await page.waitForFunction(() => window.__starwake!.controller.isFlying);
    await page.touchscreen.tap(422, 30);
    const rails = page.getByTestId('touch-rails');
    await expect(rails).toBeVisible();
    await expect(page.getByTestId('rail-credits')).toContainText('Credits:');
    await expect(page.getByTestId('rail-cargo')).toContainText('Cargo:');
    const rail = (await rails.locator('[data-rail="stick"]').boundingBox())!;
    for (const id of ['rail-credits', 'rail-cargo']) {
      const b = (await page.getByTestId(id).boundingBox())!;
      expect(b.x).toBeGreaterThanOrEqual(rail.x);
      expect(b.x + b.width).toBeLessThanOrEqual(rail.x + rail.width + 0.5);
      expect(b.y + b.height).toBeLessThanOrEqual(rail.y + rail.height + 0.5);
    }
    expect(errors).toEqual([]);
  });
});
