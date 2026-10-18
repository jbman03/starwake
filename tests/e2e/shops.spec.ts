import { expect, test, type Page } from '@playwright/test';
import { newPilot, trackErrors } from './helpers';

/** Start a pilot with plenty of credits, docked at Dunmore Crossing (shipyard and outfitter). */
async function pilotAtDunmore(page: Page, name: string): Promise<void> {
  await newPilot(page, name);
  await page.evaluate(() => {
    const h = window.__starwake!;
    h.controller.world = { ...h.controller.world, credits: 500_000 };
    h.teleport('dunmore-crossing');
  });
  await expect(page.getByTestId('planet-screen')).toContainText('Dunmore Crossing');
}

const cargoFreeOf = async (page: Page): Promise<number> => {
  const text = await page.getByTestId('planet-screen').textContent();
  return Number(/Cargo: (\d+)\//.exec(text ?? '')![1]);
};

test.describe('desktop', () => {
  test.use({ viewport: { width: 1280, height: 720 } });

  test('buy a cargo pod at the outfitter: the badge shows 1 and free cargo grows by 5', async ({ page }) => {
    const errors = trackErrors(page);
    await pilotAtDunmore(page, 'Podder');
    const before = await cargoFreeOf(page);
    await page.keyboard.press('KeyO');
    const shop = page.getByTestId('outfitter');
    await expect(shop).toBeVisible();
    const tile = shop.locator('[data-item="cargo-pod"]');
    await tile.click();
    await page.keyboard.press('KeyB');
    await expect(tile.locator('.sw-shop-badge')).toHaveText('1');
    await page.keyboard.press('Escape');
    await expect(shop).toBeHidden();
    expect(await cargoFreeOf(page)).toBe(before + 5);
    expect(errors).toEqual([]);
  });

  test('buy the mule at the shipyard: the planet screen shows /60 t', async ({ page }) => {
    const errors = trackErrors(page);
    await pilotAtDunmore(page, 'Hauler');
    await page.keyboard.press('KeyY');
    const shop = page.getByTestId('shipyard');
    await expect(shop).toBeVisible();
    await shop.locator('[data-item="mule"]').click();
    await page.keyboard.press('KeyB');
    await page.getByRole('button', { name: 'Buy ship' }).click();
    await expect(shop.locator('[data-item="mule"] .sw-shop-badge')).toHaveText('Yours');
    await page.keyboard.press('Escape');
    await expect(shop).toBeHidden();
    await expect(page.getByTestId('planet-screen')).toContainText('/60 t');
    expect(errors).toEqual([]);
  });
});

test.describe('phone (touch, landscape)', () => {
  test.use({ hasTouch: true, viewport: { width: 844, height: 390 } });

  test('the outfitter grid and Buy button are fully on-screen at 844×390', async ({ page }) => {
    const errors = trackErrors(page);
    await pilotAtDunmore(page, 'Pocket');
    await page.getByRole('button', { name: /^Outfitter/ }).tap();
    const shop = page.getByTestId('outfitter');
    await expect(shop).toBeVisible();
    const vp = page.viewportSize()!;
    const inside = async (loc: ReturnType<Page['locator']>, what: string) => {
      const b = (await loc.boundingBox())!;
      expect(b, what).not.toBeNull();
      expect(b.x, `${what} left`).toBeGreaterThanOrEqual(0);
      expect(b.y, `${what} top`).toBeGreaterThanOrEqual(0);
      expect(b.x + b.width, `${what} right`).toBeLessThanOrEqual(vp.width);
      expect(b.y + b.height, `${what} bottom`).toBeLessThanOrEqual(vp.height);
    };
    await inside(shop.locator('.sw-shop-grid'), 'grid');
    const tiles = shop.locator('.sw-shop-tile');
    for (let i = 0; i < (await tiles.count()); i++) await inside(tiles.nth(i), `tile ${i}`);
    await inside(shop.getByRole('button', { name: 'Buy' }), 'Buy button');
    expect(errors).toEqual([]);
  });
});
