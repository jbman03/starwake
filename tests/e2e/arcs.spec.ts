import { expect, test } from '@playwright/test';
import { leavePlanet, newPilot, trackErrors } from './helpers';

// Cycle 7 Part 1: career arcs. The Navy commission is offered at the Halcyon bar from day 1.
test.describe('desktop', () => {
  test.use({ viewport: { width: 1280, height: 720 } });

  test("take the Navy commission at Halcyon: the confirm shows, Back cancels, Confirm takes it; the Mission Log Leads shows the ferry to Vanterre", async ({ page }) => {
    const errors = trackErrors(page);
    await newPilot(page, 'Ensign');
    await page.keyboard.press('KeyB');
    const bar = page.getByTestId('bar');
    await expect(bar).toBeVisible();
    await bar.locator('.sw-mc-row', { hasText: 'The Commission' }).click();
    await bar.getByRole('button', { name: /^Accept/ }).click();
    const dialog = page.locator('.sw-dialog');
    await expect(dialog).toContainText("This choice can't be undone");
    await dialog.getByRole('button', { name: /^Back/ }).click();
    expect(await page.evaluate(() => window.__starwake!.story().active.map((a) => a.id))).toEqual([]);
    await bar.getByRole('button', { name: /^Accept/ }).click();
    await page.locator('.sw-dialog').getByRole('button', { name: /^Confirm/ }).click();
    await expect.poll(() => page.evaluate(() => window.__starwake!.story().active.map((a) => a.id))).toEqual(['n1-commission']);
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('planet-screen')).toBeVisible();
    await page.keyboard.press('KeyK');
    const leads = page.getByTestId('log-leads');
    await expect(leads).toContainText('The Commission: Ferry the two cadets to Vanterre.');
    await expect(leads).toContainText('for Commander Idris Hale');
    expect(errors).toEqual([]);
  });

  test('a forced N6L outcome recolours brannock on the Star Map', async ({ page }) => {
    const errors = trackErrors(page);
    await newPilot(page, 'Mapper');
    await page.evaluate(() => {
      const h = window.__starwake!;
      h.controller.world = { ...h.controller.world, known: [...new Set([...h.controller.world.known, 'brannock', 'calder'])] };
    });
    await leavePlanet(page);
    const fill = (id: string) => page.evaluate((sid) => document.querySelector<SVGElement>(`[data-system="${sid}"] .sw-map-dot`)!.style.fill, id);
    await page.keyboard.press('KeyN');
    await expect(page.getByTestId('star-map')).toBeVisible();
    const concord = await fill('calder');
    expect(await fill('brannock')).not.toBe(concord);
    await page.keyboard.press('KeyN');
    await page.evaluate(() => window.__starwake!.applyOutcomesNow([{ type: 'government', system: 'brannock', government: 'concord' }]));
    await page.keyboard.press('KeyN');
    await expect(page.getByTestId('star-map')).toBeVisible();
    expect(await fill('brannock')).toBe(concord);
    expect(errors).toEqual([]);
  });
});
