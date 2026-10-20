import { expect, test, type Page } from '@playwright/test';
import { newPilot, trackErrors, waitForFlight } from './helpers';

type Rect = { x: number; y: number; w: number; h: number };
const intersects = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const SHOTS = '.superpowers/sdd/2026-10-17-starwake-beginner-guide';

/** The step the guide is on (null when finished or not started). */
const step = (page: Page) => page.evaluate(() => window.__starwake!.controller.guide?.current()?.step ?? null);

/** The hint text on the open screen's callout card. */
async function screenHint(page: Page): Promise<string> {
  const text = page.locator('[data-testid="guide-hint"]:visible [data-testid="guide-text"]');
  await expect(text).toBeVisible();
  return (await text.textContent()) ?? '';
}

/** The hint text in the desktop flight HUD, once it shows `pattern`. */
async function hudHint(page: Page, pattern: RegExp): Promise<string> {
  await expect.poll(() => page.evaluate(() => window.__starwake!.hudGuide?.()?.text ?? ''), { timeout: 15_000 }).toMatch(pattern);
  return page.evaluate(() => window.__starwake!.hudGuide!()!.text);
}

const idOf = (page: Page, kind: 'commodities' | 'systems' | 'planets', name: string) =>
  page.evaluate(
    ([k, n]) => Object.values(window.__starwake!.data[k as 'systems']).find((x) => x.name === n)?.id ?? null,
    [kind, name] as const,
  );

