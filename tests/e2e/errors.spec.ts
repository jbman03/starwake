import { expect, test } from '@playwright/test';

test('a boot crash shows the crash screen with copy and reload', async ({ page }) => {
  await page.goto('/?test&crash=1');
  await expect(page.getByRole('heading', { name: 'Something went wrong' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Copy error report' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reload' })).toBeVisible();
  const report = await page.getByTestId('crash-report').inputValue();
  expect(report).toContain('Message: Test crash');
  expect(report).toContain('Version: ');
  expect(report).toContain('User agent: ');
  expect(report).toMatch(/Screen: \d+x\d+/);
});

test('invalid game data lists the offending field', async ({ page }) => {
  await page.goto('/?test&baddata=1');
  await expect(page.getByRole('heading', { name: 'Game data is invalid' })).toBeVisible();
  await expect(page.getByTestId('data-error')).toContainText('ships.json → shuttle.maxSpeed');
});

test('a normal load shows no error screen', async ({ page }) => {
  await page.goto('/?test');
  await expect(page.getByRole('button', { name: 'New Pilot' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Something went wrong' })).toHaveCount(0);
});
