import { expect, test, type Page } from '@playwright/test';
import { leavePlanet, newPilot, quietSky, shootUntilDisabled, trackErrors, waitForFlight, weaken } from './helpers';

// Law, contraband scans and faction ranks (cycle 5). Pilots start at Halcyon in Calder, a Concord system. Each test
// that meets a patrol clears the sky first (quietSky) and puts one Concord patrol 400 px ahead (spawnPatrol): inside
// its scan and hail ranges, so the law's own rules decide whether it scans or hails. Pilots are calm (no raiders),
// so no demand takes the hail slot. Heat, cargo and rank points are set with the test hook where play would be slow;
// every choice is a real key press, click or tap.

const spawnPatrol = (page: Page) => page.evaluate(() => window.__starwake!.spawnPatrol());
const heatOf = (page: Page, gov: string) => page.evaluate((g) => window.__starwake!.world().law[g]?.heat ?? 0, gov);
const credits = (page: Page) => page.evaluate(() => window.__starwake!.world().credits);
const cargo = (page: Page) => page.evaluate(() => ({ ...window.__starwake!.world().cargo }));
/** "1,200 cr" → 1200. */
const crIn = (text: string | null) => Number(/([\d,]+) cr/.exec(text ?? '')![1].replace(/,/g, ''));

/** The law line as the PC sidebar drew it last frame, or null while it is not shown. */
const sidebarLaw = (page: Page) =>
  page.evaluate(() => {
    const s = window.__starwake!.sidebar?.();
    return s?.visible ? (s.drawn.find((b) => b.name === 'law')?.text ?? null) : null;
  });

/** Test-only: set the catch chance of patrol scans (1: every scan finds the goods, 0: none does). */
const setCatchChance = (page: Page, p: number) =>
  page.evaluate((x) => {
    window.__starwake!.controller.data.law.catchChance = x;
  }, p);

