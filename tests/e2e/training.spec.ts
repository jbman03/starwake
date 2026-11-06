import { expect, test } from '@playwright/test';
import { guardPlayer, leavePlanet, newPilot, quietSky, shootUntilDisabled, trackErrors } from './helpers';

// Playtest improvements: combat training and the Fleet panel, with real keys and clicks. Waits are state-based.

test.use({ viewport: { width: 1280, height: 800 } });

test('combat training from the pause menu: target, fire, fly beside, board, take everything', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = trackErrors(page);
  await newPilot(page, 'Cadet', false, true);
  await leavePlanet(page);
  await quietSky(page);
  await guardPlayer(page);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: /^Combat training/ }).click();
  await expect.poll(() => page.evaluate(() => window.__starwake!.hudObjective!())).toContain('target the drone');
  const id = await page.evaluate(() => window.__starwake!.controller.training!.droneId);
  await page.keyboard.press('KeyR');
  await expect.poll(() => page.evaluate(() => window.__starwake!.controller.traffic.targetId)).toBe(id);
  await shootUntilDisabled(page, id, async () => {
    await page.keyboard.down('Space');
    await page.waitForTimeout(80);
    await page.keyboard.up('Space');
  });
  await expect.poll(() => page.evaluate(() => window.__starwake!.hudObjective!())).toContain('fly beside');
  await page.keyboard.press('KeyG');
  await expect.poll(() => page.evaluate(() => window.__starwake!.controller.training?.step), { timeout: 40_000 }).toBe(3);
  await page.keyboard.press('KeyB');
  await expect(page.getByTestId('boarding-card')).toBeVisible();
  await page.keyboard.press('Digit5');
  await expect(page.getByRole('button', { name: /Take everything — done/ })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect.poll(() => page.evaluate(() => window.__starwake!.controller.training)).toBeNull();
  await expect.poll(() => page.evaluate(() => window.__starwake!.hudMessage!())).toContain('Training done.');
  expect(await page.evaluate(() => window.__starwake!.world().stats.kills)).toBe(0);
  expect(errors).toEqual([]);
});

test('E opens the Fleet panel in flight; Esc closes it', async ({ page }) => {
  const errors = trackErrors(page);
  await newPilot(page, 'Admiral', false, true);
  await leavePlanet(page);
  await page.keyboard.press('KeyE');
  const panel = page.getByTestId('fleet-panel');
  await expect(panel).toBeVisible();
  await expect(panel).toContainText('No escorts or fighters');
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
  await expect.poll(() => page.evaluate(() => window.__starwake!.controller.isFlying)).toBe(true);
  expect(errors).toEqual([]);
});
