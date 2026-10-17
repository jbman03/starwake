import { expect, test, type Page } from '@playwright/test';
import { newPilot, trackErrors } from './helpers';

type Rect = { x: number; y: number; w: number; h: number };

const intersects = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

async function layoutOf(page: Page): Promise<{ view: Rect; clear: Rect }> {
  const rails = page.getByTestId('touch-rails');
  const parse = async (name: string) => JSON.parse((await rails.getAttribute(name))!) as Rect;
  return { view: await parse('data-view'), clear: await parse('data-clear') };
}

/** Wait until the rails have laid out for the current viewport size. */
async function waitForLayout(page: Page, w: number, h: number): Promise<void> {
  await expect
    .poll(async () => {
      const size = await page.getByTestId('touch-rails').getAttribute('data-size');
      return size;
    })
    .toBe(`${w}x${h}`);
  await page.waitForTimeout(50);
}

/** Every rail control lies outside the clear region; the context button is bottom-center of the view. */
async function checkNoOverlap(page: Page): Promise<void> {
  const { view, clear } = await layoutOf(page);
  const controls = page.locator('[data-rail-control]:visible');
  const n = await controls.count();
  expect(n).toBeGreaterThanOrEqual(6);
  for (let i = 0; i < n; i++) {
    const c = controls.nth(i);
    const b = (await c.boundingBox())!;
    const box = { x: b.x, y: b.y, w: b.width, h: b.height };
    const name = await c.getAttribute('data-control');
    expect(intersects(box, clear), `${name} ${JSON.stringify(box)} vs clear ${JSON.stringify(clear)}`).toBe(false);
  }

  const ctxBtn = page.getByTestId('context-button');
  await expect(ctxBtn).toBeVisible();
  const b = (await ctxBtn.boundingBox())!;
  expect(b.x).toBeGreaterThanOrEqual(view.x);
  expect(b.x + b.width).toBeLessThanOrEqual(view.x + view.w);
  expect(b.y + b.height).toBeLessThanOrEqual(view.y + view.h);
  expect(b.y).toBeGreaterThan(view.y + view.h / 2);
  expect(Math.abs(b.x + b.width / 2 - (view.x + view.w / 2))).toBeLessThan(2);

  // The Phaser camera draws exactly into the view.
  const cam = await page.evaluate(() => window.__starwake!.cameraViewport!());
  expect(cam).toEqual({ x: Math.round(view.x), y: Math.round(view.y), w: Math.round(view.w), h: Math.round(view.h) });
}

