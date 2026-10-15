import { expect, type Page } from '@playwright/test';

/** Collects console errors and page errors for the test to assert on at the end. */
export function trackErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(String(e)));
  return errors;
}

/** Wipe saved pilots so each test starts from an empty pilot list. */
export async function clearPilots(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        const req = indexedDB.deleteDatabase('keyval-store');
        req.onsuccess = req.onerror = req.onblocked = () => resolve();
      }),
  );
}

/** Main menu → New Pilot → name → planet screen at the start planet. */
export async function newPilot(page: Page, name = 'Test Pilot'): Promise<void> {
  await page.goto('/?test');
  await clearPilots(page);
  await page.reload();
  await page.getByRole('button', { name: 'New Pilot' }).click();
  const input = page.getByLabel('Pilot name');
  await input.fill(name);
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page.getByTestId('planet-screen')).toBeVisible();
}

/** From the planet screen, press Leave and wait for flight to resume. */
export async function leavePlanet(page: Page): Promise<void> {
  await page.getByRole('button', { name: /^Leave/ }).click();
  await expect(page.getByTestId('planet-screen')).toBeHidden();
  await page.waitForFunction(() => window.__starwake!.controller.isFlying);
}
