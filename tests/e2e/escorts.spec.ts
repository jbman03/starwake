import { expect, test, type Page } from '@playwright/test';
import { guardPlayer, leavePlanet, newPilot, npcOf, quietSky, trackErrors, waitForFlight } from './helpers';

// Escorts (cycle 6). The scene is set up with the test hooks (a landing at Vanterre, credits, hostiles); every choice
// under test is a real key press, click or tap. Waits are state-based (expect.poll), never fixed sleeps.

const credits = (page: Page) => page.evaluate(() => window.__starwake!.world().credits);
/** "1,200 cr" → 1200. */
const crIn = (text: string | null) => Number(/([\d,]+) cr/.exec(text ?? '')![1].replace(/,/g, ''));
const escortNpcs = (page: Page) =>
  page.evaluate(() => window.__starwake!.combatState().npcs.filter((n) => n.role === 'escort'));

/** Test-only: land at Vanterre with 50 000 credits (the Tessaly bar is far from the start planet). */
async function toVanterre(page: Page): Promise<void> {
  await page.evaluate(() => {
    const h = window.__starwake!;
    h.controller.world = { ...h.controller.world, credits: 50_000 };
    h.teleport('vanterre');
  });
  await expect(page.getByTestId('planet-screen')).toContainText('Vanterre');
}

/** Hire the first offer on the planet screen with the real button. */
async function hireFirst(page: Page): Promise<void> {
  const row = page.getByTestId('hire-escorts').locator('[data-offer]').first();
  await expect(row).toBeVisible();
  await row.getByRole('button', { name: 'Hire' }).click();
  await expect(page.getByTestId('your-escorts').locator('[data-escort]')).toHaveCount(1);
}

/** Test-only: keep a ship's armor, shields and aggro out of the test's way: a tough, quiet hostile. */
async function toughen(page: Page, id: string): Promise<void> {
  await page.evaluate((i) => {
    const c = window.__starwake!.controller;
    c.traffic = {
      ...c.traffic,
      npcs: c.traffic.npcs.map((n) => (n.id === i ? { ...n, hull: { ...n.hull, shields: 5000, maxShields: 5000, armor: 5000, maxArmor: 5000 } } : n)),
    };
  }, id);
}

const holdRail = async (page: Page, control: string, ms: number): Promise<void> => {
  const b = page.locator(`[data-control="${control}"]`);
  await b.dispatchEvent('pointerdown', { pointerType: 'touch', isPrimary: true });
  await page.waitForTimeout(ms);
  await b.dispatchEvent('pointerup', { pointerType: 'touch', isPrimary: true });
};

