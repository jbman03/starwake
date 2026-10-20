import { expect, test } from '@playwright/test';
import { leavePlanet, newPilot, trackErrors, waitForFlight } from './helpers';

test.describe('desktop', () => {
  test.use({ viewport: { width: 1280, height: 720 } });

  test('buy low at Halcyon, fly a plotted course, sell high at another port for a profit', async ({ page }) => {
    test.setTimeout(90_000);
    const errors = trackErrors(page);
    await newPilot(page, 'Merchant');

    // Find a good that is Low at the start port and High at a port in another known system,
    // preferring the shortest route through known systems.
    const deal = await page.evaluate(() => {
      const { data } = window.__starwake!;
      const start = data.planets[data.config.startPlanetId];
      const known = new Set(data.config.knownAtStart);
      const hops = new Map<string, number>([[start.systemId, 0]]);
      const queue = [start.systemId];
      for (let i = 0; i < queue.length; i++) {
        const id = queue[i];
        for (const n of data.systems[id].links) {
          if (known.has(n) && !hops.has(n)) {
            hops.set(n, hops.get(id)! + 1);
            queue.push(n);
          }
        }
      }
      const lows = Object.entries(start.market ?? {}).filter(([, level]) => level === 'low').map(([g]) => g);
      const options: { good: string; portId: string; systemId: string; hops: number }[] = [];
      for (const p of Object.values(data.planets)) {
        const h = hops.get(p.systemId);
        if (!h || !(p.services ?? []).includes('exchange')) continue;
        for (const g of lows) if (p.market?.[g] === 'high') options.push({ good: g, portId: p.id, systemId: p.systemId, hops: h });
      }
      options.sort((a, b) => a.hops - b.hops);
      return options[0] ?? null;
    });
    expect(deal, 'no good is Low at the start port and High at a known, reachable port').not.toBeNull();
    const { good, portId, systemId } = deal!;
    expect(deal!.hops).toBeLessThanOrEqual(3); // starting fuel covers three jumps without refuelling

    const credits0 = await page.evaluate(() => window.__starwake!.world().credits);

    // Buy 10 t at Halcyon.
    await page.getByRole('button', { name: /^Commodity Exchange/ }).click();
    const ex = page.getByTestId('exchange');
    await expect(ex).toBeVisible();
    await ex.locator(`[data-good="${good}"]`).click();
    await ex.getByRole('button', { name: 'Buy 10' }).click();
    await expect(ex.locator(`[data-good="${good}"] .sw-ex-held`)).toHaveText('10 t');
    expect(await page.evaluate(() => window.__starwake!.world().cargo)).toEqual({ [good]: 10 });
    const credits1 = await page.evaluate(() => window.__starwake!.world().credits);
    expect(credits1).toBeLessThan(credits0);
    await ex.getByRole('button', { name: /^Done/ }).click();
    await expect(page.getByTestId('planet-screen')).toBeVisible();
    await leavePlanet(page);

    // Plot the course on the star map.
    await page.waitForTimeout(100);
    await page.keyboard.press('KeyM');
    const map = page.getByTestId('star-map');
    await expect(map).toBeVisible();
    await map.locator(`[data-system="${systemId}"]`).click();
    await map.getByRole('button', { name: 'Set course' }).click();
    expect((await page.evaluate(() => window.__starwake!.world().route)).at(-1)).toBe(systemId);
    await map.getByRole('button', { name: /^Close/ }).click();
    await expect(map).toBeHidden();
    await waitForFlight(page);

    // Autopilot out and jump, once per hop.
    while ((await page.evaluate(() => window.__starwake!.world().route.length)) > 0) {
      const pos0 = await page.evaluate(() => ({ ...window.__starwake!.world().ship.pos }));
      await page.keyboard.press('KeyG');
      // The ship must actually start moving (a fast autopilot state can't be missed this way).
      await page.waitForFunction(
        (p) => {
          const q = window.__starwake!.world().ship.pos;
          return Math.hypot(q.x - p.x, q.y - p.y) > 5;
        },
        pos0,
        { timeout: 10_000 },
      );
      await page.waitForFunction(() => window.__starwake!.world().assist.kind === 'none', null, { timeout: 30_000 });
      const day = await page.evaluate(() => window.__starwake!.world().day);
      await page.keyboard.press('KeyJ');
      await page.waitForFunction((d) => window.__starwake!.world().day > d, day, { timeout: 10_000 });
    }
    expect(await page.evaluate(() => window.__starwake!.world().systemId)).toBe(systemId);

    // Land with the real controls: Tab to the port, then L autopilots in and lands.
    await waitForFlight(page);
    for (let i = 0; i < 12 && (await page.evaluate(() => window.__starwake!.world().targetPlanetId)) !== portId; i++) {
      await page.keyboard.press('Tab');
      await page.waitForTimeout(50);
    }
    expect(await page.evaluate(() => window.__starwake!.world().targetPlanetId)).toBe(portId);
    await page.keyboard.press('KeyL');
    await expect(page.getByTestId('planet-screen')).toBeVisible({ timeout: 40_000 });
    await expect(page.getByTestId('planet-screen')).toContainText(
      await page.evaluate((id) => window.__starwake!.data.planets[id].name, portId),
    );
    await page.keyboard.press('KeyC');
    await expect(ex).toBeVisible();
    await ex.locator(`[data-good="${good}"]`).click();
    await ex.getByRole('button', { name: 'Sell all' }).click();
    await expect(ex.locator(`[data-good="${good}"] .sw-ex-held`)).toHaveText('0 t');

    const w = await page.evaluate(() => window.__starwake!.world());
    expect(w.cargo).toEqual({});
    expect(w.credits).toBeGreaterThan(credits1); // the gain comes from the sale
    expect(w.credits).toBeGreaterThan(credits0); // no refuelling happened, so no fuel spend to subtract
    expect(errors).toEqual([]);
  });
});