test.describe('desktop', () => {
  test.use({ viewport: { width: 1280, height: 720 } });

  test('a new pilot follows the guide with real controls, from Halcyon to "Nice trade" with a profit', async ({ page }) => {
    test.setTimeout(90_000);
    const errors = trackErrors(page);
    await newPilot(page, 'Guided', true);

    // 1: welcome callout inside the planet panel, above its buttons.
    const planet = page.getByTestId('planet-screen');
    expect(await screenHint(page)).toBe('Welcome to Halcyon. Open the Commodity Exchange (C).');
    const card = planet.getByTestId('guide-hint');
    const firstButton = planet.getByRole('button', { name: /^Commodity Exchange/ });
    expect((await card.boundingBox())!.y).toBeLessThan((await firstButton.boundingBox())!.y);
    await page.screenshot({ path: `${SHOTS}/guide-planet.png` });
    await page.keyboard.press('KeyC');

    // 2: buy the named good.
    const ex = page.getByTestId('exchange');
    await expect(ex).toBeVisible();
    const buy = (await screenHint(page)).match(/^(.+) is cheap here\. Buy 10 t \(B\)\.$/);
    expect(buy).not.toBeNull();
    const good = (await idOf(page, 'commodities', buy![1]))!;
    expect(good).not.toBeNull();
    await ex.locator(`[data-good="${good}"]`).click();
    await page.keyboard.press('KeyB');
    await expect(ex.locator(`[data-good="${good}"] .sw-ex-held`)).toHaveText('10 t');
    const creditsAfterBuy = await page.evaluate(() => window.__starwake!.world().credits);

    // 3–5: close, mission computer, close, leave.
    await expect.poll(() => screenHint(page)).toBe('Close the exchange (Esc) and open the Mission Computer (M).');
    await page.keyboard.press('Escape');
    await expect(planet).toBeVisible();
    expect(await screenHint(page)).toBe('Open the Mission Computer (M).'); // Esc is Leave here
    await page.keyboard.press('KeyM');
    await expect(page.getByTestId('mission-computer')).toBeVisible();
    expect(await screenHint(page)).toContain('Jobs pay when you land at their destination.');
    await page.keyboard.press('Escape');
    await expect(planet).toBeVisible();
    expect(await screenHint(page)).toBe('Leave the planet (L).');
    await page.keyboard.press('KeyL');
    await waitForFlight(page);

    // 6: with the PC sidebar the status panel is gone, so the hint sits top-left, wrapped to its width.
    expect(await hudHint(page, /^Fly:/)).toBe('Fly: ↑ thrust, ← → turn, X stop.');
    const box = (await page.evaluate(() => window.__starwake!.hudGuide!()))!.skip;
    expect(box.x).toBeLessThan(40);
    expect(box.y).toBeLessThan(174);
    await page.screenshot({ path: `${SHOTS}/guide-desktop-flight.png` });
    await page.keyboard.down('ArrowUp');
    await expect.poll(() => step(page), { timeout: 20_000 }).toBe(7);
    await page.keyboard.up('ArrowUp');

    // 7: plot the course the hint names.
    const plot = (await hudHint(page, /Star Map/)).match(/set a course to (.+)\. (.+) pays well there\.$/);
    expect(plot).not.toBeNull();
    expect(await hudHint(page, /Star Map/)).toContain('Open the Star Map (N)');
    const system = (await idOf(page, 'systems', plot![1]))!;
    await page.keyboard.press('KeyM');
    const map = page.getByTestId('star-map');
    await expect(map).toBeVisible();
    expect(await screenHint(page)).toContain(`set a course to ${plot![1]}`);
    await map.locator(`[data-system="${system}"]`).click();
    await map.getByRole('button', { name: 'Set course' }).click();
    await map.getByRole('button', { name: /^Close/ }).click();
    await expect(map).toBeHidden();
    await waitForFlight(page);

    // 8: autopilot out and jump until we arrive.
    expect(await hudHint(page, /Jump/)).toContain('(G autopilot) and Jump (J)');
    while ((await page.evaluate(() => window.__starwake!.world().route.length)) > 0) {
      const pos0 = await page.evaluate(() => ({ ...window.__starwake!.world().ship.pos }));
      await page.keyboard.press('KeyG');
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

    // 9: land where the hint says.
    const land = (await hudHint(page, /^Land at/)).match(/^Land at (.+) \(Tab to target, L to land\)\.$/);
    expect(land).not.toBeNull();
    const port = (await idOf(page, 'planets', land![1]))!;
    await waitForFlight(page);
    for (let i = 0; i < 12 && (await page.evaluate(() => window.__starwake!.world().targetPlanetId)) !== port; i++) {
      await page.keyboard.press('Tab');
      await page.waitForTimeout(50);
    }
    await page.keyboard.press('KeyL');
    await expect(planet).toBeVisible({ timeout: 40_000 });

    // 10: sell all of it.
    expect(await screenHint(page)).toBe(`Open the exchange (C) and Sell all your ${buy![1]}.`);
    await page.keyboard.press('KeyC');
    await expect(ex).toBeVisible();
    await ex.locator(`[data-good="${good}"]`).click();
    await ex.getByRole('button', { name: 'Sell all' }).click();
    await expect(ex.locator(`[data-good="${good}"] .sw-ex-held`)).toHaveText('0 t');

    // 11: the profit the guide reports.
    await expect.poll(() => screenHint(page)).toMatch(/^Nice trade! You made [\d,]+ cr\./);
    const profit = Number((await screenHint(page)).match(/You made ([\d,]+) cr/)![1].replace(/,/g, ''));
    expect(profit).toBeGreaterThan(0);
    expect(await page.evaluate(() => window.__starwake!.world().credits)).toBeGreaterThan(creditsAfterBuy);
    await ex.getByRole('button', { name: 'Dismiss' }).click();
    await expect(page.locator('[data-testid="guide-hint"]:visible')).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('a reload mid-guide resumes honestly: the unsaved purchase rewinds to Buy; Skip guide asks first', async ({ page }) => {
    test.setTimeout(90_000);
    const errors = trackErrors(page);
    await newPilot(page, 'Resumer', true);
    await page.keyboard.press('KeyC');
    const goodName = (await screenHint(page)).split(' is cheap here')[0];
    const good = (await idOf(page, 'commodities', goodName))!;
    await page.getByTestId('exchange').locator(`[data-good="${good}"]`).click();
    await page.keyboard.press('KeyB');
    await expect.poll(() => step(page)).toBe(3);
    await page.keyboard.press('Escape');
    await page.keyboard.press('KeyM');
    await expect(page.getByTestId('mission-computer')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('planet-screen')).toBeVisible();
    await page.keyboard.press('KeyL');
    await waitForFlight(page);
    await expect.poll(() => step(page)).toBe(6);
    await page.keyboard.down('ArrowUp');
    await expect.poll(() => step(page), { timeout: 20_000 }).toBe(7);
    await page.keyboard.up('ArrowUp');
    const before = await page.evaluate(() => window.__starwake!.controller.guide!.target());

    await page.reload();
    await page.getByRole('button', { name: 'Load' }).click();
    await expect(page.getByTestId('planet-screen')).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0); // resumed silently, no offer
    // The pilot was last saved before the purchase (saves happen on landing): the hold is empty
    // again at Halcyon, so the guide rewinds to the Buy step instead of claiming a sale later.
    expect(await page.evaluate((g) => window.__starwake!.world().cargo[g] ?? 0, good)).toBe(0);
    expect(await step(page)).toBe(2);
    expect(await page.evaluate(() => window.__starwake!.controller.guide!.target())).toEqual(before);
    expect(await screenHint(page)).toBe(`Open the exchange (C) and buy 10 t of ${goodName}.`);

    await page.getByTestId('guide-skip').click();
    const dialog = page.getByRole('dialog', { name: 'Skip the guide?' });
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    expect(await step(page)).toBe(2);
    await page.getByTestId('guide-skip').click();
    await dialog.getByRole('button', { name: 'Skip guide' }).click();
    await expect(page.locator('[data-testid="guide-hint"]:visible')).toHaveCount(0);
    expect(await step(page)).toBeNull();
    expect(errors).toEqual([]);
  });
});

test.describe('phone (touch, landscape)', () => {
  test.use({ hasTouch: true, viewport: { width: 844, height: 390 } });
  const sizes = [[844, 390], [780, 360], [932, 430]] as const;

  /** The open screen has no horizontal scroll and its guide card is on screen with a 44 px Skip. */
  async function screenFits(page: Page, testId: string): Promise<void> {
    const screen = page.getByTestId(testId);
    await expect(screen).toBeVisible();
    const r = await screen.evaluate((el) => ({
      sw: el.scrollWidth,
      cw: el.clientWidth,
      doc: document.documentElement.scrollWidth,
      vw: window.innerWidth,
    }));
    expect(r.sw, `${testId} scrolls sideways`).toBeLessThanOrEqual(r.cw);
    expect(r.doc).toBeLessThanOrEqual(r.vw);
    const card = screen.getByTestId('guide-hint');
    await expect(card).toBeVisible();
    const b = (await card.boundingBox())!;
    expect(b.x).toBeGreaterThanOrEqual(0);
    expect(b.x + b.width).toBeLessThanOrEqual(r.vw);
    expect((await card.getByTestId('guide-skip').boundingBox())!.height).toBeGreaterThanOrEqual(44);
  }

  /** In flight the hint is inside the stick rail, off the clear region, and Stop and the stick still fit. */
  async function railHintFits(page: Page, w: number, h: number): Promise<void> {
    const rails = page.getByTestId('touch-rails');
    await expect.poll(() => rails.getAttribute('data-size')).toBe(`${w}x${h}`);
    await page.waitForTimeout(50);
    const clear = JSON.parse((await rails.getAttribute('data-clear'))!) as Rect;
    const view = JSON.parse((await rails.getAttribute('data-view'))!) as Rect;
    const hint = page.getByTestId('rail-guide');
    await expect(hint).toBeVisible();
    // Never more than the 3 lines the rail reserves.
    expect(await hint.evaluate((el) => el.scrollHeight <= el.clientHeight + 1)).toBe(true);
    const stickRail = (await page.locator('[data-rail="stick"]').boundingBox())!;
    for (const sel of ['[data-testid="rail-guide"]', '[data-control="guide-skip"]', '[data-control="stop"]', '[data-control="stick"]']) {
      const b = (await page.locator(sel).boundingBox())!;
      const box = { x: b.x, y: b.y, w: b.width, h: b.height };
      expect(intersects(box, clear), `${sel} ${JSON.stringify(box)} vs clear ${JSON.stringify(clear)}`).toBe(false);
      expect(box.x).toBeGreaterThanOrEqual(stickRail.x);
      expect(box.x + box.w).toBeLessThanOrEqual(stickRail.x + stickRail.width + 0.5);
      expect(box.y + box.h, `${sel} below the screen at ${w}×${h}`).toBeLessThanOrEqual(h);
    }
    expect(view.x).toBeGreaterThanOrEqual(stickRail.x + stickRail.width - 0.5);
    const skip = (await page.locator('[data-control="guide-skip"]').boundingBox())!;
    expect(skip.width).toBeGreaterThanOrEqual(44);
    expect(skip.height).toBeGreaterThanOrEqual(44);
    expect((await page.locator('[data-control="stop"]').boundingBox())!.height).toBeGreaterThanOrEqual(44);
    expect((await page.locator('[data-control="stick"]').boundingBox())!.height).toBeGreaterThanOrEqual(48);
    // Every rail control (the hint included) stays out of the clear region.
    const controls = page.locator('[data-rail-control]:visible');
    for (let i = 0; i < (await controls.count()); i++) {
      const b = (await controls.nth(i).boundingBox())!;
      expect(intersects({ x: b.x, y: b.y, w: b.width, h: b.height }, clear)).toBe(false);
    }
  }

  test('hints fit every screen and sit inside the left rail in flight at 844×390, 780×360 and 932×430', async ({ page }) => {
    test.setTimeout(90_000);
    const errors = trackErrors(page);
    await newPilot(page, 'Thumbs', true);

    // Screens: planet, exchange (buy once), mission computer, at each size.
    let bought = false;
    for (const [w, h] of sizes) {
      await page.setViewportSize({ width: w, height: h });
      await screenFits(page, 'planet-screen');
      await page.getByRole('button', { name: /^Commodity Exchange/ }).tap();
      await screenFits(page, 'exchange');
      if (!bought) {
        const name = (await screenHint(page)).match(/^(.+) is cheap here\. Buy 10 t\.$/)![1];
        const good = (await idOf(page, 'commodities', name))!;
        await page.getByTestId('exchange').locator(`[data-good="${good}"]`).tap();
        await page.getByRole('button', { name: /^Buy 10/ }).tap();
        await expect.poll(() => step(page)).toBe(3);
        bought = true;
      }
      await page.getByRole('button', { name: /^Done/ }).tap();
      await page.getByRole('button', { name: /^Mission Computer/ }).tap();
      await screenFits(page, 'mission-computer');
      await page.getByRole('button', { name: /^Done/ }).tap();
      await expect(page.getByTestId('planet-screen')).toBeVisible();
    }
    expect(await step(page)).toBe(5);

    // Flight: the hint moves into the stick rail.
    await page.setViewportSize({ width: 844, height: 390 });
    await page.getByRole('button', { name: /^Leave/ }).tap();
    await waitForFlight(page);
    await expect.poll(() => step(page)).toBe(6);
    await expect(page.getByTestId('touch-rails')).toBeVisible();
    await expect(page.getByTestId('rail-guide')).toHaveText('Push the stick to fly, STOP to brake.');
    expect(await page.evaluate(() => window.__starwake!.hudGuide?.() ?? null)).toBeNull(); // no desktop HUD hint
    await railHintFits(page, 844, 390);
    await page.screenshot({ path: `${SHOTS}/guide-phone-flight.png` });

    for (const [w, h] of sizes) {
      await page.setViewportSize({ width: w, height: h });
      await railHintFits(page, w, h);
      // The radar opens the star map: its callout fits too.
      await page.locator('[data-control="radar"]').tap();
      await screenFits(page, 'star-map');
      await page.getByTestId('star-map').getByRole('button', { name: /^Close/ }).tap();
      await waitForFlight(page);
    }

    // Step 7: push the stick until the ship has flown 300 px; the rail then names the destination.
    await page.setViewportSize({ width: 844, height: 390 });
    const stick = page.locator('[data-control="stick"]');
    const sb = (await stick.boundingBox())!;
    const at = { pointerId: 7, pointerType: 'touch', isPrimary: true, clientX: sb.x + sb.width / 2, clientY: sb.y + 2 };
    await stick.dispatchEvent('pointerdown', at);
    await stick.dispatchEvent('pointermove', at);
    await expect.poll(() => step(page), { timeout: 30_000 }).toBe(7);
    await stick.dispatchEvent('pointerup', at);
    const systemName = await page.evaluate(() => {
      const { controller, data } = window.__starwake!;
      return data.systems[controller.guide!.target()!.system].name;
    });
    await expect(page.getByTestId('rail-guide')).toHaveText(`Tap Map. Set course to ${systemName}.`);
    await railHintFits(page, 844, 390);

    // Skip guide in the rail asks first (flight pauses meanwhile), then the rail gives the room back.
    await page.locator('[data-control="guide-skip"]').tap();
    const dialog = page.getByRole('dialog', { name: 'Skip the guide?' });
    await expect(dialog).toBeVisible();
    expect(await page.evaluate(() => window.__starwake!.controller.isFlying)).toBe(false);
    await dialog.getByRole('button', { name: 'Skip guide' }).tap();
    await waitForFlight(page);
    await expect(page.getByTestId('rail-guide')).toBeHidden();
    await expect(page.locator('[data-control="guide-skip"]')).toBeHidden();
    expect(errors).toEqual([]);
  });
});