test.describe('desktop', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('hire a courier at Vanterre, it follows, and KeyI orders it to attack the target', async ({ page }) => {
    test.setTimeout(120_000);
    const errors = trackErrors(page);
    await newPilot(page, 'Commodore', false, true);
    await toVanterre(page);
    await hireFirst(page);
    await leavePlanet(page);
    await expect.poll(() => page.evaluate(() => window.__starwake!.controller.escortsPresent())).toBe(1);

    // Fly ahead for 3 s: the escort keeps station within twice the follow distance.
    const follow = await page.evaluate(() => window.__starwake!.data.escorts.followDistance);
    await page.keyboard.down('ArrowUp');
    await page.waitForTimeout(3000);
    await page.keyboard.up('ArrowUp');
    await expect
      .poll(async () => {
        const p = await page.evaluate(() => window.__starwake!.world().ship.pos);
        const [e] = await escortNpcs(page);
        return e ? Math.hypot(e.pos.x - p.x, e.pos.y - p.y) : Infinity;
      })
      .toBeLessThanOrEqual(2 * follow);

    // A hostile ahead, targeted with Tab; KeyI sends the group in.
    await quietSky(page);
    const id = await page.evaluate(() => window.__starwake!.spawnHostile());
    await toughen(page, id);
    await guardPlayer(page);
    await page.keyboard.press('Tab');
    await expect.poll(() => page.evaluate(() => window.__starwake!.controller.traffic.targetId)).toBe(id);
    await page.keyboard.press('KeyI');
    await expect.poll(() => page.evaluate(() => window.__starwake!.hudMessage!())).toBe('Escorts: Attack.');
    expect(await page.evaluate(() => window.__starwake!.world().escortOrder)).toBe('attack');
    await expect
      .poll(
        async () => {
          await guardPlayer(page);
          const [escort] = await escortNpcs(page);
          return (await npcOf(page, id))?.aggro.includes(escort?.id ?? 'none') ?? false;
        },
        { timeout: 10_000 },
      )
      .toBe(true);
    expect(errors).toEqual([]);
  });

  test('an escort jumps with the pilot, lands with her, and Repair all charges 10 cr per missing armor', async ({ page }) => {
    test.setTimeout(120_000);
    const errors = trackErrors(page);
    await newPilot(page, 'Convoy', false, true);
    await toVanterre(page);
    await hireFirst(page);
    await leavePlanet(page);
    await expect.poll(() => page.evaluate(() => window.__starwake!.controller.escortsPresent())).toBe(1);
    await quietSky(page);

    // Plot a course to Calder and jump, as land-jump.spec does.
    expect(await page.evaluate(() => window.__starwake!.controller.plotRoute('calder').ok)).toBe(true);
    await page.keyboard.press('KeyG');
    await page.waitForFunction(() => window.__starwake!.world().assist.kind === 'autopilot');
    await page.waitForFunction(() => window.__starwake!.world().assist.kind === 'none', null, { timeout: 60_000 });
    await page.keyboard.press('KeyJ');
    await page.waitForFunction(() => window.__starwake!.world().jump !== null);
    await page.waitForFunction(() => window.__starwake!.world().jump === null, null, { timeout: 15_000 });
    expect(await page.evaluate(() => window.__starwake!.world().systemId)).toBe('calder');
    await expect.poll(() => page.evaluate(() => window.__starwake!.controller.escortsPresent())).toBe(1);
    await quietSky(page);
    await guardPlayer(page);

    // Half her armor is gone; park at Halcyon and land.
    const missing = await page.evaluate(() => {
      const h = window.__starwake!;
      const c = h.controller;
      let lost = 0;
      c.traffic = {
        ...c.traffic,
        npcs: c.traffic.npcs.map((n) => {
          if (n.role !== 'escort') return n;
          lost = n.hull.maxArmor / 2;
          return { ...n, hull: { ...n.hull, armor: n.hull.maxArmor - lost } };
        }),
      };
      const pos = h.data.planets.halcyon.pos;
      c.world = { ...c.world, ship: { ...c.world.ship, pos: { ...pos }, vel: { x: 0, y: 0 } } };
      return lost;
    });
    expect(missing).toBeGreaterThan(0);
    await page.keyboard.press('KeyL');
    const planet = page.getByTestId('planet-screen');
    await expect(planet).toContainText('Halcyon');
    const repair = planet.getByTestId('repair-escorts');
    await expect(repair).toBeVisible();
    expect(crIn(await repair.innerText())).toBe(10 * Math.round(missing));
    const before = await credits(page);
    await repair.getByRole('button', { name: 'Repair' }).click();
    await expect(planet.getByTestId('repair-escorts')).toHaveCount(0);
    expect(before - (await credits(page))).toBe(10 * Math.round(missing));
    expect(errors).toEqual([]);
  });

  test('the sidebar fits 1280×600 with the escorts line drawn: inside the window, nothing overlaps', async ({ page }) => {
    test.setTimeout(90_000);
    const errors = trackErrors(page);
    await page.setViewportSize({ width: 1280, height: 600 });
    await newPilot(page, 'Short', false, true);
    await toVanterre(page);
    await hireFirst(page);
    await leavePlanet(page);
    await expect.poll(() => page.evaluate(() => window.__starwake!.controller.escortsPresent())).toBe(1);
    await quietSky(page);
    await page.evaluate(() => window.__starwake!.spawnPatrol());
    await page.keyboard.press('Tab');
    await expect.poll(() => page.evaluate(() => window.__starwake!.sidebar?.().drawn.find((b) => b.name === 'target')?.text ?? '')).toContain('Test Patrol');
    await expect.poll(() => page.evaluate(() => window.__starwake!.sidebar?.().drawn.find((b) => b.name === 'escorts')?.text ?? '')).toBe('Escorts: 1 · Follow');
    const s = await page.evaluate(() => window.__starwake!.sidebar!());
    expect(s.visible).toBe(true);
    expect(s.drawn.map((b) => b.name)).toEqual(expect.arrayContaining(['radar', 'nav', 'law', 'escorts', 'target', 'targetDetail', 'targetBars', 'cargo', 'credits', 'date', 'map']));
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

  test('keep a captured raider as an escort; ORDER appears and two taps make the order hold', async ({ page }) => {
    test.setTimeout(120_000);
    const errors = trackErrors(page);
    await newPilot(page, 'Thumb Captain', false, true);
    await page.getByRole('button', { name: /^Leave/ }).tap();
    await waitForFlight(page);
    await page.touchscreen.tap(422, 30); // touch mode: rails on
    await expect(page.getByTestId('touch-rails')).toBeVisible();
    await quietSky(page);
    await expect(page.locator('[data-control="order"]')).toBeHidden();

    // Spawn raiders until the capture roll on one succeeds (ids count up while the others wait), then send the rest away.
    const id = await page.evaluate(() => {
      const h = window.__starwake!;
      const c = h.controller;
      const tried: string[] = [];
      let found: string | null = null;
      for (let i = 0; i < 400 && !found; i++) {
        const nid = h.spawnHostile('courier');
        if (h.captureWillSucceed(nid)) found = nid;
        else tried.push(nid);
      }
      c.traffic = { ...c.traffic, npcs: c.traffic.npcs.filter((n) => !tried.includes(n.id)) };
      if (!found) throw new Error('no capturable raider in 400 spawns');
      return found;
    });
    await guardPlayer(page);
    await holdRail(page, 'target', 700);
    await expect.poll(() => page.evaluate(() => window.__starwake!.controller.traffic.targetId)).toBe(id);
    expect(await page.evaluate(() => window.__starwake!.disableTarget())).toBe(true);
    // Rest beside her, facing her (the boarding range is 60 px).
    await page.evaluate((i) => {
      const c = window.__starwake!.controller;
      const n = c.traffic.npcs.find((x) => x.id === i)!;
      c.traffic = { ...c.traffic, npcs: c.traffic.npcs.map((x) => (x.id === i ? { ...x, ship: { ...x.ship, vel: { x: 0, y: 0 } } } : x)) };
      c.world = { ...c.world, ship: { ...c.world.ship, pos: { x: n.ship.pos.x - 30, y: n.ship.pos.y }, vel: { x: 0, y: 0 }, heading: 0 } };
    }, id);

    const ctxBtn = page.getByTestId('context-button');
    await expect(ctxBtn).toHaveText('BOARD');
    await ctxBtn.tap();
    const card = page.getByTestId('boarding-card');
    await expect(card).toBeVisible();
    await card.getByRole('button', { name: /^Attempt capture/ }).tap();
    await expect(card.getByTestId('boarding-outcome')).toContainText('Your party takes the bridge.');
    await card.getByRole('button', { name: 'Keep as escort' }).tap();
    await expect(card.getByTestId('boarding-outcome')).toContainText('joins your escort.');
    await card.getByRole('button', { name: /^Done/ }).tap();
    await expect(card).toBeHidden();
    await waitForFlight(page);
    expect(await page.evaluate(() => window.__starwake!.world().escorts.length)).toBe(1);
    await expect.poll(() => page.evaluate(() => window.__starwake!.controller.escortsPresent())).toBe(1);

    // The rail's ORDER button appears; Follow → Attack → Hold.
    const order = page.locator('[data-control="order"]');
    await expect(order).toBeVisible();
    await order.tap();
    await expect.poll(() => page.evaluate(() => window.__starwake!.world().escortOrder)).toBe('attack');
    await order.tap();
    await expect.poll(() => page.evaluate(() => window.__starwake!.world().escortOrder)).toBe('hold');
    expect(errors).toEqual([]);
  });
});
