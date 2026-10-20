import { expect, test, type Page } from '@playwright/test';
import { leavePlanet, newPilot, trackErrors } from './helpers';

const SHOT = '.superpowers/sdd/2026-10-16-starwake-cycle1-trade-missions/task-9-map.png';

/** Nothing on the page scrolls sideways, and every visible map button is a ≥ 44px target. */
async function checkFits(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => {
    const map = document.querySelector<HTMLElement>('[data-testid="star-map"]')!;
    const doc = document.scrollingElement!;
    return { doc: doc.scrollWidth - window.innerWidth, map: map.scrollWidth - map.clientWidth };
  });
  expect(overflow.doc).toBeLessThanOrEqual(0);
  expect(overflow.map).toBeLessThanOrEqual(0);
  const buttons = page.getByTestId('star-map').locator('button:visible');
  const n = await buttons.count();
  expect(n).toBeGreaterThanOrEqual(6); // zoom in/out/fit, Set course, Clear course, Close
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

  test('M opens the star map; plot a course to a known neighbour, then autopilot out and J jumps there', async ({ page }) => {
    test.setTimeout(60_000);
    const errors = trackErrors(page);
    await newPilot(page, 'Nav');
    await leavePlanet(page);
    expect(await page.evaluate(() => window.__starwake!.world().targetPlanetId)).toBeNull();

    await page.waitForTimeout(100);
    await page.keyboard.press('KeyM');
    const map = page.getByTestId('star-map');
    await expect(map).toBeVisible();
    expect(await page.evaluate(() => window.__starwake!.controller.isFlying)).toBe(false);

    // Unknown systems are blank circles: drawn, but with no name.
    const unknown = map.locator('.sw-sys-unknown');
    expect(await unknown.count()).toBeGreaterThan(0);
    await expect(unknown.first().locator('text')).toHaveCount(0);
    await expect(map.locator('[data-system="calder"] .sw-map-ring')).toHaveCount(1);
    await expect(map.getByTestId('map-info')).toContainText('Calder');
    await expect(map.getByTestId('map-info')).toContainText('1 Mar 3207');

    // Tessaly is a known Concord system linked to Calder.
    await map.locator('[data-system="tessaly"]').click();
    await expect(map.getByTestId('map-info')).toContainText('Tessaly');
    await expect(map.getByTestId('map-info')).toContainText('Concord of Lanterns');
    await expect(map.getByTestId('map-route')).toHaveText('1 jump · fuel needed 1 · you have 3');
    await page.screenshot({ path: SHOT });

    await map.getByRole('button', { name: 'Set course' }).click();
    expect(await page.evaluate(() => window.__starwake!.world().route)).toEqual(['tessaly']);
    await expect(map.getByRole('button', { name: 'Set course' })).toBeDisabled();
    await expect(map.getByRole('button', { name: 'Clear course' })).toBeEnabled();
    await checkFits(page);

    await map.getByRole('button', { name: /^Close/ }).click();
    await expect(map).toBeHidden();
    await page.waitForFunction(() => window.__starwake!.controller.isFlying);
    await expect.poll(() => page.evaluate(() => window.__starwake!.sidebar!().info.nav)).toBe('Tessaly · 1 jump');

    await page.keyboard.press('KeyG');
    await page.waitForFunction(() => window.__starwake!.world().assist.kind === 'autopilot');
    await expect
      .poll(() => page.evaluate(() => window.__starwake!.hudBanner!()))
      .toBe('Autopilot → Tessaly · fuel after: 2 jumps');
    await page.waitForFunction(() => window.__starwake!.world().assist.kind === 'none', null, { timeout: 30_000 });
    await page.keyboard.press('KeyJ');
    await page.waitForFunction(() => window.__starwake!.world().systemId === 'tessaly', null, { timeout: 10_000 });
    const w = await page.evaluate(() => window.__starwake!.world());
    expect(w.route).toEqual([]);
    expect(w.day).toBe(1);
    await expect.poll(() => page.evaluate(() => window.__starwake!.sidebar!().info.nav)).toBe('No course');

    // Back on the map, the date has moved on and Tessaly is now the current system.
    await page.keyboard.press('KeyM');
    await expect(map).toBeVisible();
    await expect(map.getByTestId('map-info')).toContainText('2 Mar 3207');
    await expect(map.locator('[data-system="tessaly"] .sw-map-ring')).toHaveCount(1);
    await page.keyboard.press('Escape');
    await expect(map).toBeHidden();
    await page.waitForFunction(() => window.__starwake!.controller.isFlying);

    expect(errors).toEqual([]);
  });

  test('zoom buttons, wheel and drag change the view; N on the planet screen opens the map and returns', async ({ page }) => {
    const errors = trackErrors(page);
    await newPilot(page, 'Zoom');
    await page.keyboard.press('KeyN');
    const map = page.getByTestId('star-map');
    await expect(map).toBeVisible();
    const svg = map.locator('svg.sw-starmap-svg');
    const viewBox = async () => (await svg.getAttribute('viewBox'))!.split(' ').map(Number);
    const full = await viewBox();

    await map.getByRole('button', { name: 'Zoom in' }).click();
    const zoomed = await viewBox();
    expect(zoomed[2]).toBeCloseTo(full[2] / 1.5);

    const box = (await svg.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, -200);
    await expect.poll(async () => (await viewBox())[2]).toBeLessThan(zoomed[2]);

    const before = await viewBox();
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 120, box.y + box.height / 2 + 40, { steps: 6 });
    await page.mouse.up();
    const after = await viewBox();
    expect(after[0]).toBeLessThan(before[0]); // dragged right → view moved left
    expect(after[2]).toBeCloseTo(before[2]);

    await map.getByRole('button', { name: 'Show whole galaxy' }).click();
    expect((await viewBox())[2]).toBeCloseTo(full[2]);

    // N (the planet-screen map key) closes it again, back to the planet screen.
    await page.keyboard.press('KeyN');
    await expect(map).toBeHidden();
    await expect(page.getByTestId('planet-screen')).toBeVisible();
    expect(await page.evaluate(() => window.__starwake!.controller.isFlying)).toBe(false);
    expect(errors).toEqual([]);
  });
});

