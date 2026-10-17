import { expect, test } from '@playwright/test';
import { newPilot, trackErrors } from './helpers';

const pilots = (page: import('@playwright/test').Page) =>
  page.evaluate(() => window.__starwake!.store.list());

test('new pilot, land with autosave, leave, autopilot out, jump, pause', async ({ page }) => {
  test.setTimeout(60_000);
  const errors = trackErrors(page);

  await newPilot(page, 'Ava');
  const planet = page.getByTestId('planet-screen');
  await expect(planet).toContainText('Halcyon');
  await expect(planet).toContainText('Tech tier 3');
  await expect(planet).toContainText('Fuel: 3 jumps');
  await page.screenshot({ path: '.superpowers/sdd/2026-10-15-starwake-foundation/task-9-screenshot.png' });

  const before = await pilots(page);
  expect(before).toHaveLength(1);
  expect(before[0].name).toBe('Ava');

  // L on the planet screen leaves.
  await page.keyboard.press('KeyL');
  await expect(planet).toBeHidden();
  await page.waitForFunction(() => window.__starwake!.controller.isFlying);

  // L in flight lands (parked at the edge, so immediately); planet screen returns and autosaves.
  await page.waitForTimeout(100);
  await page.keyboard.press('KeyL');
  await expect(planet).toBeVisible();
  await expect(planet).toContainText('Halcyon');
  await expect
    .poll(async () => (await pilots(page))[0].savedAt > before[0].savedAt, { timeout: 5000 })
    .toBe(true);

  // Leave via the button; no target remains, so G autopilots to the jump point. The star map
  // can't plot courses yet, so plot one to Vesk through the test hook.
  await page.getByRole('button', { name: /^Leave/ }).click();
  await expect(planet).toBeHidden();
  await page.waitForFunction(() => window.__starwake!.controller.isFlying);
  expect(await page.evaluate(() => window.__starwake!.world().targetPlanetId)).toBeNull();
  expect(await page.evaluate(() => window.__starwake!.controller.plotRoute('vesk').ok)).toBe(true);
  await page.waitForTimeout(100);
  await page.keyboard.press('KeyG');
  await page.waitForFunction(() => window.__starwake!.world().assist.kind === 'autopilot');
  await expect
    .poll(() => page.evaluate(() => window.__starwake!.hudBanner!()))
    .toBe('Autopilot → Vesk · fuel after: 2 jumps');
  await page.waitForFunction(() => window.__starwake!.world().assist.kind === 'none', null, { timeout: 30_000 });
  await expect.poll(() => page.evaluate(() => window.__starwake!.hudBanner!())).toBeNull();

  const fuel0 = await page.evaluate(() => window.__starwake!.world().ship.fuel);
  await page.keyboard.press('KeyJ');
  await page.waitForTimeout(1500);
  const w = await page.evaluate(() => window.__starwake!.world());
  expect(w.systemId).toBe('vesk');
  expect(w.ship.fuel).toBe(fuel0 - 100);
  expect(w.day).toBe(1);
  expect(w.route).toEqual([]);
  expect(w.known).toContain('vesk');

  // Escape opens the pause menu and freezes the sim.
  await page.keyboard.press('Escape');
  const pause = page.getByTestId('pause-menu');
  await expect(pause).toBeVisible();
  await expect(pause.getByRole('button', { name: 'Save (at last planet)' })).toBeVisible();
  const t = await page.evaluate(() => window.__starwake!.world().timeSec);
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => window.__starwake!.world().timeSec)).toBe(t);

  // Escape (back) resumes.
  await page.keyboard.press('Escape');
  await expect(pause).toBeHidden();
  await page.waitForFunction(() => window.__starwake!.controller.isFlying);

  // M opens the map; M closes it.
  await page.keyboard.press('KeyM');
  const map = page.getByTestId('star-map');
  await expect(map).toBeVisible();
  await expect(map).toContainText('Vesk');
  await expect(map).toContainText('You are here');
  await page.keyboard.press('KeyM');
  await expect(map).toBeHidden();
  await page.waitForFunction(() => window.__starwake!.controller.isFlying);

  expect(errors).toEqual([]);
});

test('quit to main menu asks for confirmation; load and delete pilots', async ({ page }) => {
  const errors = trackErrors(page);
  await newPilot(page, 'Bo');
  await page.keyboard.press('KeyL');
  await page.waitForFunction(() => window.__starwake!.controller.isFlying);
  await page.waitForTimeout(100);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Quit to main menu' }).click();
  await expect(page.getByText('Unsaved progress since your last landing will be lost.')).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Quit' }).click();

  const menu = page.getByTestId('main-menu');
  await expect(menu).toBeVisible();
  await expect(menu).toContainText('Bo');

  await menu.getByRole('button', { name: 'Load' }).click();
  await expect(page.getByTestId('planet-screen')).toContainText('Halcyon');
  await page.keyboard.press('KeyL');
  await page.waitForFunction(() => window.__starwake!.controller.isFlying);
  await page.waitForTimeout(100);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Quit to main menu' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Quit' }).click();

  await menu.getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByText('Delete pilot "Bo"?')).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
  await expect(menu).toContainText('No pilots yet');
  expect(await page.evaluate(() => window.__starwake!.store.list())).toEqual([]);

  expect(errors).toEqual([]);
});
