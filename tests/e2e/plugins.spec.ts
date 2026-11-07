import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { trackErrors } from './helpers';

// Plug-ins (editor spec, Part A): import a plug-in file on the Plug-ins screen, restart, and its ship is in the game.

const ships = JSON.parse(readFileSync(new URL('../../data/ships.json', import.meta.url), 'utf8')) as { id: string }[];
const kestrel = ships.find((s) => s.id === 'kestrel')!;
const pack = (ship: Record<string, unknown>) =>
  Buffer.from(JSON.stringify({ format: 'starwake-plugin', formatVersion: 1, id: 'e2e-pack', name: 'E2E Pack', version: '1.0', author: 'Tester', description: 'A test ship.', data: { ships: [ship] } }));

test.use({ viewport: { width: 1280, height: 800 } });

test('import a plug-in, restart, and its ship is in the game; a broken one is refused', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/?test');
  await page.getByRole('button', { name: 'Plug-ins' }).click();
  const screen = page.getByTestId('plugins-screen');
  await expect(screen).toContainText('No plug-ins yet');

  await page.getByTestId('plugin-file').setInputFiles({ name: 'bad.starwake.json', mimeType: 'application/json', buffer: pack({ ...kestrel, id: 'broken-hull', maxSpeed: -1 }) });
  await expect(page.getByTestId('plugin-status')).toContainText('would not load');
  await expect(screen).toContainText('No plug-ins yet');

  await page.getByTestId('plugin-file').setInputFiles({ name: 'good.starwake.json', mimeType: 'application/json', buffer: pack({ ...kestrel, id: 'e2e-falcon', name: 'E2E Falcon' }) });
  await expect(page.getByTestId('plugin-status')).toContainText('Installed E2E Pack');
  await expect(page.locator('[data-plugin="e2e-pack"]')).toContainText('adds 1 ship');
  await expect(page.locator('[data-plugin="e2e-pack"] [data-testid="plugin-state"]')).toHaveText('On: restart to load it');

  await page.reload();
  expect(await page.evaluate(() => window.__starwake!.data.ships['e2e-falcon']?.name)).toBe('E2E Falcon');
  await page.getByRole('button', { name: 'Plug-ins' }).click();
  await expect(page.locator('[data-plugin="e2e-pack"] [data-testid="plugin-state"]')).toHaveText('Active');

  await page.locator('[data-plugin="e2e-pack"]').getByRole('button', { name: 'Turn off' }).click();
  await expect(page.getByRole('button', { name: /^Restart now/ })).toBeVisible();
  await page.getByRole('button', { name: /^Restart now/ }).click();
  await expect.poll(() => page.evaluate(() => !!window.__starwake?.data.ships['e2e-falcon'])).toBe(false);
  expect(errors).toEqual([]);
});

test('the Editor: copy a ship, change it, see problems live, install it, and it is in the game', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/editor.html');
  await expect(page.getByTestId('editor')).toContainText('Starwake Editor');
  await page.getByTestId('editor-copy-from').selectOption('kestrel');
  await expect(page.locator('[data-record="kestrel-2"]')).toBeVisible();
  // The form edits simple fields; the name change shows in the record list.
  await page.getByTestId('editor-form').locator('[data-field="name"]').fill('Form Kestrel');
  await expect(page.locator('[data-record="kestrel-2"]')).toContainText('Form Kestrel');
  await page.locator('[data-view="json"]').click();
  const json = page.getByTestId('editor-json');
  const rec = JSON.parse(await json.inputValue()) as Record<string, unknown>;

  // A broken value shows a problem at once, and Install refuses.
  await json.fill(JSON.stringify({ ...rec, maxSpeed: -10 }, null, 2));
  await expect(page.getByTestId('editor-issues')).toContainText('ships.json');
  await page.getByRole('button', { name: 'Install in the game' }).click();
  await expect(page.getByTestId('editor-status')).toContainText('Fix the problems first');

  await json.fill(JSON.stringify({ ...rec, id: 'editor-hawk', name: 'Editor Hawk', price: 75000 }, null, 2));
  await expect(page.getByTestId('editor-issues')).toContainText('this plug-in would load');
  await expect(page.locator('[data-record="editor-hawk"]')).toBeVisible();
  await page.getByTestId('editor-name').fill('Hawk Pack');
  await page.getByRole('button', { name: 'Install in the game' }).click();
  await expect(page.getByTestId('editor-status')).toContainText('Installed Hawk Pack');

  // The draft is kept: a reload shows the same record.
  await page.reload();
  await expect(page.locator('[data-record="editor-hawk"]')).toBeVisible();

  await page.goto('/?test');
  await expect.poll(() => page.evaluate(() => window.__starwake?.data.ships['editor-hawk']?.name ?? null)).toBe('Editor Hawk');
  expect(errors).toEqual([]);
});

test('the Editor opens the sample plug-in, and its map draws a lane', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/editor.html');
  await page.getByRole('button', { name: 'Load the sample' }).click();
  await expect(page.getByTestId('editor-status')).toContainText('Opened the sample');
  await expect(page.getByTestId('editor-issues')).toContainText('this plug-in would load');
  const map = page.getByTestId('editor-map');
  await expect(map.locator('[data-system="thornwick"]')).toBeVisible();
  // Thornwick is selected: clicking Vesk adds a lane both ways.
  await map.locator('[data-system="vesk"]').click();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('starwake-editor-draft')!).data.systems.find((s: { id: string }) => s.id === 'thornwick').links)).toContain('vesk');
  expect(errors).toEqual([]);
});