test.describe('phone (touch, landscape)', () => {
  test.use({ hasTouch: true, viewport: { width: 844, height: 390 } });

  test('side rails never cover the view; tap a planet to land; portrait asks to rotate', async ({ page }) => {
    test.setTimeout(60_000);
    const errors = trackErrors(page);
    await newPilot(page, 'Tap');

    await page.getByRole('button', { name: /^Leave/ }).tap();
    await expect(page.getByTestId('planet-screen')).toBeHidden();
    await page.waitForFunction(() => window.__starwake!.controller.isFlying);

    // Tap the empty top of the view: touch mode, rails visible.
    await page.touchscreen.tap(422, 30);
    const rails = page.getByTestId('touch-rails');
    await expect(rails).toBeVisible();
    await expect(page.getByTestId('context-button')).toHaveText('⬇ LAND ON HALCYON');
    await waitForLayout(page, 844, 390);

    // Carry-overs: Pause is a 44px touch target, and (safe-area insets are unit-tested in touch.test.ts).
    const pauseBox = await page.getByRole('button', { name: 'Pause' }).boundingBox();
    expect(pauseBox!.width).toBeGreaterThanOrEqual(44);
    expect(pauseBox!.height).toBeGreaterThanOrEqual(44);
    await checkNoOverlap(page);
    await page.screenshot({ path: '.superpowers/sdd/2026-10-15-starwake-foundation/task-11-screenshot.png' });

    for (const [w, h] of [[932, 430], [780, 360]]) {
      await page.setViewportSize({ width: w, height: h });
      await waitForLayout(page, w, h);
      await checkNoOverlap(page);
    }

    // Tap the Halcyon sprite: lands, planet screen opens.
    const pos = await page.evaluate(() => window.__starwake!.planetScreenPos!('halcyon'));
    expect(pos).not.toBeNull();
    await page.touchscreen.tap(pos!.x, pos!.y);
    await expect(page.getByTestId('planet-screen')).toBeVisible();
    await expect(page.getByTestId('planet-screen')).toContainText('Halcyon');

    // Portrait phone: rotate overlay.
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByTestId('rotate-overlay')).toBeVisible();
    await expect(page.getByTestId('rotate-overlay')).toContainText('Rotate your phone');

    expect(errors).toEqual([]);
  });

  test('too close to jump: the context button autopilots out and the route banner shows', async ({ page }) => {
    const errors = trackErrors(page);
    await newPilot(page, 'Out');
    await page.getByRole('button', { name: /^Leave/ }).tap();
    await page.waitForFunction(() => window.__starwake!.controller.isFlying);
    await page.touchscreen.tap(422, 30);
    await expect(page.getByTestId('touch-rails')).toBeVisible();
    await page.evaluate(() => {
      const c = window.__starwake!.controller;
      c.world = { ...c.world, ship: { ...c.world.ship, pos: { x: -1000, y: -1000 }, vel: { x: 0, y: 0 } } };
      c.plotRoute('vesk'); // plotted directly; starmap.spec.ts covers the map UI
    });
    const ctxBtn = page.getByTestId('context-button');
    await expect(ctxBtn).toHaveText('⇱ AUTOPILOT TO JUMP POINT');
    await ctxBtn.tap();
    await expect(ctxBtn).toHaveText('✋ TAKE CONTROL');
    const banner = page.getByTestId('route-banner');
    await expect(banner).toBeVisible();
    await expect(banner).toHaveText('Autopilot → Vesk · fuel after: 2 jumps');
    const { clear } = await layoutOf(page);
    const b = (await banner.boundingBox())!;
    expect(b.x).toBeGreaterThanOrEqual(clear.x);
    expect(b.x + b.width).toBeLessThanOrEqual(clear.x + clear.w);
    expect(b.y).toBeLessThan(80);
    expect(errors).toEqual([]);
  });

  test('no destination after leaving Halcyon: the context button plots a course on the star map', async ({ page }) => {
    const errors = trackErrors(page);
    await newPilot(page, 'Plot');
    await page.getByRole('button', { name: /^Leave/ }).tap();
    await page.waitForFunction(() => window.__starwake!.controller.isFlying);
    await page.touchscreen.tap(422, 30);
    await expect(page.getByTestId('touch-rails')).toBeVisible();
    // Fly clear of Halcyon (out of land range) with no course plotted: Calder has 4 lanes out.
    await page.evaluate(() => {
      const c = window.__starwake!.controller;
      c.world = { ...c.world, route: [], ship: { ...c.world.ship, pos: { x: -1000, y: -1000 }, vel: { x: 0, y: 0 } } };
    });
    const ctxBtn = page.getByTestId('context-button');
    await expect(ctxBtn).toHaveText('🗺 PLOT COURSE');
    await ctxBtn.tap();
    const map = page.getByTestId('star-map');
    await expect(map).toBeVisible();
    expect(await page.evaluate(() => window.__starwake!.controller.isFlying)).toBe(false);
    await map.getByRole('button', { name: /^Close/ }).tap();
    await expect(map).toBeHidden();
    await page.waitForFunction(() => window.__starwake!.controller.isFlying);
    expect(errors).toEqual([]);
  });

  test('4:3 tablet: rails overlay the view edges but stay out of the clear region', async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 600 });
    await newPilot(page, 'Tab');
    await page.getByRole('button', { name: /^Leave/ }).tap();
    await page.waitForFunction(() => window.__starwake!.controller.isFlying);
    await page.touchscreen.tap(400, 30);
    await waitForLayout(page, 800, 600);
    const { view, clear } = await layoutOf(page);
    expect(view).toEqual({ x: 0, y: 0, w: 800, h: 600 });
    expect(clear.w).toBeLessThan(800);
    await checkNoOverlap(page);
  });
});

test('keyboard mode: no rails, camera fills the window, no rotate overlay', async ({ page }) => {
  await newPilot(page, 'Keys');
  await page.keyboard.press('KeyL');
  await page.waitForFunction(() => window.__starwake!.controller.isFlying);
  await expect(page.getByTestId('touch-rails')).toBeHidden();
  await expect(page.getByTestId('rotate-overlay')).toBeHidden();
  const size = page.viewportSize()!;
  await expect
    .poll(() => page.evaluate(() => window.__starwake!.cameraViewport!()))
    .toEqual({ x: 0, y: 0, w: size.width, h: size.height });
});
