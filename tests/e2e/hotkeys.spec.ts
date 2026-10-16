import { expect, test, type Page } from '@playwright/test';
import { leavePlanet, newPilot, trackErrors } from './helpers';

const speed = (page: Page) =>
  page.evaluate(() => {
    const v = window.__starwake!.world().ship.vel;
    return Math.hypot(v.x, v.y);
  });

async function openControls(page: Page) {
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('pause-menu')).toBeVisible();
  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(page.getByTestId('settings-screen')).toBeVisible();
  await page.getByRole('tab', { name: 'Controls' }).click();
}

test('rebinding hotkeys: live, persisted, swap, reset', async ({ page }) => {
  const errors = trackErrors(page);
  await newPilot(page);
  await leavePlanet(page);
  await page.waitForTimeout(200);

  await openControls(page);
  await page.getByTestId('slot-thrust-0').click();
  await expect(page.getByText('Press a key… (Esc to cancel)')).toBeVisible();
  await page.keyboard.press('KeyW');
  await expect(page.getByTestId('slot-thrust-0')).toHaveText(/W/);

  // close settings -> pause menu -> resume; W thrusts
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await page.getByRole('button', { name: /^Resume/ }).click();
  await page.waitForFunction(() => window.__starwake!.controller.isFlying);
  expect(await speed(page)).toBe(0);
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(800);
  await page.keyboard.up('KeyW');
  expect(await speed(page)).toBeGreaterThan(50);

  // persisted across reload
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('starwake.settings')!).bindings.thrust);
  expect(saved).toEqual(['KeyW', null]);
  await page.reload();
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('tab', { name: 'Controls' }).click();
  await expect(page.getByTestId('slot-thrust-0')).toHaveText(/W/);

  // conflict + swap: Land -> J
  await page.getByTestId('slot-land-0').click();
  await page.keyboard.press('KeyJ');
  await expect(page.getByText('J is already used by Hyperspace jump. Swap?')).toBeVisible();
  await page.getByRole('button', { name: 'Swap' }).click();
  await expect(page.getByTestId('slot-land-0')).toHaveText(/J/);
  await expect(page.getByTestId('slot-jump-0')).toHaveText(/L/);

  // reset with confirm
  await page.getByRole('button', { name: 'Reset to defaults' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Reset' }).click();
  await expect(page.getByTestId('slot-thrust-0')).toHaveText(/↑/);
  await expect(page.getByTestId('slot-thrust-1')).toHaveText(/—/);
  await expect(page.getByTestId('slot-land-0')).toHaveText(/L/);

  expect(errors).toEqual([]);
});
