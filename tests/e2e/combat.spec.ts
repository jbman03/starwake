import { expect, test, type Page } from '@playwright/test';
import { leavePlanet, newPilot, trackErrors, waitForFlight } from './helpers';

// Combat pilots start at Halcyon in Calder, the start system, where no raiders spawn. Concord patrols do, so each
// fight first clears the sky (quietSky); every fight here is one the test sets up with the test hooks.

const npcOf = (page: Page, id: string) =>
  page.evaluate((i) => window.__starwake!.combatState().npcs.find((n) => n.id === i) ?? null, id);

/** The NPC's shields plus armor, or -1 once it is gone. */
const hullOf = async (page: Page, id: string) => {
  const n = await npcOf(page, id);
  return n ? n.hull.shields + n.hull.armor : -1;
};

/**
 * Test-only: clear the sky for a set-up fight. Ambient traffic goes (a bounty target stays), and no new ship
 * spawns: a Concord patrol would join any fight with a raider, and a random raider could attack or demand.
 */
async function quietSky(page: Page): Promise<void> {
  await page.evaluate(() => {
    const c = window.__starwake!.controller;
    const npcs = c.traffic.npcs.filter((n) => n.id.startsWith('bounty-'));
    c.traffic = { ...c.traffic, npcs, nextSpawnSec: 1e9, targetId: npcs.some((n) => n.id === c.traffic.targetId) ? c.traffic.targetId : null };
  });
}

/** How many of the player's own shots are in flight. */
const playerShots = (page: Page) =>
  page.evaluate(() => window.__starwake!.controller.battleView().projectiles.filter((p) => p.ownerId === 'player').length);

/** Spawn a raider of hull `shipId` 400 px ahead; returns its id. */
const spawn = (page: Page, shipId: string) => page.evaluate((s) => window.__starwake!.spawnHostile(s), shipId);

/** Test-only: change fields of NPC `id` in traffic (role, hull, position...). */
async function patchNpc(page: Page, id: string, patch: Record<string, unknown>): Promise<void> {
  await page.evaluate(
    ({ i, p }) => {
      const c = window.__starwake!.controller;
      c.traffic = { ...c.traffic, npcs: c.traffic.npcs.map((n) => (n.id === i ? { ...n, ...p } : n)) };
    },
    { i: id, p: patch },
  );
}

/**
 * Test-only: leave NPC `id` one bolt from the disable line with a margin. Her armor becomes 24 of 200: one 6-damage
 * bolt takes her below 10% and disables her at 18, and three more would be needed to destroy her. Slow (CI) frames
 * can let one short press of fire loose two bolts that land together; a plain 40-armor courier has no such margin
 * (a disabled ship is under 4 armor, and the next hit destroys her). Shields stay down until she is hit
 * (lastHitSec Infinity, as the game does for a ship just taken command of).
 */
async function weaken(page: Page, id: string): Promise<void> {
  await page.evaluate((i) => {
    const c = window.__starwake!.controller;
    c.traffic = {
      ...c.traffic,
      npcs: c.traffic.npcs.map((n) => (n.id === i ? { ...n, hull: { ...n.hull, shields: 0, maxArmor: 200, armor: 24, lastHitSec: Infinity } } : n)),
    };
  }, id);
}

/**
 * Test-only: hold NPC `id` still, 80 px dead ahead of the player's ship (which stops, turned toward the system
 * centre), in the forward gun's line. She is given a hold point there, as bounty and story ships have: a hurt
 * raider flees (it never fires while fleeing), and a fleeing ship with a hold point flies to it and waits instead
 * of running for the jump boundary. Inward, because Halcyon sits near Calder's boundary.
 */
async function holdAhead(page: Page, id: string): Promise<void> {
  await page.evaluate((i) => {
    const c = window.__starwake!.controller;
    const { pos } = c.world.ship;
    const heading = Math.atan2(-pos.y, -pos.x);
    const at = { x: pos.x + Math.cos(heading) * 80, y: pos.y + Math.sin(heading) * 80 };
    c.world = { ...c.world, ship: { ...c.world.ship, heading, vel: { x: 0, y: 0 } } };
    c.traffic = { ...c.traffic, npcs: c.traffic.npcs.map((n) => (n.id === i ? { ...n, hold: at, ship: { ...n.ship, pos: at, vel: { x: 0, y: 0 } } } : n)) };
  }, id);
}

