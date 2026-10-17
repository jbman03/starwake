import { expect, test, type Page } from '@playwright/test';
import { leavePlanet, newPilot, trackErrors } from './helpers';

const SHOTS = '.superpowers/sdd/2026-10-17-starwake-beginner-guide';
const htp = (page: Page) => page.getByTestId('how-to-play');

test.describe('desktop', () => {
  test.use({ viewport: { width: 1280, height: 720 } });

  test('opens from the main menu, the pause menu and the planet screen (H), and closes back to each', async ({ page }) => {
    const errors = trackErrors(page);
    await page.goto('/?test');
    await page.getByTestId('main-menu').waitFor();

    // Main menu: button, then H.
    await page.getByRole('button', { name: /^How to Play/ }).click();
    await expect(htp(page)).toBeVisible();
    await expect(htp(page).getByRole('button', { name: 'Replay first flight' })).toBeDisabled();
    await expect(htp(page)).toContainText('Load a pilot first');
    await htp(page).getByRole('button', { name: /^Back/ }).click();
    await expect(page.getByTestId('main-menu')).toBeVisible();
    await page.keyboard.press('KeyH');
    await expect(htp(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('main-menu')).toBeVisible();

    // Planet screen: H, then Esc closes back to the same planet.
    await newPilot(page);
    await page.keyboard.press('KeyH');
    await expect(htp(page)).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/howtoplay-desktop.png` });
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('planet-screen')).toBeVisible();
    await page.getByRole('button', { name: /^How to Play/ }).click();
    await expect(htp(page)).toBeVisible();
    await htp(page).getByRole('button', { name: /^Back/ }).click();
    await expect(page.getByTestId('planet-screen')).toBeVisible();

    // Pause menu, in flight.
    await leavePlanet(page);
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('pause-menu')).toBeVisible();
    await page.getByRole('button', { name: /^How to Play/ }).click();
    await expect(htp(page)).toBeVisible();
    await htp(page).getByRole('button', { name: /^Back/ }).click();
    await expect(page.getByTestId('pause-menu')).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('every tab shows text, and Controls reflects a rebound key', async ({ page }) => {
    const errors = trackErrors(page);
    await page.goto('/?test');
    await page.evaluate(() =>
      localStorage.setItem('starwake.settings', JSON.stringify({ bindings: { thrust: ['KeyW', null], land: ['KeyL', 'KeyQ'] } })),
    );
    await page.reload();
    await page.getByRole('button', { name: /^How to Play/ }).click();
    for (const name of ['Flying', 'Planets & trade', 'Missions', 'Travel & fuel']) {
      await htp(page).getByRole('tab', { name }).click();
      await expect(page.getByRole('tabpanel')).not.toBeEmpty();
    }
    await htp(page).getByRole('tab', { name: 'Controls' }).click();
    await expect(page.getByTestId('keys-thrust')).toHaveText('W');
    await expect(page.getByTestId('keys-land')).toHaveText('L / Q');
    await expect(page.getByTestId('keys-howToPlay')).toHaveText('H');
    await expect(page.getByTestId('keys-fireSecondary')).toHaveText('Left Shift / Right Shift');
    expect(errors).toEqual([]);
  });

  test('Replay first flight from Halcyon shows the step 1 hint', async ({ page }) => {
    const errors = trackErrors(page);
    await newPilot(page, 'Replayer'); // guide offered and skipped
    expect(await page.evaluate(() => window.__starwake!.controller.guide?.current() ?? null)).toBeNull();
    await page.keyboard.press('KeyH');
    await htp(page).getByRole('button', { name: 'Replay first flight' }).click();
    await expect(htp(page)).toContainText('The guide starts again at step 1');
    await htp(page).getByRole('button', { name: /^Back/ }).click();
    const planet = page.getByTestId('planet-screen');
    await expect(planet).toBeVisible();
    await expect(planet.getByTestId('guide-text')).toHaveText('Welcome to Halcyon. Open the Commodity Exchange (C).');
    expect(errors).toEqual([]);
  });
});

test.describe('phone (touch, landscape)', () => {
  test.use({ hasTouch: true, viewport: { width: 844, height: 390 } });

  test('How to Play fits 844×390 on every tab with buttons of at least 44 px', async ({ page }) => {
    const errors = trackErrors(page);
    await newPilot(page, 'Thumbs');
    await page.getByRole('button', { name: /^How to Play/ }).tap();
    await expect(htp(page)).toBeVisible();
    for (const name of ['Flying', 'Planets & trade', 'Missions', 'Travel & fuel', 'Controls']) {
      await htp(page).getByRole('tab', { name }).tap();
      const m = await page.evaluate(() => {
        const panel = document.querySelector<HTMLElement>('[data-testid="how-to-play"] .sw-panel')!;
        const r = panel.getBoundingClientRect();
        return {
          docW: document.documentElement.scrollWidth,
          vw: window.innerWidth,
          panelScroll: panel.scrollWidth - panel.clientWidth,
          bodyScroll: (() => {
            const b = document.querySelector<HTMLElement>('.sw-htp-body')!;
            return b.scrollWidth - b.clientWidth;
          })(),
          left: r.left,
          right: r.right,
          bottom: r.bottom,
          vh: window.innerHeight,
        };
      });
      expect(m.docW, `${name}: page scrolls sideways`).toBeLessThanOrEqual(m.vw);
      expect(m.panelScroll, `${name}: panel scrolls sideways`).toBeLessThanOrEqual(0);
      expect(m.bodyScroll, `${name}: tab body scrolls sideways`).toBeLessThanOrEqual(0);
      expect(m.left).toBeGreaterThanOrEqual(0);
      expect(m.right).toBeLessThanOrEqual(m.vw);
      expect(m.bottom).toBeLessThanOrEqual(m.vh);
      const buttons = htp(page).locator('button:visible');
      for (let i = 0; i < (await buttons.count()); i++) {
        const b = (await buttons.nth(i).boundingBox())!;
        const label = await buttons.nth(i).innerText();
        expect(b.height, `${name}: "${label}" is ${b.height}px tall`).toBeGreaterThanOrEqual(44);
      }
      if (name === 'Controls') await page.screenshot({ path: `${SHOTS}/howtoplay-phone.png` });
    }
    // Back is reachable without scrolling the page.
    const back = htp(page).getByRole('button', { name: /^Back/ });
    await expect(back).toBeInViewport();
    await back.tap();
    await expect(page.getByTestId('planet-screen')).toBeVisible();
    expect(errors).toEqual([]);
  });
});
