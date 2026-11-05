import { expect, test } from '@playwright/test';
import { guardPlayer, leavePlanet, newPilot, quietSky, shootUntilDisabled, trackErrors } from './helpers';

// The nemesis (cycle 6 part 2C). A test hook brings him in (an arrival roll would); he is shot down with real key
// presses. Waits are state-based.

test.use({ viewport: { width: 1280, height: 800 } });

test('the rival hails, Space disables him, he ejects and the duel pays', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = trackErrors(page);
  await newPilot(page, 'Duellist', false, true);
  await leavePlanet(page);
  await quietSky(page);
  await guardPlayer(page);
  const before = await page.evaluate(() => window.__starwake!.world().credits);
  const id = await page.evaluate(() => window.__starwake!.spawnNemesis());
  await expect.poll(() => page.evaluate(() => window.__starwake!.hudMessage!())).toContain('Kade Varro:');
  await page.keyboard.press('KeyR');
  await expect.poll(() => page.evaluate(() => window.__starwake!.controller.traffic.targetId)).toBe(id);
  await shootUntilDisabled(page, id, async () => {
    await page.keyboard.down('Space');
    await page.waitForTimeout(80);
    await page.keyboard.up('Space');
  }).catch(() => undefined); // he ejects the moment he is disabled, so "gone" ends it
  await expect.poll(() => page.evaluate(() => window.__starwake!.world().nemesis.defeats), { timeout: 60_000 }).toBe(1);
  const reward = await page.evaluate(() => window.__starwake!.data.fleet.nemesis.levels[0].reward);
  expect(await page.evaluate(() => window.__starwake!.world().credits)).toBeGreaterThanOrEqual(before + reward);
  expect(await page.evaluate(() => window.__starwake!.controller.traffic.npcs.some((n) => n.id === 'nemesis'))).toBe(false);
  expect(errors).toEqual([]);
});
