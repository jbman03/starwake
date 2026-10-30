import { expect, test, type Page } from '@playwright/test';
import { leavePlanet, newPilot, trackErrors, waitForFlight } from './helpers';

type Phase = string | null;

/**
 * Put the ship well past Calder's jump boundary with a course to Vesk, ready to jump. `away` turns it to face
 * away from Vesk, so the align phase runs its full length. The flash is lengthened from 0.15 s to 0.3 s: the sim
 * advances at most 0.25 s a frame, so a phase longer than that is always seen by a once-a-frame poll, even on a
 * slow software-rendered frame. Every other timing is the shipped one unless `chargeSec` is given.
 */
async function readyToJump(page: Page, opts: { away?: boolean; chargeSec?: number } = {}): Promise<void> {
  await page.evaluate(({ away, chargeSec }) => {
    const c = window.__starwake!.controller;
    const j = c.data.config.jump;
    j.flashSec = 0.3;
    if (chargeSec !== undefined) j.chargeSec = chargeSec;
    const a = c.data.systems.calder.mapPos;
    const b = c.data.systems.vesk.mapPos;
    const toVesk = Math.atan2(b.y - a.y, b.x - a.x);
    const heading = away ? toVesk + Math.PI : c.world.ship.heading;
    c.world = { ...c.world, ship: { ...c.world.ship, pos: { x: 2100, y: 0 }, vel: { x: 0, y: 0 }, heading } };
    if (!c.plotRoute('vesk').ok) throw new Error('no route to Vesk');
  }, opts);
}