test.describe('desktop', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('attack a Concord patrol until Wanted; the next visit its law hail comes, Pay fine ends Clean', async ({ page }) => {
    test.setTimeout(120_000);
    const errors = trackErrors(page);
    await newPilot(page, 'Outlaw', false, true);
    await leavePlanet(page);
    await quietSky(page);
    await expect.poll(() => sidebarLaw(page)).toBe('Law: Clean');

    // Tab targets the only ship about, the patrol; Space shoots her until she is disabled.
    const id = await spawnPatrol(page);
    await page.keyboard.press('Tab');
    await expect.poll(() => page.evaluate(() => window.__starwake!.controller.traffic.targetId)).toBe(id);
    await weaken(page, id);
    await shootUntilDisabled(page, id, () => page.keyboard.press('Space', { delay: 50 }));
    // First hit +10, disabling +20: Wanted (30–59), not Hunted.
    await expect.poll(() => heatOf(page, 'concord')).toBe(30);
    await expect.poll(() => sidebarLaw(page)).toBe('Law: Wanted');

    // Land and take off again: a new visit, so the Concord's anger from the fight is over, and its law hails.
    await page.evaluate(() => window.__starwake!.teleport('halcyon'));
    await expect(page.getByTestId('planet-screen')).toBeVisible();
    await quietSky(page); // before take-off too: no other patrol may hail first
    await leavePlanet(page);
    await quietSky(page);
    const hailer = await spawnPatrol(page);
    await expect.poll(() => page.evaluate(() => window.__starwake!.hudHail!())).toMatch(/hails you \(Y to answer\)$/);
    expect(await page.evaluate(() => window.__starwake!.controller.pending)).toMatchObject({ kind: 'law', reason: 'fine', npcId: hailer, gov: 'concord' });

    await page.keyboard.press('y');
    const card = page.getByTestId('encounter-card');
    await expect(card).toBeVisible();
    await expect(card).toContainText('hails you');
    await expect(card).toContainText('or we open fire');
    const pay = card.getByTestId('encounter-choice').first();
    await expect(pay).toHaveText(/^Pay fine [\d,]+ cr/);
    const fine = crIn(await pay.textContent());
    expect(fine).toBe(30 * 40); // heat × fineRate
    const before = await credits(page);
    await page.keyboard.press('1');
    await expect(card.getByTestId('encounter-outcome')).toContainText(`You pay the fine of ${fine} cr. Your record is clean.`);
    expect(await credits(page)).toBe(before - fine);
    expect(await heatOf(page, 'concord')).toBe(0);
    await card.getByRole('button', { name: /^Done/ }).click();
    await expect(card).toBeHidden();
    await waitForFlight(page);
    await expect.poll(() => sidebarLaw(page)).toBe('Law: Clean');
    expect(errors).toEqual([]);
  });

  test('the planet screen Pay fines row pays the fine and goes away', async ({ page }) => {
    const errors = trackErrors(page);
    await newPilot(page, 'Debtor', false, true);
    // Test-only: Suspect with the Concord (heat 20), then land at Halcyon, a Concord port.
    await page.evaluate(() => {
      const h = window.__starwake!;
      h.controller.world = { ...h.controller.world, law: { ...h.controller.world.law, concord: { heat: 20 } } };
      h.teleport('halcyon');
    });
    const screen = page.getByTestId('planet-screen');
    const row = screen.locator('[data-fine="concord"]');
    await expect(row).toHaveText(/^Fines owed to Concord: 800 cr/);
    const before = await credits(page);
    await row.getByRole('button', { name: 'Pay' }).click();
    await expect(row).toHaveCount(0);
    await expect(screen).toContainText('Paid 800 cr to Concord.');
    expect(await credits(page)).toBe(before - 800);
    expect(await heatOf(page, 'concord')).toBe(0);
    expect(errors).toEqual([]);
  });

  test('Concord rank 2: the pilot card shows Warden, and the Vanterre shipyard takes 5% off', async ({ page }) => {
    const errors = trackErrors(page);
    await newPilot(page, 'Climber', false, true);
    await page.evaluate(() => {
      const h = window.__starwake!;
      h.controller.world = { ...h.controller.world, credits: 500_000 };
      h.teleport('vanterre');
    });
    await expect(page.getByTestId('planet-screen')).toContainText('Vanterre');
    const list = await page.evaluate(() => window.__starwake!.data.ships.mule.price);
    const shop = page.getByTestId('shipyard');
    const price = shop.getByTestId('shipyard-info').locator('dt:text-is("Price") + dd');

    // Rank 0: the list price.
    await page.keyboard.press('KeyY');
    await expect(shop).toBeVisible();
    await shop.locator('[data-item="mule"]').click();
    await expect(price).toHaveText(`${list.toLocaleString('en-US')} cr`);
    await page.keyboard.press('Escape');
    await expect(shop).toBeHidden();

    // Test-only: 30 Concord points, rank 2 (Warden): 5% off ships and outfits at its ports.
    await page.evaluate(() => {
      const h = window.__starwake!;
      h.controller.world = { ...h.controller.world, ranks: { ...h.controller.world.ranks, concord: { points: 30, salaryDay: -1 } } };
    });
    await page.keyboard.press('KeyY');
    await expect(shop).toBeVisible();
    await shop.locator('[data-item="mule"]').click();
    const charged = Math.round(list * 0.95);
    await expect(price).toHaveText(`${charged.toLocaleString('en-US')} cr (5% Concord rank discount, list ${list.toLocaleString('en-US')} cr)`);
    expect(await page.evaluate(() => window.__starwake!.controller.shipQuote('mule').price)).toBe(charged);
    await page.keyboard.press('Escape');
    await expect(shop).toBeHidden();

    // Save here, quit to the main menu: the pilot card names the rank.
    await page.evaluate(() => window.__starwake!.controller.save());
    await leavePlanet(page);
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Quit to main menu' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Quit' }).click();
    const menu = page.getByTestId('main-menu');
    await expect(menu).toContainText('Climber');
    await expect(menu.locator('.sw-pilot-rank')).toHaveText(['Concord: Warden']);
    await expect(menu.locator('.sw-pilot-law')).toHaveCount(0); // Clean everywhere
    expect(errors).toEqual([]);
  });

  test('stims bought at a fringe port: a Concord scan in Calder, then Halcyon will not buy them', async ({ page }) => {
    test.setTimeout(90_000);
    const errors = trackErrors(page);
    await newPilot(page, 'Smuggler', false, true);
    // Brackwater (a fringe world) sells Unlicensed Stims cheap.
    await page.evaluate(() => window.__starwake!.teleport('brackwater'));
    await expect(page.getByTestId('planet-screen')).toContainText('Brackwater');
    await page.keyboard.press('KeyC');
    const ex = page.getByTestId('exchange');
    await expect(ex).toBeVisible();
    await ex.locator('tr[data-good="stims"]').click();
    await page.keyboard.press('KeyB');
    await expect(ex.getByTestId('exchange-message')).toContainText('Bought 10 t of Unlicensed Stims');
    await expect(ex.locator('tr[data-good="stims"] .sw-ex-held')).toHaveText('10 t');
    await page.keyboard.press('Escape');
    await expect(ex).toBeHidden();

    // Back to Halcyon in Calder and out into Concord space: a patrol scans the hold (this one finds nothing).
    await page.evaluate(() => window.__starwake!.teleport('halcyon'));
    await expect(page.getByTestId('planet-screen')).toContainText('Halcyon');
    await setCatchChance(page, 0);
    await quietSky(page); // before take-off too: only the test's patrol scans
    await leavePlanet(page);
    await quietSky(page);
    await spawnPatrol(page);
    await expect.poll(() => page.evaluate(() => window.__starwake!.hudMessage!()), { intervals: [100] }).toBe('Scan complete. Fly safe.');
    expect(await page.evaluate(() => window.__starwake!.controller.pending)).toBeNull();
    expect((await cargo(page)).stims).toBe(10);

    // Land at Halcyon: the Concord does not trade stims, so the exchange will not buy them.
    await page.evaluate(() => window.__starwake!.teleport('halcyon'));
    await expect(page.getByTestId('planet-screen')).toContainText('Halcyon');
    await page.keyboard.press('KeyC');
    await expect(ex).toBeVisible();
    const row = ex.locator('tr[data-good="stims"]');
    await expect(row.locator('.sw-ex-held')).toHaveText('10 t');
    await expect(row.locator('.sw-ex-price')).toHaveText('Not traded');
    await row.click();
    const before = await credits(page);
    await page.keyboard.press('KeyS');
    await expect(ex.getByTestId('exchange-message')).toHaveText('Outlawed here: the Concord does not trade it');
    expect(await credits(page)).toBe(before);
    expect((await cargo(page)).stims).toBe(10);
    expect(errors).toEqual([]);
  });

  test('the sidebar fits a short 1280×600 window: law line drawn, nothing overlaps, Map button inside', async ({ page }) => {
    const errors = trackErrors(page);
    await page.setViewportSize({ width: 1280, height: 600 });
    await newPilot(page, 'Short', false, true);
    await leavePlanet(page);
    // A target fills the target lines and bars too.
    await quietSky(page);
    await spawnPatrol(page);
    await page.keyboard.press('Tab');
    await expect.poll(() => page.evaluate(() => window.__starwake!.sidebar?.().drawn.find((b) => b.name === 'target')?.text ?? '')).toContain('Test Patrol');
    const s = await page.evaluate(() => window.__starwake!.sidebar!());
    expect(s.visible).toBe(true);
    expect(s.drawn.find((b) => b.name === 'law')?.text).toBe('Law: Clean');
    const names = s.drawn.map((b) => b.name);
    expect(names).toEqual(expect.arrayContaining(['radar', 'nav', 'law', 'target', 'targetDetail', 'targetBars', 'cargo', 'credits', 'date', 'map']));
    for (const b of s.drawn) {
      expect(b.top, `${b.name} top`).toBeGreaterThanOrEqual(0);
      expect(b.bottom, `${b.name} bottom`).toBeLessThanOrEqual(600);
    }
    for (let i = 1; i < s.drawn.length; i++) {
      expect(s.drawn[i].top, `${s.drawn[i].name} starts below ${s.drawn[i - 1].name}`).toBeGreaterThanOrEqual(s.drawn[i - 1].bottom);
    }
    expect(errors).toEqual([]);
  });
});

