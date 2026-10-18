import { expect, test, type Page } from '@playwright/test';
import { newPilot, trackErrors } from './helpers';

const SHOT = '.superpowers/sdd/2026-10-16-starwake-cycle1-trade-missions/task-10-exchange.png';

/** Nothing scrolls sideways, and every visible exchange button is a ≥ 44px target inside the viewport. */
async function checkFits(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => {
    const ex = document.querySelector<HTMLElement>('[data-testid="exchange"]')!;
    const doc = document.scrollingElement!;
    return { doc: doc.scrollWidth - window.innerWidth, ex: ex.scrollWidth - ex.clientWidth };
  });
  expect(overflow.doc).toBeLessThanOrEqual(0);
  expect(overflow.ex).toBeLessThanOrEqual(0);
  const buttons = page.getByTestId('exchange').locator('button:visible');
  const n = await buttons.count();
  expect(n).toBe(6); // Buy 10, Sell 10, Buy max, Sell all, Done, corner Map
  for (let i = 0; i < n; i++) {
    const b = (await buttons.nth(i).boundingBox())!;
    const name = await buttons.nth(i).textContent();
    expect(b.height, `${name} height`).toBeGreaterThanOrEqual(44);
    expect(b.width, `${name} width`).toBeGreaterThanOrEqual(44);
    expect(b.x + b.width, `${name} right edge`).toBeLessThanOrEqual(page.viewportSize()!.width);
    expect(b.y + b.height, `${name} bottom edge`).toBeLessThanOrEqual(page.viewportSize()!.height);
  }
}

test.describe('desktop', () => {
  test.use({ viewport: { width: 1280, height: 720 } });

  test('C opens the exchange at Halcyon; B buys, arrows pick a row, S sells, Esc returns to the planet', async ({ page }) => {
    const errors = trackErrors(page);
    await newPilot(page, 'Trader');
    await expect(page.getByRole('button', { name: /^Mission Computer/ })).toBeVisible();
    await page.keyboard.press('KeyC');
    const ex = page.getByTestId('exchange');
    await expect(ex).toBeVisible();

    const credits0 = await page.evaluate(() => window.__starwake!.world().credits);
    await page.keyboard.press('KeyB');
    await expect(ex.locator('tbody tr').first().locator('.sw-ex-held')).toHaveText('10 t');
    expect(await page.evaluate(() => window.__starwake!.world().credits)).toBeLessThan(credits0);
    await expect(ex.getByTestId('exchange-stats')).toContainText('Cargo: 10/20 t');

    await page.keyboard.press('ArrowDown');
    await expect(ex.locator('tbody tr').nth(1)).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('KeyS');
    await expect(ex.getByTestId('exchange-message')).toHaveText('You have none to sell');

    await page.screenshot({ path: SHOT });

    await page.keyboard.press('Escape');
    await expect(ex).toBeHidden();
    await expect(page.getByTestId('planet-screen')).toBeVisible();
    expect(errors).toEqual([]);
  });
});

test.describe('phone (touch, landscape)', () => {
  test.use({ hasTouch: true, viewport: { width: 844, height: 390 } });

  test('the exchange fits 844×390 with 44px buttons and no horizontal scroll', async ({ page }) => {
    const errors = trackErrors(page);
    await newPilot(page, 'Pocket');
    await page.getByRole('button', { name: /^Commodity Exchange/ }).tap();
    await expect(page.getByTestId('exchange')).toBeVisible();
    await page.getByRole('button', { name: 'Buy 10' }).tap();
    await expect(page.getByTestId('exchange-message')).toContainText('Bought 10 t');
    await checkFits(page);
    await page.getByRole('button', { name: /^Done/ }).tap();
    await expect(page.getByTestId('planet-screen')).toBeVisible();
    expect(errors).toEqual([]);
  });
});
