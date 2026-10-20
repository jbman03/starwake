import { expect, test } from '@playwright/test';
import { leavePlanet, newPilot, trackErrors } from './helpers';

test('traffic appears, Tab targets a ship and the sidebar names it', async ({ page }) => {
  const errors = trackErrors(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  await newPilot(page);
  await leavePlanet(page);
  await expect
    .poll(() => page.evaluate(() => window.__starwake!.traffic!().length), { timeout: 25_000 })
    .toBeGreaterThanOrEqual(1);
  await page.keyboard.press('Tab');
  await expect
    .poll(() => page.evaluate(() => window.__starwake!.sidebar!().info.target), { timeout: 5_000 })
    .toContain('—');
  const ship = await page.evaluate(() => window.__starwake!.controller.traffic.targetId);
  expect(ship).not.toBeNull();
  expect(await page.evaluate(() => window.__starwake!.world().targetPlanetId)).toBeNull();
  expect(errors).toEqual([]);
});

test('clicking a ship targets it', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await newPilot(page);
  await leavePlanet(page);
  await expect
    .poll(() => page.evaluate(() => window.__starwake!.traffic!().some((n) => n.screen !== null)), { timeout: 25_000 })
    .toBe(true);
  // Pause the sim, park a ship beside the pilot so it is in view, then click it.
  const id = await page.evaluate(() => {
    const c = window.__starwake!.controller;
    c.pauseFlight();
    const n = c.traffic.npcs.find((m) => m.phase === 'fly')!;
    const pos = { x: c.world.ship.pos.x + 150, y: c.world.ship.pos.y };
    c.traffic = { ...c.traffic, npcs: c.traffic.npcs.map((m) => (m.id === n.id ? { ...m, ship: { ...m.ship, pos } } : m)) };
    return n.id;
  });
  await expect
    .poll(async () => (await page.evaluate(() => window.__starwake!.traffic!())).find((n) => n.id === id)?.screen?.x ?? 0)
    .toBeGreaterThan(0);
  const ship = (await page.evaluate(() => window.__starwake!.traffic!())).find((n) => n.id === id)!;
  await page.mouse.click(ship.screen!.x, ship.screen!.y);
  expect(await page.evaluate(() => window.__starwake!.controller.traffic.targetId)).toBe(id);
});