/**
 * Fire single shots (`shoot` presses and releases the fire control) at NPC `id` until she is disabled. State-based,
 * with no shot count or time budget of its own, so slow (software-rendered CI) timing only makes it take longer:
 * whenever none of the player's shots is in flight and she is still up, she is weakened, held ahead and shot once.
 * One press at a time, plus weaken's armor margin, means a stray extra bolt cannot destroy her once she is disabled.
 * Call it with no player shot in flight.
 */
async function shootUntilDisabled(page: Page, id: string, shoot: () => Promise<void>): Promise<void> {
  const state = async () => {
    const n = await npcOf(page, id);
    if (!n) return 'gone';
    if (n.hull.disabled) return 'disabled';
    if ((await playerShots(page)) === 0) {
      await weaken(page, id);
      await holdAhead(page, id);
      await shoot();
    }
    return 'up';
  };
  await expect.poll(state, { timeout: 60_000, intervals: [100] }).not.toBe('up');
  expect(await state(), `${id} was not disabled`).toBe('disabled');
}

/** Park the player's ship at rest beside NPC `id`, facing it (the boarding range is 60 px). */
async function parkBeside(page: Page, id: string, gap = 30): Promise<void> {
  await page.evaluate(
    ({ i, g }) => {
      const c = window.__starwake!.controller;
      const n = c.traffic.npcs.find((x) => x.id === i)!;
      c.traffic = { ...c.traffic, npcs: c.traffic.npcs.map((x) => (x.id === i ? { ...x, ship: { ...x.ship, vel: { x: 0, y: 0 } } } : x)) };
      c.world = { ...c.world, ship: { ...c.world.ship, pos: { x: n.ship.pos.x - g, y: n.ship.pos.y }, vel: { x: 0, y: 0 }, heading: 0 } };
    },
    { i: id, g: gap },
  );
}

/** Test-only: pick a world seed under which the capture roll on `id` succeeds (below the 5% floor of the odds). */
async function seedForCapture(page: Page, id: string): Promise<void> {
  await page.evaluate(async (i) => {
    const { hashString, mulberry32 } = await import('/src/sim/random.ts' as string);
    const c = window.__starwake!.controller;
    let s = 1;
    while (mulberry32(hashString(s, 'capture', i))() >= 0.05) s++;
    c.world = { ...c.world, seed: s };
  }, id);
}

/** Hold a rail button (synthetic touch pointer events) for `ms`. */
async function holdRail(page: Page, control: string, ms: number): Promise<void> {
  const b = page.locator(`[data-control="${control}"]`);
  await b.dispatchEvent('pointerdown', { pointerType: 'touch', isPrimary: true });
  await page.waitForTimeout(ms);
  await b.dispatchEvent('pointerup', { pointerType: 'touch', isPrimary: true });
}

