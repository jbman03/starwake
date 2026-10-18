import { expect, test } from '@playwright/test';
import { newPilot } from './helpers';

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
