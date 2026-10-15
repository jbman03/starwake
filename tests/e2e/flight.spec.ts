import { expect, test, type Page } from '@playwright/test';

type Vec = { x: number; y: number };

async function shipVel(page: Page): Promise<Vec> {
  return page.evaluate(() => window.__starwake!.world().ship.vel);
}

const speed = (v: Vec) => Math.hypot(v.x, v.y);

test('flies with the keyboard: thrust builds speed, release drifts', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(String(e)));

  await page.goto('/?test');
  await page.waitForFunction(() => !!window.__starwake && window.__starwake.world().timeSec > 0.2);

  expect(speed(await shipVel(page))).toBe(0);

  await page.keyboard.down('ArrowUp');
  await page.waitForTimeout(1000);
  await page.keyboard.up('ArrowUp');

  const v1 = speed(await shipVel(page));
  expect(v1).toBeGreaterThan(100);

  await page.waitForTimeout(500);
  const v2 = speed(await shipVel(page));
  expect(Math.abs(v2 - v1) / v1).toBeLessThan(0.01);

  expect(errors).toEqual([]);
});

test('L lands at the start planet, pauses flight, and L again departs', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(String(e)));

  await page.goto('/?test');
  await page.waitForFunction(() => !!window.__starwake && window.__starwake.world().timeSec > 0.2);

  await page.keyboard.press('KeyL');
  await page.waitForFunction(() => window.__starwake!.controller.landedPlanetId === 'halcyon');
  const t1 = await page.evaluate(() => window.__starwake!.world().timeSec);
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => window.__starwake!.world().timeSec)).toBe(t1); // paused

  await page.keyboard.press('KeyL');
  await page.waitForFunction(() => window.__starwake!.controller.isFlying);
  expect(await page.evaluate(() => window.__starwake!.controller.landedPlanetId)).toBeNull();

  expect(errors).toEqual([]);
});
