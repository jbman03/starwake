import { expect, test, type Page } from '@playwright/test';
import { newPilot, trackErrors } from './helpers';

/** Adds a bar offer at Halcyon through the dev test hook (data/story.json ships empty until the content task). */
async function injectOffer(page: Page): Promise<void> {
  await page.evaluate(() => {
    const h = window.__starwake!;
    h.data.story['e2e-fixture'] = {
      id: 'e2e-fixture',
      arc: 'side',
      title: 'A Quiet Errand',
      giver: { name: 'Ansel Voss', title: 'Dockmaster' },
      offer: { where: 'bar', ports: ['halcyon'] },
      text: 'I need a pilot who can keep a secret and a schedule. The pay is fair and the route is short.',
      acceptText: 'Good. Fly steady and tell no one at the other end who sent you.',
      declinable: true,
      steps: [{ kind: 'land', planet: 'merrow', text: 'Land at Merrow.' }],
      onComplete: [],
    };
  });
}

test.describe('desktop', () => {
  test.use({ viewport: { width: 1280, height: 720 } });

  test('B opens the bar at Halcyon: gossip is shown, an offer can be taken, Esc returns to the planet screen', async ({ page }) => {
    const errors = trackErrors(page);
    await newPilot(page, 'Barfly');
    await injectOffer(page);
    await page.keyboard.press('KeyB');
    const bar = page.getByTestId('bar');
    await expect(bar).toBeVisible();
    await expect(bar.getByTestId('bar-gossip')).toContainText('Gossip');
    await expect(bar.getByTestId('bar-gossip')).toContainText('terraced orchards');
    expect(await page.evaluate(() => window.__starwake!.storyOffers().map((d) => d.id))).toEqual(['e2e-fixture']);
    await expect(bar.locator('.sw-mc-row')).toContainText('A Quiet Errand');
    await page.keyboard.press('Enter');
    await expect(bar.getByTestId('bar-detail')).toContainText('tell no one');
    expect(await page.evaluate(() => window.__starwake!.story().active.map((a) => a.id))).toEqual(['e2e-fixture']);
    await page.keyboard.press('Escape');
    await expect(bar).toBeHidden();
    await expect(page.getByTestId('planet-screen')).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('an empty bar still shows gossip', async ({ page }) => {
    const errors = trackErrors(page);
    await newPilot(page, 'Quiet');
    await page.keyboard.press('KeyB');
    const bar = page.getByTestId('bar');
    await expect(bar).toBeVisible();
    await expect(bar.getByTestId('bar-list')).toContainText('Nobody here');
    await expect(bar.getByTestId('bar-gossip')).toContainText('Gossip');
    expect(errors).toEqual([]);
  });
});

test.describe('phone', () => {
  test.use({ hasTouch: true, viewport: { width: 844, height: 390 } });

  test('the bar fits 844x390: every control sits inside the viewport', async ({ page }) => {
    const errors = trackErrors(page);
    await newPilot(page, 'Phone Barfly');
    await injectOffer(page);
    await page.getByRole('button', { name: /^Spaceport Bar/ }).tap();
    const bar = page.getByTestId('bar');
    await expect(bar).toBeVisible();
    const vp = page.viewportSize()!;
    const overflow = await page.evaluate(() => {
      const node = document.querySelector<HTMLElement>('[data-testid="bar"]')!;
      return { doc: document.scrollingElement!.scrollWidth - window.innerWidth, node: node.scrollWidth - node.clientWidth };
    });
    expect(overflow.doc).toBeLessThanOrEqual(0);
    expect(overflow.node).toBeLessThanOrEqual(0);
    const targets = bar.locator('button:visible, .sw-mc-row');
    const n = await targets.count();
    expect(n).toBeGreaterThanOrEqual(5); // Map, Accept, Decline, Done, one contact row
    for (let i = 0; i < n; i++) {
      const b = (await targets.nth(i).boundingBox())!;
      const name = await targets.nth(i).textContent();
      expect(b.x, `${name} left`).toBeGreaterThanOrEqual(0);
      expect(b.y, `${name} top`).toBeGreaterThanOrEqual(0);
      expect(b.x + b.width, `${name} right`).toBeLessThanOrEqual(vp.width);
      expect(b.y + b.height, `${name} bottom`).toBeLessThanOrEqual(vp.height);
      expect(b.height, `${name} height`).toBeGreaterThanOrEqual(44);
    }
    await expect(bar.getByTestId('bar-gossip')).toBeVisible();
    await page.screenshot({ path: '.superpowers/sdd/2026-10-22-starwake-story-engine/task-4-bar-phone.png' });
    await bar.getByRole('button', { name: /^Accept/ }).tap();
    await expect(bar.getByTestId('bar-detail')).toContainText('tell no one');
    await bar.getByRole('button', { name: /^Done/ }).tap();
    await expect(page.getByTestId('planet-screen')).toBeVisible();
    expect(errors).toEqual([]);
  });
});
