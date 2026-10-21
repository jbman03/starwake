import { expect, test } from '@playwright/test';
import { newPilot, waitForFlight } from './helpers';

test('PC sidebar shows on a wide window, narrows the view, and its Map button opens the map', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await newPilot(page);
  await page.keyboard.press('l');
  await expect.poll(() => page.evaluate(() => window.__starwake!.sidebar?.().visible)).toBe(true);
  expect(await page.evaluate(() => window.__starwake!.cameraViewport!())).toEqual({ x: 0, y: 0, w: 1080, h: 800 });
  expect(await page.evaluate(() => window.__starwake!.sidebar!().info.nav)).toBe('No course');
  await page.mouse.click(1180, 773);
  await expect(page.getByText('Star map', { exact: false }).first()).toBeVisible();
});

test('the sidebar is hidden on a narrow window', async ({ page }) => {
  await page.setViewportSize({ width: 600, height: 800 });
  await newPilot(page);
  await page.keyboard.press('l');
  await expect.poll(() => page.evaluate(() => window.__starwake!.sidebar?.().visible)).toBe(false);
  expect((await page.evaluate(() => window.__starwake!.cameraViewport!())).w).toBe(600);
});

test.describe('touch mode', () => {
  test.use({ hasTouch: true, viewport: { width: 1280, height: 800 } });

  test('the sidebar is not shown in touch mode, even on a wide window', async ({ page }) => {
    await newPilot(page);
    await page.getByRole('button', { name: /^Leave/ }).tap();
    await waitForFlight(page);
    await page.touchscreen.tap(640, 30);
    await expect(page.getByTestId('touch-rails')).toBeVisible();
    await expect.poll(() => page.evaluate(() => window.__starwake!.sidebar?.().visible)).toBe(false);
  });
});
