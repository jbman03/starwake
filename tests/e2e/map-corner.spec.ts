import { expect, test, type Page } from '@playwright/test';
import { newPilot, trackErrors } from './helpers';

/** The corner Map button must stay small and clear of the screen's heading (title or planet name). */
async function checkCorner(page: Page, headingSel: string): Promise<void> {
  const geo = await page.evaluate((sel) => {
    const b = document.querySelector('.sw-map-corner')!.getBoundingClientRect();
    const hs = [...document.querySelectorAll(sel)].map((h) => {
      const range = document.createRange();
      range.selectNodeContents(h);
      return range.getBoundingClientRect();
    });
    const hit = hs.some((r) => r.left < b.right && r.right > b.left && r.top < b.bottom && r.bottom > b.top);
    return { w: b.width, hit, n: hs.length };
  }, headingSel);
  expect(geo.n).toBeGreaterThan(0);
  expect(geo.w).toBeLessThan(140);
  expect(geo.hit).toBe(false);
  // Phone-size screens have no keyboard: the corner button shows no key chip.
  const short = page.viewportSize()!.height <= 500;
  await (short ? expect(page.locator('.sw-map-corner .sw-key')).toBeHidden() : expect(page.locator('.sw-map-corner .sw-key')).toBeVisible());
}

for (const vp of [
  { width: 1280, height: 720 },
  { width: 844, height: 390 },
]) {
  test.describe(`${vp.width}x${vp.height}`, () => {
    test.use({ viewport: vp, hasTouch: vp.width < 1000 });

    test('corner Map button is compact and clear of headings on every landed screen', async ({ page }) => {
      const errors = trackErrors(page);
      await newPilot(page, 'Corner');
      await page.evaluate(() => {
        const h = window.__starwake!;
        h.controller.world = { ...h.controller.world, credits: 500_000 };
        h.teleport('dunmore-crossing');
      });
      const screen = page.getByTestId('planet-screen');
      await expect(screen).toContainText('Dunmore Crossing');
      await checkCorner(page, '.sw-planet-name');

      for (const [btn, id] of [
        ['Shipyard', 'shipyard'],
        ['Outfitter', 'outfitter'],
      ] as const) {
        await page.getByRole('button', { name: new RegExp(`^${btn}`) }).click();
        await expect(page.getByTestId(id)).toBeVisible();
        await checkCorner(page, '.sw-title');
        await page.keyboard.press('Escape');
        await expect(page.getByTestId(id)).toBeHidden();
      }

      for (const [btn, id] of [
        ['Commodity Exchange', 'exchange'],
        ['Mission Computer', 'mission-computer'],
      ] as const) {
        await page.getByRole('button', { name: new RegExp(`^${btn}`) }).click();
        await expect(page.getByTestId(id)).toBeVisible();
        await checkCorner(page, '.sw-title');
        await page.keyboard.press('Escape');
        await expect(page.getByTestId(id)).toBeHidden();
      }
      expect(errors).toEqual([]);
    });
  });
}
