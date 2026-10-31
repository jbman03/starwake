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
        const req = indexedDB.deleteDatabase('starwake');
        req.onsuccess = req.onerror = req.onblocked = () => resolve();
      }),
  );
}

/**
 * Main menu → New Pilot → name → planet screen at the start planet. The First Flight guide offer
 * that follows is answered Skip unless `guide` is true (then Start guide). `calm` loads `?test&calm=1`: no raiders
 * spawn, so a story test at a fringe system is not hijacked by a random demand hail or attack.
 */
export async function newPilot(page: Page, name = 'Test Pilot', guide = false, calm = false): Promise<void> {
  await page.goto(calm ? '/?test&calm=1' : '/?test');
  await clearPilots(page);
  await page.reload();
  await page.getByRole('button', { name: 'New Pilot' }).click();
  const input = page.getByLabel('Pilot name');
  await input.fill(name);
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page.getByTestId('planet-screen')).toBeVisible();
  const offer = page.getByRole('dialog', { name: /Take the guided first flight/ });
  await expect(offer).toBeVisible();
  await expect(offer).toContainText('replay it later from Settings → General or How to Play (H).');
  await offer.getByRole('button', { name: guide ? 'Start guide' : 'Skip' }).click();
  await expect(offer).toBeHidden();
}

/** Wait for flight to resume and the 0.4 s take-off effect to end (input is ignored until then). */
export async function waitForFlight(page: Page): Promise<void> {
  await page.waitForFunction(() => window.__starwake!.controller.isFlying && window.__starwake!.controller.view().landingT === null);
}

/** From the planet screen, press Leave and wait for flight to resume. */
export async function leavePlanet(page: Page): Promise<void> {
  await page.getByRole('button', { name: /^Leave/ }).click();
  await expect(page.getByTestId('planet-screen')).toBeHidden();
  await waitForFlight(page);
}

// Fights the tests set up with the test hooks (combat and law specs).

export const npcOf = (page: Page, id: string) =>
  page.evaluate((i) => window.__starwake!.combatState().npcs.find((n) => n.id === i) ?? null, id);

/**
 * Test-only: clear the sky for a set-up fight. Ambient traffic goes (a bounty target stays), and no new ship
 * spawns: a Concord patrol would join any fight with a raider, and a random raider could attack or demand.
 */
export async function quietSky(page: Page): Promise<void> {
  await page.evaluate(() => {
    const c = window.__starwake!.controller;
    const npcs = c.traffic.npcs.filter((n) => n.id.startsWith('bounty-'));
    c.traffic = { ...c.traffic, npcs, nextSpawnSec: 1e9, targetId: npcs.some((n) => n.id === c.traffic.targetId) ? c.traffic.targetId : null };
  });
}

/** How many of the player's own shots are in flight. */
export const playerShots = (page: Page) =>
  page.evaluate(() => window.__starwake!.controller.battleView().projectiles.filter((p) => p.ownerId === 'player').length);

/**
 * Test-only: leave NPC `id` one bolt from the disable line with a margin. Her armor becomes 24 of 200: one 6-damage
 * bolt takes her below 10% and disables her at 18, and three more would be needed to destroy her. Slow (CI) frames
 * can let one short press of fire loose two bolts that land together; a plain 40-armor courier has no such margin
 * (a disabled ship is under 4 armor, and the next hit destroys her). Shields stay down until she is hit
 * (lastHitSec Infinity, as the game does for a ship just taken command of).
 */
export async function weaken(page: Page, id: string): Promise<void> {
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
export async function holdAhead(page: Page, id: string): Promise<void> {
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
 * Test-only: put the player's shields and armor back to full (and clear disabled). The ship under fire is the
 * player's too: on a slow frame a target that fires back can disable her before the first shot, and a disabled
 * ship is towed to port, leaving nothing to shoot with.
 */
export async function guardPlayer(page: Page): Promise<void> {
  await page.evaluate(() => {
    const c = window.__starwake!.controller;
    const b = c.combat.battle;
    c.combat.battle = { ...b, player: { ...b.player, shields: b.player.maxShields, armor: b.player.maxArmor, disabled: false } };
  });
}

/**
 * Fire single shots (`shoot` presses and releases the fire control) at NPC `id` until she is disabled. State-based,
 * with no shot count or time budget of its own, so slow (software-rendered CI) timing only makes it take longer:
 * whenever none of the player's shots is in flight and she is still up, she is weakened, held ahead and shot once.
 * One press at a time, plus weaken's armor margin, means a stray extra bolt cannot destroy her once she is disabled.
 * Call it with no player shot in flight.
 */
export async function shootUntilDisabled(page: Page, id: string, shoot: () => Promise<void>): Promise<void> {
  const state = async () => {
    const n = await npcOf(page, id);
    if (!n) return 'gone';
    if (n.hull.disabled) return 'disabled';
    await guardPlayer(page);
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
