import { expect, test, type Page } from '@playwright/test';
import { leavePlanet, newPilot, trackErrors, waitForFlight } from './helpers';

const force = (page: Page, id: string) => page.evaluate((i) => window.__starwake!.forceEncounter(i), id);

test('desktop: hail banner, Y answers, 1 takes the passenger, Done resumes', async ({ page }) => {
  const errors = trackErrors(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  await newPilot(page);
  await leavePlanet(page);
  await force(page, 'stranded-passenger');
  await expect.poll(() => page.evaluate(() => window.__starwake!.hudHail!())).toMatch(/^Incoming hail — .+ \(Y to answer\)$/);

  await page.keyboard.press('y');
  const card = page.getByTestId('encounter-card');
  await expect(card).toBeVisible();
  expect(await page.evaluate(() => window.__starwake!.controller.isFlying)).toBe(false);

  await page.keyboard.press('1');
  await expect(page.getByTestId('encounter-outcome')).toContainText('tired passenger');
  expect(await page.evaluate(() => window.__starwake!.world().missions.length)).toBe(1);

  await card.getByRole('button', { name: /Done/ }).click();
  await expect(card).toBeHidden();
  await waitForFlight(page);
  expect(await page.evaluate(() => window.__starwake!.hudHail!())).toBeNull();
  expect(errors).toEqual([]);
});

test.describe('phone', () => {
  test.use({ hasTouch: true, viewport: { width: 844, height: 390 } });

  test('phone hail via context button', async ({ page }) => {
    test.setTimeout(60_000);
    const errors = trackErrors(page);
    await newPilot(page, 'Tap');
    await page.getByRole('button', { name: /^Leave/ }).tap();
    await waitForFlight(page);
    await page.touchscreen.tap(422, 30); // touch mode: rails on

    await force(page, 'stranded-passenger');
    const ctxBtn = page.getByTestId('context-button');
    await expect(ctxBtn).toHaveText('Answer hail');
    // The hail adds no banner over the view.
    expect(await page.evaluate(() => window.__starwake!.hudHail?.() ?? null)).toBeNull();

    await ctxBtn.tap();
    const card = page.getByTestId('encounter-card');
    await expect(card).toBeVisible();
    const inside = async () => {
      const buttons = card.getByRole('button');
      const n = await buttons.count();
      expect(n).toBeGreaterThan(0);
      for (let i = 0; i < n; i++) {
        const b = (await buttons.nth(i).boundingBox())!;
        expect(b.x).toBeGreaterThanOrEqual(0);
        expect(b.y).toBeGreaterThanOrEqual(0);
        expect(b.x + b.width).toBeLessThanOrEqual(844);
        expect(b.y + b.height).toBeLessThanOrEqual(390);
      }
    };
    await inside();

    await card.getByTestId('encounter-choice').first().tap();
    await expect(page.getByTestId('encounter-outcome')).toContainText('tired passenger');
    await inside();
    await card.getByRole('button', { name: /Done/ }).tap();
    await expect(card).toBeHidden();
    await waitForFlight(page);
    expect(await page.evaluate(() => window.__starwake!.world().missions.length)).toBe(1);
    await expect(page.locator('.sw-screen')).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('phone: Not now dismisses a hail and the context button goes back to flying actions', async ({ page }) => {
    test.setTimeout(60_000);
    const errors = trackErrors(page);
    await newPilot(page, 'Nope');
    await page.getByRole('button', { name: /^Leave/ }).tap();
    await waitForFlight(page);
    await page.touchscreen.tap(422, 30);

    await force(page, 'stranded-passenger');
    const ctxBtn = page.getByTestId('context-button');
    await expect(ctxBtn).toHaveText('Answer hail');
    await ctxBtn.tap();
    const card = page.getByTestId('encounter-card');
    await expect(card).toBeVisible();
    await card.getByRole('button', { name: /Not now/ }).tap();
    await expect(card).toBeHidden();
    await waitForFlight(page);
    expect(await page.evaluate(() => window.__starwake!.controller.pending)).toBeNull();
    await expect(ctxBtn).not.toHaveText('Answer hail');
    expect(errors).toEqual([]);
  });
});
