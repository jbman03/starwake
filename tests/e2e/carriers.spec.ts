import { expect, test, type Page } from '@playwright/test';
import { guardPlayer, leavePlanet, newPilot, quietSky, trackErrors, waitForFlight } from './helpers';

// Carriers and fighters (cycle 6 part 2B). Test hooks set the scene (a Bastion, credits, a landing at Vanterre);
// the bay and fighters are bought, launched and recalled with real key presses and taps. Waits are state-based.

/** Test-only: a bare Bastion with 1 000 000 credits, landed at Vanterre (a Concord hub). */
async function bastionAtVanterre(page: Page): Promise<void> {
  await page.evaluate(() => {
    const h = window.__starwake!;
    h.controller.world = { ...h.controller.world, shipId: 'bastion', outfits: {}, credits: 1_000_000, crew: 60 };
    h.teleport('vanterre');
  });
  await expect(page.getByTestId('planet-screen')).toContainText('Vanterre');
}

/** Buy a Hornet Bay and four Wasps with the real outfitter keys. */
async function fitFighters(page: Page): Promise<void> {
  await page.keyboard.press('KeyO');
  const shop = page.getByTestId('outfitter');
  await expect(shop).toBeVisible();
  const bay = shop.locator('[data-item="fighter-bay"]');
  // The grid is paged: turn pages with the real Next button until the bay shows.
  for (let i = 0; i < 4 && (await bay.count()) === 0; i++) await shop.getByRole('button', { name: /^Next/ }).click();
  await bay.click();
  await page.keyboard.press('KeyB');
  await expect(bay.locator('.sw-shop-badge')).toHaveText('1');
  const wasp = shop.locator('[data-item="wasp-fighter"]');
  for (let i = 0; i < 4 && (await wasp.count()) === 0; i++) await shop.getByRole('button', { name: /^Next/ }).click();
  await wasp.click();
  for (let i = 1; i <= 4; i++) {
    await page.keyboard.press('KeyB');
    await expect(wasp.locator('.sw-shop-badge')).toHaveText(String(i));
  }
  await page.keyboard.press('Escape');
  await expect(shop).toBeHidden();
}

const fighters = (page: Page) => page.evaluate(() => window.__starwake!.controller.fighterCount());

test.describe('desktop', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('buy a bay and four Wasps; U launches them, U recalls them and they dock', async ({ page }) => {
    test.setTimeout(120_000);
    const errors = trackErrors(page);
    await newPilot(page, 'Deckhand', false, true);
    await bastionAtVanterre(page);
    await fitFighters(page);
    await leavePlanet(page);
    await quietSky(page);
    await guardPlayer(page);
    expect(await fighters(page)).toEqual({ docked: 4, out: 0 });

    await page.keyboard.press('KeyU');
    await expect.poll(() => fighters(page), { timeout: 20_000 }).toEqual({ docked: 0, out: 4 });
    await page.keyboard.press('KeyU');
    await expect.poll(() => fighters(page), { timeout: 30_000 }).toEqual({ docked: 4, out: 0 });
    expect(errors).toEqual([]);
  });

  test('fighters out in space dock by themselves when the pilot lands', async ({ page }) => {
    test.setTimeout(120_000);
    const errors = trackErrors(page);
    await newPilot(page, 'Flightdeck', false, true);
    await bastionAtVanterre(page);
    await fitFighters(page);
    await leavePlanet(page);
    await quietSky(page);
    await page.keyboard.press('KeyU');
    await expect.poll(() => fighters(page).then((f) => f.out), { timeout: 20_000 }).toBe(4);
    // Park on Vanterre and land.
    await page.evaluate(() => {
      const h = window.__starwake!;
      const c = h.controller;
      c.world = { ...c.world, targetPlanetId: 'vanterre', ship: { ...c.world.ship, pos: { ...h.data.planets.vanterre.pos }, vel: { x: 0, y: 0 } } };
    });
    await page.keyboard.press('KeyL');
    await expect(page.getByTestId('planet-screen')).toContainText('Vanterre');
    expect((await page.evaluate(() => window.__starwake!.world())).outfits['wasp-fighter']).toBe(4);
    expect(errors).toEqual([]);
  });
});

test.describe('phone', () => {
  test.use({ hasTouch: true, viewport: { width: 844, height: 390 } });

  test('the LAUNCH button shows with a bay and fighters, and a tap launches them', async ({ page }) => {
    test.setTimeout(120_000);
    const errors = trackErrors(page);
    await newPilot(page, 'Pocket Deck', false, true);
    await page.evaluate(() => {
      const h = window.__starwake!;
      h.controller.world = { ...h.controller.world, shipId: 'bastion', outfits: { 'fighter-bay': 1, 'wasp-fighter': 4 }, crew: 60 };
      h.teleport('vanterre');
    });
    await expect(page.getByTestId('planet-screen')).toContainText('Vanterre');
    await page.getByRole('button', { name: /^Leave/ }).tap();
    await waitForFlight(page);
    await page.touchscreen.tap(422, 30); // touch mode: rails on
    await expect(page.getByTestId('touch-rails')).toBeVisible();
    await quietSky(page);
    const launch = page.locator('[data-control="launch"]');
    await expect(launch).toBeVisible();
    await launch.dispatchEvent('pointerdown', { pointerType: 'touch', isPrimary: true });
    await launch.dispatchEvent('pointerup', { pointerType: 'touch', isPrimary: true });
    await expect.poll(() => fighters(page).then((f) => f.out), { timeout: 20_000 }).toBe(4);
    // With fighters out, ORDER shares the row with LAUNCH.
    await expect(page.locator('[data-control="order"]')).toBeVisible();
    expect(errors).toEqual([]);
  });
});
