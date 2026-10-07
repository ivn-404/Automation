/**
 * Canvas session primer — leave attract / dismiss overlays before Controllers run.
 *
 * Config-driven via manifest metadata.preSpinActions + canvasActions.
 * Grid spam follows: spin trigger first → then grid/skip spam (see grid-spam-click.ts).
 */

import type { Page } from 'playwright';

import type { GameManifest } from '../core/models/index.js';
import type { PlaywrightGameDriver } from '../driver/playwright-game-driver.js';
import { clearCanvasBlockers } from '../eye/canvas-blocker.js';
import { findIdleSpinInPng } from '../eye/canvas-vision.js';
import { clearInterferingScreens } from '../eye/index.js';
import {
  freeSpinItemsRemaining,
  getFreeSpinItems,
  isFreeSpinBundleComplete,
} from '../shared/spin-payload-discovery.js';
import {
  clearCanvasOverlaysWithSpinGate,
  clearNonGridOverlays,
  markSpinTriggered,
  resetSpinTrigger,
  type ClearCanvasOverlaysOptions,
} from './grid-spam-click.js';

export type { ClearCanvasOverlaysOptions };

export {
  clearNonGridOverlays,
  hasSpinTrigger,
  markSpinTriggered,
  resetSpinTrigger,
  spamClickGridOverlays,
  spamClickSkip,
} from './grid-spam-click.js';
import { matchesBetUrl } from '../network/bet-url.js';

export interface CanvasSessionPrimerOptions {
  readonly page: Page;
  readonly driver: PlaywrightGameDriver;
  readonly manifest: GameManifest;
  /** Max dismiss rounds after primary pre-spin actions. Default 2. */
  readonly dismissRounds?: number;
  /** Optional initialize body — used to detect leftover free-spin rounds. */
  readonly initializeBody?: unknown;
}

const isBetUrl = (url: string): boolean => matchesBetUrl(url);

export { freeSpinItemsRemaining, getFreeSpinItems, isFreeSpinBundleComplete };

/**
 * After session Continue, the game is mid free-spin — idle HUD will not redraw
 * until those spins are played out. Spin + overlay clear until idle or budget.
 */
export async function drainLeftoverFeatureSpins(
  page: Page,
  driver: PlaywrightGameDriver,
  manifest: GameManifest,
  maxSpins = 12,
): Promise<void> {
  if (manifest.canvasActions?.actions.spin === undefined) {
    return;
  }

  for (let spin = 0; spin < maxSpins; spin += 1) {
    const capture = await driver.captureCanvasForVision().catch(() => undefined);
    if (capture !== undefined && findIdleSpinInPng(capture.png, driver.surface) !== undefined) {
      console.log(`[sgap-heal] leftover-fs: idle spin visible after ${spin} drain spin(s)`);
      return;
    }

    await clearCanvasBlockers(page, driver, manifest, 1);
    await clearNonGridOverlays(driver, manifest, 1);

    const betPromise = page.waitForResponse(
      (response) => response.ok() && isBetUrl(response.url()),
      { timeout: 14_000 },
    );
    await driver.clickCanvas('spin', { singleInput: true }).catch(() => undefined);
    markSpinTriggered(driver);
    // FS overlays often need a mid-screen advance before spin registers.
    await driver
      .clickCanvasAt(
        { x: 0.5, y: 0.55 },
        {
          timeoutMs: 4_000,
          singleInput: true,
          label: 'fs-advance',
        },
      )
      .catch(() => undefined);

    const response = await betPromise.catch(() => undefined);
    if (response === undefined) {
      await clearCanvasOverlays(driver, manifest, 2, { forceGridSpam: true });
      continue;
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      body = undefined;
    }
    await clearCanvasOverlays(driver, manifest, 3, { forceGridSpam: true });
    if (freeSpinItemsRemaining(body) === 0) {
      await clearCanvasOverlays(driver, manifest, 2, { forceGridSpam: true });
      return;
    }
  }
}