test.describe('desktop mission preview and corner button', () => {
  test.use({ viewport: { width: 1280, height: 720 } });

  test('the corner Map button opens the map from the planet screen and returns', async ({ page }) => {
    const errors = trackErrors(page);
    await newPilot(page, 'Corner');
    await page.locator('.sw-map-corner').click();
    const map = page.getByTestId('star-map');
    await expect(map).toBeVisible();
    await map.getByRole('button', { name: /^Close/ }).click();
    await expect(map).toBeHidden();
    await expect(page.getByTestId('planet-screen')).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('N in the Mission Computer previews the selected job on the map; closing keeps the selection', async ({ page }) => {
    const errors = trackErrors(page);
    await newPilot(page, 'Preview');
    await page.getByRole('button', { name: /^Mission Computer/ }).click();
    const mc = page.getByTestId('mission-computer');
    await expect(mc).toBeVisible();
    const rows = mc.locator('.sw-mc-row');
    expect(await rows.count()).toBeGreaterThan(1);
    await rows.nth(1).click();
    const offerId = (await rows.nth(1).getAttribute('data-offer'))!;
    await page.keyboard.press('KeyN');
    const map = page.getByTestId('star-map');
    await expect(map).toBeVisible();
    await expect(map.getByTestId('map-preview')).toContainText('Mission:');
    await expect(map.getByTestId('map-route')).toBeVisible();
    await expect(map.locator('.sw-map-preview')).toHaveCount(1);
    await map.getByRole('button', { name: /^Close/ }).click();
    await expect(map).toBeHidden();
    await expect(mc).toBeVisible();
    await expect(mc.locator(`.sw-mc-row[data-offer="${offerId}"]`)).toHaveAttribute('aria-selected', 'true');
    expect(errors).toEqual([]);
  });
});

test.describe('phone (touch, landscape)', () => {
  test.use({ hasTouch: true, viewport: { width: 844, height: 390 } });

  test('the map fits 844×390 with 44px buttons; the rail HUD shows the course inside the rail', async ({ page }) => {
    test.setTimeout(60_000);
    const errors = trackErrors(page);
    await newPilot(page, 'Pocket');
    await page.getByRole('button', { name: /^Map/ }).tap();
    const map = page.getByTestId('star-map');
    await expect(map).toBeVisible();
    await map.locator('[data-system="tessaly"]').tap();
    await map.getByRole('button', { name: 'Set course' }).tap();
    await checkFits(page);
    await map.getByRole('button', { name: /^Close/ }).tap();
    await expect(page.getByTestId('planet-screen')).toBeVisible();

    await page.getByRole('button', { name: /^Leave/ }).tap();
    await page.waitForFunction(() => window.__starwake!.controller.isFlying);
    await page.touchscreen.tap(422, 30);
    await expect(page.getByTestId('touch-rails')).toBeVisible();
    const course = page.getByTestId('rail-course');
    await expect(course).toHaveText('Course: Tessaly (1 jump)');
    const rail = (await page.locator('[data-rail="stick"]').boundingBox())!;
    const hud = (await page.locator('.sw-rail-hud').boundingBox())!;
    const line = (await course.boundingBox())!;
    expect(line.x).toBeGreaterThanOrEqual(rail.x);
    expect(line.x + line.width).toBeLessThanOrEqual(rail.x + rail.width);
    expect(line.y + line.height).toBeLessThanOrEqual(hud.y + hud.height); // not clipped by the HUD box

    // The radar opens the map in flight; closing it resumes flight.
    await page.locator('[data-control="radar"]').tap();
    await expect(map).toBeVisible();
    await checkFits(page);
    await map.getByRole('button', { name: /^Close/ }).tap();
    await expect(map).toBeHidden();
    await page.waitForFunction(() => window.__starwake!.controller.isFlying);
    expect(errors).toEqual([]);
  });
});
