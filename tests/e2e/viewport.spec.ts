import { expect, test } from '@playwright/test';
import { leavePlanet, newPilot } from './helpers';

// Owner report (iPhone, Chrome): after clicking around a planet screen and leaving, the ship sat at the
// bottom of the screen and could not be recentred. iPhone browsers can zoom or scroll the page under a
// planet screen; the game canvas swallows gestures, so the page must be put back for the player.

test.use({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true });

test('the page cannot zoom: locked viewport and no double-tap zoom on screens', async ({ page }) => {
  await newPilot(page);
  const meta = await page.locator('meta[name="viewport"]').getAttribute('content');
  expect(meta).toContain('maximum-scale=1');
  expect(meta).toContain('user-scalable=no');
  const ta = await page.evaluate(() => getComputedStyle(document.getElementById('ui')!).touchAction);
  expect(ta).toBe('manipulation');
});

for (const port of ['halcyon', 'brigg-station']) {
  test(`a page scrolled under the ${port} screen is put back on leaving, with the ship centred`, async ({ page }) => {
    await newPilot(page);
    await page.evaluate((p) => window.__starwake!.teleport(p), port);
    await expect(page.getByTestId('planet-screen')).toBeVisible();
    // Displace the page as iOS can: make it scrollable and scroll it.
    await page.evaluate(() => {
      const tall = document.createElement('div');
      tall.id = 'tall-probe';
      tall.style.cssText = 'position:absolute;top:0;left:0;width:1px;height:3000px;';
      document.body.append(tall);
      document.documentElement.style.overflow = 'auto';
      document.body.style.overflow = 'auto';
      window.scrollTo(0, 300);
    });
    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
    await leavePlanet(page);
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
    const r = await page.evaluate(() => {
      const cam = window.__starwake!.cameraViewport!();
      const c = document.querySelector('canvas')!.getBoundingClientRect();
      return { camCy: c.y + cam.y + cam.h / 2, winCy: innerHeight / 2 };
    });
    // The ship (camera centre) sits at the vertical centre of the screen.
    expect(Math.abs(r.camCy - r.winCy)).toBeLessThanOrEqual(2);
  });
}
