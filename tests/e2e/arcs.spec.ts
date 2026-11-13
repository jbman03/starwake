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

test.describe('desktop, part 2', () => {
  test.use({ viewport: { width: 1280, height: 720 } });

  test('take the Reach commission at Dunmore Crossing: confirm, then the Leads log shows the ferry to Redwater Sound', async ({ page }) => {
    const errors = trackErrors(page);
    await newPilot(page, 'Hand');
    await page.evaluate(() => window.__starwake!.teleport('dunmore-crossing'));
    await expect(page.getByTestId('planet-screen')).toContainText('Dunmore Crossing');
    await page.keyboard.press('KeyB');
    const bar = page.getByTestId('bar');
    await bar.locator('.sw-mc-row', { hasText: 'A Free Hand' }).click();
    await bar.getByRole('button', { name: /^Accept/ }).click();
    await page.locator('.sw-dialog').getByRole('button', { name: /^Confirm/ }).click();
    await expect.poll(() => page.evaluate(() => window.__starwake!.story().active.map((a) => a.id))).toEqual(['rr1-free-hand']);
    await page.keyboard.press('Escape');
    await page.keyboard.press('KeyK');
    await expect(page.getByTestId('log-leads')).toContainText('A Free Hand: Ferry the three organisers to Redwater Sound.');
    expect(errors).toEqual([]);
  });

  test('a Part 1 save of an exposed Navy pilot loads with Running Dark offered at Dunmore Crossing, as a Free Reach Rising pilot', async ({ page }) => {
    const errors = trackErrors(page);
    await newPilot(page, 'Turncoat');
    await page.evaluate(async () => {
      const h = window.__starwake!;
      h.controller.world = { ...h.controller.world, flags: [...h.controller.world.flags, 'arc:navy', 'navy-exposed'], arcPoints: { navy: 50 } };
      await h.controller.save();
    });
    await page.reload();
    await page.getByRole('button', { name: /^Load/ }).first().click();
    await expect(page.getByTestId('planet-screen')).toBeVisible();
    expect(await page.evaluate(() => window.__starwake!.controller.world.flags.includes('arc:rising'))).toBe(true);
    await page.evaluate(() => window.__starwake!.teleport('dunmore-crossing'));
    await page.keyboard.press('KeyB');
    await expect(page.getByTestId('bar').locator('.sw-mc-row', { hasText: 'Running Dark' })).toBeVisible();
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    expect(errors).toEqual([]);
  });

  test('a forced switchArc shows Free Reach Rising on the pilot card', async ({ page }) => {
    const errors = trackErrors(page);
    await newPilot(page, 'Switcher');
    await page.evaluate(async () => {
      const h = window.__starwake!;
      h.applyOutcomesNow([{ type: 'flag', flag: 'arc:navy' }, { type: 'switchArc', to: 'rising' }]);
      await h.controller.save();
    });
    await page.reload();
    await expect(page.locator('.sw-pilots')).toContainText('Free Reach Rising: Hand');
    expect(errors).toEqual([]);
  });
});