test.describe('phone', () => {
  test.use({ hasTouch: true, viewport: { width: 844, height: 390 } });

  test('stims in Concord space: a patrol scans, the context button opens the card, Comply takes the cargo and the fine', async ({ page }) => {
    test.setTimeout(90_000);
    const errors = trackErrors(page);
    await newPilot(page, 'Mule Thumb', false, true);
    // Test-only: 2 t of Unlicensed Stims in the hold, and every scan finds them.
    await page.evaluate(() => {
      const h = window.__starwake!;
      h.controller.world = { ...h.controller.world, cargo: { ...h.controller.world.cargo, stims: 2 } };
    });
    await setCatchChance(page, 1);
    await quietSky(page); // before take-off too: only the test's patrol scans
    await page.getByRole('button', { name: /^Leave/ }).tap();
    await waitForFlight(page);
    await page.touchscreen.tap(422, 30); // touch mode: rails on
    await expect(page.getByTestId('touch-rails')).toBeVisible();
    await quietSky(page);
    // A planet is targeted: a law hail still outranks Land on the button (Ruling 15).
    await page.evaluate(() => {
      const h = window.__starwake!;
      h.controller.world = { ...h.controller.world, targetPlanetId: 'halcyon' };
    });
    const id = await spawnPatrol(page);

    const ctxBtn = page.getByTestId('context-button');
    await expect(ctxBtn).toHaveText('Answer hail');
    expect(await page.evaluate(() => window.__starwake!.controller.pending)).toMatchObject({ kind: 'law', reason: 'scan', npcId: id, gov: 'concord' });
    await ctxBtn.tap();
    const card = page.getByTestId('encounter-card');
    await expect(card).toBeVisible();
    await expect(card).toContainText('scans your hold');
    await expect(card).toContainText('2 t of Unlicensed Stims');
    const comply = card.getByTestId('encounter-choice').first();
    await expect(comply).toHaveText(/^Comply \(fine [\d,]+ cr\)/);
    const fine = crIn(await comply.textContent());
    expect(fine).toBe(2 * 100); // contrabandFine per ton
    const before = await credits(page);
    await comply.tap();
    await expect(card.getByTestId('encounter-outcome')).toContainText(`confiscates 2 t of contraband. You pay a fine of ${fine} cr.`);
    expect((await cargo(page)).stims ?? 0).toBe(0);
    expect(await credits(page)).toBe(before - fine);
    expect(await heatOf(page, 'concord')).toBe(15); // caught with contraband: Suspect
    await card.getByRole('button', { name: /^Done/ }).tap();
    await expect(card).toBeHidden();
    await waitForFlight(page);
    await expect(ctxBtn).not.toHaveText('Answer hail');
    expect(errors).toEqual([]);
  });
});