/** Record every jump phase seen on each animation frame (consecutive repeats dropped) until `stopPhases`. */
async function recordPhases(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __phases: Phase[]; __phasesOn: boolean };
    w.__phases = [window.__starwake!.jumpPhase()];
    w.__phasesOn = true;
    const tick = () => {
      const p = window.__starwake!.jumpPhase();
      if (p !== w.__phases[w.__phases.length - 1]) w.__phases.push(p);
      if (w.__phasesOn) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

async function stopPhases(page: Page): Promise<Phase[]> {
  return page.evaluate(() => {
    const w = window as unknown as { __phases: Phase[]; __phasesOn: boolean };
    w.__phasesOn = false;
    return w.__phases;
  });
}

const jumpPhase = (page: Page) => page.evaluate(() => window.__starwake!.jumpPhase());
const musicMood = (page: Page) => page.evaluate(() => window.__starwake!.musicMood!());
const speed = (page: Page) =>
  page.evaluate(() => {
    const v = window.__starwake!.world().ship.vel;
    return Math.hypot(v.x, v.y);
  });

test.describe('PC', () => {
  test('a full jump runs every phase in order, arrives at Vesk and flight goes on', async ({ page }) => {
    test.setTimeout(60_000); // a ~2.5 s jump plus flight checks; slow under a full parallel run in software rendering
    const errors = trackErrors(page);
    await newPilot(page, 'Leap', false, true);
    await leavePlanet(page);
    await page.waitForTimeout(100);
    await readyToJump(page, { away: true });
    const fuel0 = await page.evaluate(() => window.__starwake!.world().ship.fuel);
    await recordPhases(page);

    await page.keyboard.press('KeyJ');
    await page.waitForFunction(() => window.__starwake!.jumpPhase() !== null);
    await page.waitForFunction(() => window.__starwake!.jumpPhase() === null, null, { timeout: 10_000 });
    expect(await stopPhases(page)).toEqual([null, 'align', 'charge', 'burn', 'flash', 'arrive', null]);

    const w = await page.evaluate(() => window.__starwake!.world());
    expect(w.systemId).toBe('vesk');
    expect(w.ship.fuel).toBe(fuel0 - 100);
    // Vesk is independent: the music turns to the fringe mood.
    await expect.poll(() => musicMood(page)).toBe('fringe');

    // Flight continues: the controls answer again and thrust speeds the ship up.
    await waitForFlight(page);
    const v0 = await speed(page);
    await page.keyboard.down('ArrowUp');
    await page.waitForTimeout(500);
    await page.keyboard.up('ArrowUp');
    expect(await speed(page)).toBeGreaterThan(v0 + 10);
    expect(errors).toEqual([]);
  });

  test('pressing J again during the charge skips straight to the flash', async ({ page }) => {
    test.setTimeout(60_000); // a ~2.5 s jump plus flight checks; slow under a full parallel run in software rendering
    const errors = trackErrors(page);
    await newPilot(page, 'Hasty', false, true);
    await leavePlanet(page);
    await page.waitForTimeout(100);
    // A ten-minute charge: only the skip can get the ship to Vesk within the wait below.
    await readyToJump(page, { away: true, chargeSec: 600 });
    await recordPhases(page);

    await page.keyboard.press('KeyJ');
    await page.waitForFunction(() => window.__starwake!.jumpPhase() === 'charge');
    // The charge plays the hyperspace mood.
    await expect.poll(() => musicMood(page)).toBe('hyperspace');
    await page.keyboard.press('KeyJ');
    await page.waitForFunction(() => window.__starwake!.jumpPhase() === null, null, { timeout: 10_000 });
    // No burn: the skip goes from the charge straight to the flash.
    expect(await stopPhases(page)).toEqual([null, 'align', 'charge', 'flash', 'arrive', null]);
    expect(await page.evaluate(() => window.__starwake!.world().systemId)).toBe('vesk');
    await waitForFlight(page);
    expect(errors).toEqual([]);
  });
});

test.describe('phone (touch, landscape)', () => {
  test.use({ hasTouch: true, viewport: { width: 844, height: 390 } });

  test('a jump from the context button runs to the end and arrives', async ({ page }) => {
    const errors = trackErrors(page);
    await newPilot(page, 'Thumb', false, true);
    await page.getByRole('button', { name: /^Leave/ }).tap();
    await waitForFlight(page);
    await page.touchscreen.tap(422, 30);
    await expect(page.getByTestId('touch-rails')).toBeVisible();
    await readyToJump(page, { away: true });
    const ctxBtn = page.getByTestId('context-button');
    await expect(ctxBtn).toHaveText('JUMP TO VESK');
    await recordPhases(page);

    await ctxBtn.tap();
    await expect(ctxBtn).toHaveText('⏩ SKIP');
    await page.waitForFunction(() => window.__starwake!.jumpPhase() === null, null, { timeout: 10_000 });
    expect(await stopPhases(page)).toEqual([null, 'align', 'charge', 'burn', 'flash', 'arrive', null]);
    expect(await page.evaluate(() => window.__starwake!.world().systemId)).toBe('vesk');
    await waitForFlight(page);
    await expect(ctxBtn).not.toHaveText('⏩ SKIP');
    expect(errors).toEqual([]);
  });
});

test('the Music and Effects sliders save and survive a reload, and V toggles mute', async ({ page }) => {
  test.setTimeout(60_000);
  const errors = trackErrors(page);
  const saved = () => page.evaluate(() => JSON.parse(localStorage.getItem('starwake.settings')!) as { musicVolume: number; sfxVolume: number; muted: boolean });
  await newPilot(page, 'Ears', false, true);
  await leavePlanet(page);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('pause-menu')).toBeVisible();
  await page.getByRole('button', { name: 'Settings' }).click();
  const settings = page.getByTestId('settings-screen');
  await expect(settings).toBeVisible();
  await page.getByRole('tab', { name: 'General' }).click();

  const music = settings.getByLabel('Music', { exact: true });
  const effects = settings.getByLabel('Effects', { exact: true });
  await music.fill('25');
  await effects.fill('80');
  await expect(settings).toContainText('25%');
  await expect(settings).toContainText('80%');
  expect(await saved()).toMatchObject({ musicVolume: 0.25, sfxVolume: 0.8, muted: false });

  // V mutes everything and unmutes, from the settings screen itself, and leaves the volumes alone.
  const mute = settings.getByLabel('Mute sound (V)');
  await expect(mute).not.toBeChecked();
  await page.keyboard.press('KeyV');
  await expect.poll(async () => (await saved()).muted).toBe(true);
  await expect(mute).toBeChecked();
  expect(await saved()).toMatchObject({ musicVolume: 0.25, sfxVolume: 0.8 });
  await page.keyboard.press('KeyV');
  await expect.poll(async () => (await saved()).muted).toBe(false);
  await expect(mute).not.toBeChecked();

  // Muted, then reload: the volumes and the mute come back from the saved settings.
  await page.keyboard.press('KeyV');
  await expect.poll(async () => (await saved()).muted).toBe(true);
  await page.reload();
  const menu = page.getByTestId('main-menu');
  await expect(menu).toBeVisible();
  await menu.getByRole('button', { name: 'Settings' }).click();
  await expect(settings).toBeVisible();
  await page.getByRole('tab', { name: 'General' }).click();
  await expect(music).toHaveValue('25');
  await expect(effects).toHaveValue('80');
  await expect(mute).toBeChecked();
  expect(errors).toEqual([]);
});

test('the music mood is docked on the planet screen and core after take-off at Halcyon', async ({ page }) => {
  const errors = trackErrors(page);
  await newPilot(page, 'Tune', false, true);
  await expect(page.getByTestId('planet-screen')).toContainText('Halcyon');
  await expect.poll(() => musicMood(page)).toBe('docked');
  await leavePlanet(page);
  await expect.poll(() => musicMood(page)).toBe('core');
  expect(await jumpPhase(page)).toBeNull();
  expect(errors).toEqual([]);
});