/**
 * Clear win / continue overlays.
 * Non-grid dismiss always; grid + skip spam only after a spin trigger (unless forced).
 */
export async function clearCanvasOverlays(
  driver: PlaywrightGameDriver,
  manifest: GameManifest,
  rounds = 2,
  options?: ClearCanvasOverlaysOptions,
): Promise<void> {
  await clearCanvasOverlaysWithSpinGate(driver, manifest, rounds, options);
}

/**
 * Drain leftover buy-feature free spins / win overlays so base-game specs start clean.
 * Each cycle: spin trigger → optional grid dismiss after bet.
 */
export async function settleCanvasToBaseGame(
  page: Page,
  driver: PlaywrightGameDriver,
  manifest: GameManifest,
  initializeBody?: unknown,
  maxSpins = 16,
): Promise<void> {
  if (manifest.canvasActions?.actions.spin === undefined) {
    return;
  }

  await clearInterferingScreens({
    page,
    driver,
    manifest,
    intent: 'idle',
  });
  const blockers = await clearCanvasBlockers(page, driver, manifest, 3, { cancelBuyPanel: true });
  await clearNonGridOverlays(driver, manifest, 2);

  // Session Continue resumes an unfinished free-spin round — drain it even when
  // initialize reported remaining=0 (body is stale until Continue is accepted).
  if (blockers.hadSessionContinue) {
    await drainLeftoverFeatureSpins(page, driver, manifest, maxSpins);
    return;
  }

  // Only drain leftover free spins from initialize. Chasing any /bet in a 3.5s
  // window used to click HUD spin (or Beelze Buy, which sits on the old enter
  // point) and fire a request the spec's waiter never saw.
  if (freeSpinItemsRemaining(initializeBody) === 0) {
    return;
  }

  for (let spin = 0; spin < maxSpins; spin += 1) {
    await clearNonGridOverlays(driver, manifest, 1);
    const betPromise = page.waitForResponse(
      (response) => response.ok() && isBetUrl(response.url()),
      { timeout: 12_000 },
    );
    await driver.clickCanvas('spin', { singleInput: true }).catch(() => undefined);
    markSpinTriggered(driver);
    const response = await betPromise.catch(() => undefined);
    if (response === undefined) {
      await clearCanvasOverlays(driver, manifest, 4);
      return;
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      body = undefined;
    }
    await clearCanvasOverlays(driver, manifest, 3);
    if (freeSpinItemsRemaining(body) === 0) {
      await clearCanvasOverlays(driver, manifest, 2);
      return;
    }
  }

  await clearCanvasOverlays(driver, manifest, 4);
}

/**
 * Run configured pre-spin canvas actions (single tap each — not grid spam),
 * then non-grid dismiss only. Grid spam waits for the first spin trigger.
 */
export async function primeCanvasSession(
  options: CanvasSessionPrimerOptions,
): Promise<void> {
  const { page, driver, manifest } = options;
  if (manifest.canvasActions === undefined) {
    return;
  }

  resetSpinTrigger(driver);

  // Do not blindly tap enter/acknowledge. On Package 1 idle HUD those points sit
  // on Buy Feature (Beelze enter 0.50,0.77 ≈ buy 0.50,0.80) and open the panel
  // or send an unobserved /bet. Splash Play is dismissed by waitForIdleHud when
  // the green blob is actually on screen.

  await page
    .waitForResponse(
      (response) => response.ok() && response.url().includes('/api/v1/slots/'),
      { timeout: 8_000 },
    )
    .catch(() => undefined);

  // Game load → non-grid dismiss only (never spam the reel grid here).
  await clearNonGridOverlays(driver, manifest, options.dismissRounds ?? 2);
  await driver.gameCanvas().waitFor({ state: 'visible' });
  await settleCanvasToBaseGame(page, driver, manifest, options.initializeBody);
  // Specs own the first real spin — don't treat primer taps as a spin trigger.
  resetSpinTrigger(driver);
}
