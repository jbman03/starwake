import { expect, test, type Page } from '@playwright/test';
import { guardPlayer, leavePlanet, newPilot, npcOf, quietSky, trackErrors, weaken } from './helpers';

// Crew and wingmen (cycle 6 part 2A). The scene is set up with test hooks (a landing at Vanterre, credits, a
// short crew, a hostile); every choice under test is a real click or key press. Waits are state-based.

/** Test-only: land at Vanterre with 50 000 credits and only one hand aboard. */
async function toVanterreShortHanded(page: Page): Promise<void> {
  await page.evaluate(() => {
    const h = window.__starwake!;
    h.controller.world = { ...h.controller.world, credits: 50_000, crew: 1 };
    h.teleport('vanterre');
  });
  await expect(page.getByTestId('planet-screen')).toContainText('Vanterre');
}

const world = (page: Page) => page.evaluate(() => window.__starwake!.world());

test.describe('desktop', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('hire crew at the bar, then recruit Wren Halloway, who joins as a Green wingman', async ({ page }) => {
    test.setTimeout(90_000);
    const errors = trackErrors(page);
    await newPilot(page, 'Mustering', false, true);
    await toVanterreShortHanded(page);
    const cap = await page.evaluate(() => window.__starwake!.data.ships[window.__starwake!.world().shipId].crew);
    await expect(page.getByTestId('crew-stat')).toHaveText(`Crew: 1/${cap}`);
    const before = (await world(page)).credits;
    await page.getByTestId('hire-crew').getByRole('button').click();
    await expect(page.getByTestId('crew-stat')).toHaveText(`Crew: ${cap}/${cap}`);
    await expect(page.getByTestId('hire-crew')).toHaveCount(0);
    expect((await world(page)).credits).toBe(before - (cap - 1) * 150);

    const offer = page.getByTestId('wingman-offer');
    await expect(offer).toContainText('Wren Halloway');
    await offer.getByRole('button', { name: 'Recruit' }).click();
    await expect(page.getByTestId('wingman-offer')).toHaveCount(0);
    const row = page.getByTestId('your-escorts').locator('[data-escort]');
    await expect(row).toHaveCount(1);
    await expect(row).toContainText('Wingman · Green (0)');
    expect((await world(page)).escorts[0]).toMatchObject({ wingmanId: 'wren', takedowns: 0 });
    expect(errors).toEqual([]);
  });

  test('a wingman sent in with KeyI disables the target, and the takedown is counted', async ({ page }) => {
    test.setTimeout(120_000);
    const errors = trackErrors(page);
    await newPilot(page, 'Wingtip', false, true);
    await toVanterreShortHanded(page);
    await page.getByTestId('wingman-offer').getByRole('button', { name: 'Recruit' }).click();
    await leavePlanet(page);
    await expect.poll(() => page.evaluate(() => window.__starwake!.controller.escortsPresent())).toBe(1);
    await quietSky(page);
    await guardPlayer(page);

    const id = await page.evaluate(() => window.__starwake!.spawnHostile());
    // A hold point where she is, so a hurt raider waits instead of running for the jump boundary.
    await page.evaluate((i) => {
      const c = window.__starwake!.controller;
      c.traffic = { ...c.traffic, npcs: c.traffic.npcs.map((n) => (n.id === i ? { ...n, hold: { ...n.ship.pos } } : n)) };
    }, id);
    await page.keyboard.press('Tab');
    await expect.poll(() => page.evaluate(() => window.__starwake!.controller.traffic.targetId)).toBe(id);
    await page.keyboard.press('KeyI');
    await expect.poll(() => page.evaluate(() => window.__starwake!.world().escortOrder)).toBe('attack');
    // Keep the hostile weak and the player safe until the wingman has disabled her.
    await expect
      .poll(
        async () => {
          await guardPlayer(page);
          const n = await npcOf(page, id);
          if (n && !n.hull.disabled) await weaken(page, id);
          return (await world(page)).escorts[0]?.takedowns ?? 0;
        },
        { timeout: 60_000 },
      )
      .toBe(1);
    expect((await world(page)).stats.kills).toBe(0);
    expect(errors).toEqual([]);
  });
});