test.describe('desktop', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('R targets a hostile, Space fires until disabled, B boards, take cargo, capture, take command', async ({ page }) => {
    test.setTimeout(120_000);
    const errors = trackErrors(page);
    await newPilot(page, 'Gunner');
    await leavePlanet(page);
    await quietSky(page);
    const id = await spawn(page, 'courier');
    const start = await hullOf(page, id);

    await page.keyboard.press('r');
    await expect.poll(() => page.evaluate(() => window.__starwake!.controller.traffic.targetId)).toBe(id);

    // Hold fire: the hull falls, then (weakened to keep the test short) the ship is disabled.
    await page.keyboard.down('Space');
    await expect.poll(() => hullOf(page, id), { timeout: 20_000 }).toBeLessThan(start);
    await page.keyboard.up('Space');
    // Bolts still in flight could disable the weakened ship, and the next shot would then destroy her.
    await expect.poll(() => playerShots(page)).toBe(0);
    await weaken(page, id);
    await shootUntilDisabled(page, id, async () => {
      await page.keyboard.down('Space');
      await page.waitForTimeout(50);
      await page.keyboard.up('Space');
    });
    expect(await page.evaluate(() => window.__starwake!.targetBars!())).not.toBeNull();

    // Only traders carry trade goods: give the raider a trader's hold (she stays a raider-government ship) so there is cargo to take.
    await patchNpc(page, id, { role: 'trader' });
    await parkBeside(page, id);
    await expect.poll(() => page.evaluate(() => window.__starwake!.controller.currentContext())).toBe('board');
    await page.keyboard.press('b');
    const card = page.getByTestId('boarding-card');
    await expect(card).toBeVisible();
    await expect(card).toContainText('Courier');

    const tonsBefore = await page.evaluate(() => Object.values(window.__starwake!.world().cargo).reduce((a, b) => a + b, 0));
    await card.getByRole('button', { name: /^Take cargo/ }).click();
    await expect(card.getByTestId('boarding-outcome')).not.toBeEmpty();
    const tonsAfter = await page.evaluate(() => Object.values(window.__starwake!.world().cargo).reduce((a, b) => a + b, 0));
    expect(tonsAfter).toBeGreaterThan(tonsBefore);
    await expect(card.getByRole('button', { name: /^Take cargo .* — done$/ })).toBeDisabled();

    await seedForCapture(page, id);
    await card.getByRole('button', { name: /^Attempt capture/ }).click();
    await expect(card.getByTestId('boarding-outcome')).toContainText('Your party takes the bridge.');
    await card.getByRole('button', { name: /^Take command/ }).click();
    await expect(card.getByTestId('boarding-outcome')).toContainText('You take command of');
    expect(await page.evaluate(() => window.__starwake!.world().shipId)).toBe('courier');
    await card.getByRole('button', { name: /^Done/ }).click();
    await expect(card).toBeHidden();
    await waitForFlight(page);
    expect(await npcOf(page, id)).toBeNull();
    expect(errors).toEqual([]);
  });

  test('raider demand: Y answers, pay, raider leaves', async ({ page }) => {
    const errors = trackErrors(page);
    await newPilot(page, 'Payer');
    await leavePlanet(page);
    await quietSky(page);
    const id = await spawn(page, 'kestrel');
    await patchNpc(page, id, { engaged: false, demand: true });
    await expect.poll(() => page.evaluate(() => window.__starwake!.hudHail!())).not.toBeNull();
    const credits = await page.evaluate(() => window.__starwake!.world().credits);

    await page.keyboard.press('y');
    const card = page.getByTestId('encounter-card');
    await expect(card).toBeVisible();
    await expect(card).toContainText('demands a toll');
    const pay = card.getByTestId('encounter-choice').filter({ hasText: /^Pay \d+ cr/ });
    const price = Number((await pay.textContent())!.match(/Pay (\d+) cr/)![1]);
    await pay.click();
    await expect(card.getByTestId('encounter-outcome')).toContainText(`You pay ${price} cr.`);
    expect(await page.evaluate(() => window.__starwake!.world().credits)).toBe(credits - price);
    const npc = await page.evaluate((i) => window.__starwake!.controller.traffic.npcs.find((n) => n.id === i)!, id);
    expect(npc).toMatchObject({ peaceful: true, demand: false, engaged: false });
    expect((await npcOf(page, id))!.hostile).toBe(false);
    expect(errors).toEqual([]);
  });

  test('death with a pod wakes at a port', async ({ page }) => {
    const errors = trackErrors(page);
    await newPilot(page, 'Podder');
    await page.evaluate(() => {
      const c = window.__starwake!.controller;
      c.world = { ...c.world, outfits: { ...c.world.outfits, 'escape-pod': 1 } };
    });
    await leavePlanet(page);
    await dieInFlight(page);
    const card = page.getByTestId('destroyed-card');
    await expect(card).toBeVisible({ timeout: 20_000 });
    await expect(card).toContainText('Your escape pod got you clear.');
    await card.getByTestId('destroyed-continue').click();
    await expect(page.getByTestId('planet-screen')).toBeVisible();
    await expect(page.getByTestId('planet-screen')).toContainText('Your escape pod reaches');
    const w = await page.evaluate(() => ({ ship: window.__starwake!.world().shipId, pod: window.__starwake!.world().outfits['escape-pod'] ?? 0 }));
    expect(w).toEqual({ ship: 'shuttle', pod: 0 });
    expect(errors).toEqual([]);
  });

  test('death without a pod reloads the last save', async ({ page }) => {
    const errors = trackErrors(page);
    await newPilot(page, 'Unlucky');
    await leavePlanet(page);
    const saved = await page.evaluate(() => window.__starwake!.world().credits);
    // Spend in flight: the reload must bring back the credits of the save at Halcyon.
    await page.evaluate(() => {
      const c = window.__starwake!.controller;
      c.world = { ...c.world, credits: 7 };
    });
    await dieInFlight(page);
    const card = page.getByTestId('destroyed-card');
    await expect(card).toBeVisible({ timeout: 20_000 });
    await expect(card).toContainText('Your ship is lost.');
    await card.getByTestId('destroyed-continue').click();
    await expect(page.getByTestId('planet-screen')).toBeVisible();
    await expect(page.getByTestId('planet-screen')).toContainText('Halcyon');
    expect(await page.evaluate(() => window.__starwake!.world().credits)).toBe(saved);
    expect(errors).toEqual([]);
  });

  test('bounty: accept, fly, disable, return, paid', async ({ page }) => {
    test.setTimeout(120_000);
    const errors = trackErrors(page);
    await newPilot(page, 'Hunter', false, true); // calm: no random raider in the target system
    // Advance the date until Halcyon posts a bounty, then take it at the Mission Computer.
    const offer = await page.evaluate(() => {
      const h = window.__starwake!;
      for (let i = 0; i < 200; i++) {
        const o = h.controller.offers().find((x) => x.typeId === 'bounty');
        if (o) return { id: o.offerId, pay: o.pay, title: o.title };
        h.controller.world = { ...h.controller.world, day: h.controller.world.day + 1 };
      }
      throw new Error('no bounty offer found');
    });
    await page.keyboard.press('KeyM');
    const mc = page.getByTestId('mission-computer');
    await expect(mc).toBeVisible();
    await mc.locator(`[data-offer="${offer.id}"]`).click();
    await expect(mc.getByTestId('mc-detail')).toContainText(offer.title);
    await page.keyboard.press('Enter'); // accept
    await expect(mc.getByTestId('mc-message')).toContainText('Accepted');
    await page.keyboard.press('Escape');
    await expect(mc).toBeHidden();
    const job = await page.evaluate(() => window.__starwake!.world().missions.find((m) => m.combat?.kind === 'bounty')!);
    const target = await page.evaluate((sys) => Object.values(window.__starwake!.data.planets).find((p) => p.systemId === sys)!.id, job.combat!.systemId);

    // Fly there (the teleport skips the jumps), find the wanted ship, disable her.
    await page.evaluate((p) => window.__starwake!.teleport(p), target);
    await leavePlanet(page);
    const id = `bounty-${job.id}`;
    await expect.poll(() => npcOf(page, id)).not.toBeNull(); // calm does not stop the bounty target
    await quietSky(page);
    expect(await npcOf(page, id)).not.toBeNull();
    await page.evaluate((i) => window.__starwake!.controller.targetShip(i), id);
    await weaken(page, id);
    await shootUntilDisabled(page, id, () => page.keyboard.press('Space', { delay: 50 }));
    await expect.poll(() => page.evaluate((m) => window.__starwake!.world().missions.find((x) => x.id === m)?.combat?.done ?? -1, job.id)).toBe(1);

    // Return to Halcyon and land: the bounty pays.
    const credits = await page.evaluate(() => window.__starwake!.world().credits);
    await page.evaluate(() => window.__starwake!.teleport('halcyon'));
    await expect(page.getByTestId('planet-screen')).toBeVisible();
    await expect.poll(() => page.evaluate((m) => window.__starwake!.world().missions.some((x) => x.id === m), job.id)).toBe(false);
    expect(await page.evaluate(() => window.__starwake!.world().credits)).toBe(credits + offer.pay);
    expect(errors).toEqual([]);
  });

  test('rebind fire to KeyZ and it fires', async ({ page }) => {
    const errors = trackErrors(page);
    await newPilot(page, 'Rebinder');
    await leavePlanet(page);
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('pause-menu')).toBeVisible();
    await page.getByRole('button', { name: 'Settings' }).click();
    await page.getByRole('tab', { name: 'Controls' }).click();
    await page.getByTestId('slot-firePrimary-0').click();
    await page.keyboard.press('KeyZ');
    await expect(page.getByTestId('slot-firePrimary-0')).toHaveText(/Z/);
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await page.getByRole('button', { name: /^Resume/ }).click();
    await waitForFlight(page);
    await quietSky(page);

    // Space no longer fires; Z does.
    await page.keyboard.down('Space');
    await page.waitForTimeout(400);
    await page.keyboard.up('Space');
    expect(await playerShots(page)).toBe(0);
    await page.keyboard.down('KeyZ');
    await expect.poll(() => playerShots(page)).toBeGreaterThan(0);
    await expect.poll(() => page.evaluate(() => window.__starwake!.projectiles!())).toBeGreaterThan(0);
    await page.keyboard.up('KeyZ');
    expect(errors).toEqual([]);
  });
});

/** Test-only: leave the player's ship disabled with no armor and put a raider on her; it finishes the job. */
async function dieInFlight(page: Page): Promise<void> {
  await quietSky(page);
  await page.evaluate(() => {
    const h = window.__starwake!;
    h.spawnHostile('kestrel');
    const b = h.controller.combat.battle;
    h.controller.combat.battle = { ...b, player: { ...b.player, shields: 0, armor: 0.5, disabled: true } };
  });
}

test.describe('phone', () => {
  test.use({ hasTouch: true, viewport: { width: 844, height: 390 } });

  test('hold TGT targets the hostile, FIRE disables, the context button reads Board and opens the card', async ({ page }) => {
    test.setTimeout(120_000);
    const errors = trackErrors(page);
    await newPilot(page, 'Thumb Gunner');
    await page.getByRole('button', { name: /^Leave/ }).tap();
    await waitForFlight(page);
    await page.touchscreen.tap(422, 30); // touch mode: rails on
    await expect(page.getByTestId('touch-rails')).toBeVisible();

    // Every element over the clear view (full-screen layers included) before the fight is marked; afterwards any
    // unmarked element over it is new, and only the context button may be.
    const overClear = (mark: boolean) =>
      page.evaluate((m) => {
        const layer = document.querySelector<HTMLElement>('[data-testid="touch-rails"]')!;
        const c = JSON.parse(layer.dataset.clear!) as { x: number; y: number; w: number; h: number };
        const out: string[] = [];
        document.querySelectorAll<HTMLElement>('body *').forEach((e) => {
          if (e.tagName === 'CANVAS' || e.contains(layer)) return;
          const r = e.getBoundingClientRect();
          if (r.width === 0 || r.height === 0 || getComputedStyle(e).visibility === 'hidden') return;
          if (!(r.left < c.x + c.w && c.x < r.right && r.top < c.y + c.h && c.y < r.bottom)) return;
          if (m) e.dataset.e2eBase = '1';
          else if (e.dataset.e2eBase !== '1') out.push(e.dataset.testid ?? e.dataset.control ?? `${e.tagName}.${e.className}`);
        });
        return out;
      }, mark);
    await overClear(true);
    await quietSky(page);

    const id = await spawn(page, 'courier');
    await holdRail(page, 'target', 700);
    await expect.poll(() => page.evaluate(() => window.__starwake!.controller.traffic.targetId)).toBe(id);

    await weaken(page, id);
    await shootUntilDisabled(page, id, () => holdRail(page, 'fire', 50));

    await parkBeside(page, id);
    const ctxBtn = page.getByTestId('context-button');
    await expect(ctxBtn).toHaveText('BOARD');
    // The context button sits over the view's bottom edge from the start; nothing else may have joined it.
    const added = (await overClear(false)).filter((x) => x !== 'context-button');
    expect(added).toEqual([]);

    await ctxBtn.tap();
    await expect(page.getByTestId('boarding-card')).toBeVisible();
    await expect(page.getByTestId('boarding-card')).toContainText('Attempt capture');
    expect(errors).toEqual([]);
  });
});
