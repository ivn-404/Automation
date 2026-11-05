/**
 * Shared canvas bet helpers for specs (spin → stake, overlay recovery).
 */

import type { Page, Response } from 'playwright';

import type { BetResponseSnapshot, GameManifest } from '../../src/core/models/index.js';
import { parseBetResponseBody } from '../../src/data/parse-bet-response.js';
import { clearCanvasOverlays, markSpinTriggered, settleCanvasToBaseGame } from '../../src/platform/index.js';
import type { PlaywrightGameDriver } from '../../src/driver/playwright-game-driver.js';
import type { SgapSession } from '../fixtures/index.js';
import { expect } from '../fixtures/index.js';
import { getLauncherMode } from '../fixtures/local-launcher-html.js';
import { isBuyPurchaseResponse } from '../../src/network/index.js';
import { parseRequestBuyFeat, parseRequestTotalBet, parseResponseStake } from './buy-feature-verify.js';
import { closeBuyPanel, gateCanvasIntent } from '../../src/eye/index.js';
import { recallHealedRatio } from '../../src/eye/learned-ratios.js';
import { locateControlByPhaser } from '../../src/runtime/phaser-locate.js';
import { candidatePoints } from '../../src/surfaces/load-surface-profile.js';
import { recoverMissedCanvasClick } from './click-recovery.js';
import { prepareCanvasAmplify, prepareCanvasSpin } from './canvas-bet-control.js';
import { spinTimeoutMs } from './canvas-action-healer.js';
import {
  locateControlByVision,
  waitForBetQuiet,
  waitForIdleHud,
} from './canvas-healing.js';
import { failureKind } from '../../src/controllers/strategy/failure-class.js';
import { matchesBetUrl } from '../../src/network/bet-url.js';
import type { LocatorStrategy } from '../../src/reporting/interaction-journal.js';

/** A ladder point is the pinned manifest point or one of the profile's fallback candidates. */
function ladderStrategy(
  manifest: GameManifest,
  action: string,
  point: { readonly x: number; readonly y: number },
): LocatorStrategy {
  const pinned = manifest.canvasActions?.actions[action];
  return pinned !== undefined && pinned.x === point.x && pinned.y === point.y ? 'manifest' : 'candidate';
}

export interface BuyFeatureBetResult extends BetResponseSnapshot {
  /** Line bet sent on the buy/bet request. */
  readonly requestStake?: number;
  /** Total buy cost on request when provider sends totalBet. */
  readonly requestTotalBet?: number;
  /** buyFeat multiplier on buy request when present. */
  readonly requestBuyFeat?: number;
}

/**
 * One observable spin through the session's SpinController (healer-prepared click,
 * parsed /bet). Kept as the spec-facing helper; the driver and page arguments are
 * the session's own and remain for call-site compatibility.
 */
export async function spinForBet(
  sgapSession: SgapSession,
  _sgapDriver?: PlaywrightGameDriver,
  _page?: Page,
): Promise<BetResponseSnapshot> {
  return sgapSession.spin.spinAndRead({ timeoutMs: spinTimeoutMs() });
}

export async function waitForBetResponses(
  page: Page,
  count: number,
  timeoutMs: number,
): Promise<Response> {
  let last: Response | undefined;
  for (let i = 0; i < count; i += 1) {
    last = await page.waitForResponse(
      (response) => response.ok() && matchesBetUrl(response.url()),
      { timeout: timeoutMs },
    );
  }
  if (last === undefined) {
    throw new Error(`expected ${count} bet responses`);
  }
  return last;
}

export async function expectNoBetWithin(page: Page, timeoutMs: number): Promise<void> {
  const unexpected = await page
    .waitForResponse(
      (response) => response.ok() && matchesBetUrl(response.url()),
      { timeout: timeoutMs },
    )
    .then(() => true)
    .catch(() => false);
  expect(unexpected, 'unexpected bet response after autoplay stop').toBe(false);
}

/** True if a buy-feature purchase network call arrives within the window. */
export async function sawBuyPurchaseWithin(page: Page, timeoutMs: number): Promise<boolean> {
  return page
    .waitForResponse((response) => isBuyPurchaseResponse(response), { timeout: timeoutMs })
    .then(() => true)
    .catch(() => false);
}

/**
 * Start a base spin, attempt buy-feature mid-spin, then await spin complete.
 * Returns whether a buy purchase was observed during the mid-spin window.
 */
export async function spinWithMidSpinBuyAttempt(
  sgapSession: SgapSession,
  sgapDriver: PlaywrightGameDriver,
  page: Page,
): Promise<{ readonly sawBuy: boolean; readonly spinBet: BetResponseSnapshot }> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      if (!(await sgapDriver.isAttached())) {
        await sgapDriver.attach();
      }
      const ready = await prepareCanvasSpin(sgapSession, sgapDriver, page);
      if (!ready) {
        throw new Error('spin control not visible after splash/idle wait');
      }
      // Same as healer.prepare: a /bet during locate (turbo mis-tap, leftover
      // tumble) must finish before we arm waiters on a still button.
      await waitForBetQuiet(page, 1_000, 5_000);
      const idle = await waitForIdleHud(page, sgapDriver, sgapSession.manifest, 12_000);
      if (!idle.healed) {
        throw new Error(`HUD not idle before mid-spin buy: ${idle.detail}`);
      }

      sgapSession.betWatcher!.reset();
      sgapSession.betWatcher!.arm({
        timeoutMs: getLauncherMode() === 'staging' ? 90_000 : 45_000,
      });

      const startDone = sgapSession.spin.waitForSpinStart({ timeoutMs: 90_000 });
      await sgapSession.spin.clickSpin({
        timeoutMs: 90_000,
        singleInput: true,
        useHealedRatio: attempt > 1,
      });
      await startDone;

      await sgapDriver
        .getFrame()
        .locator('body')
        .evaluate(() => {
          const w = window as unknown as {
            __sgapSpinning?: boolean;
            __sgapSpinUnlockTimer?: ReturnType<typeof setTimeout>;
          };
          if (w.__sgapSpinUnlockTimer) {
            clearTimeout(w.__sgapSpinUnlockTimer);
          }
          w.__sgapSpinning = true;
        })
        .catch(() => undefined);

      // Short window — only count buys that fire while the spin is still in flight.
      const buyWatch = sawBuyPurchaseWithin(page, 2_500);
      await sgapDriver
        .clickCanvas('buyFeature', { timeoutMs: 6_000, singleInput: true })
        .catch(() => undefined);
      await sgapDriver
        .clickCanvas('buyFeatureConfirm', { timeoutMs: 6_000, singleInput: true })
        .catch(() => undefined);

      const sawBuy = await buyWatch;

      // Close buy panel if it opened after the spin settled.
      await closeBuyPanel(sgapDriver).catch(() => false);

      const spinBet = await sgapSession.betWatcher!.read({
        timeoutMs: getLauncherMode() === 'staging' ? 90_000 : 45_000,
      });

      await sgapDriver
        .getFrame()
        .locator('body')
        .evaluate(() => {
          const w = window as unknown as { __sgapSpinning?: boolean };
          w.__sgapSpinning = false;
        })
        .catch(() => undefined);

      await waitForIdleHud(page, sgapDriver, sgapSession.manifest, 8_000);
      return { sawBuy, spinBet };
    } catch (error: unknown) {
      lastError = error;
      sgapSession.betWatcher!.reset();
      await recoverMissedCanvasClick(
        page,
        sgapDriver,
        sgapSession.manifest,
        'spin',
        error,
        sgapSession.platform,
      );
      await settleCanvasToBaseGame(
        page,
        sgapDriver,
        sgapSession.manifest,
        sgapSession.platform.getInitializeBody(),
      );
    }
  }

  throw lastError;
}

/**
 * Count successful bet responses until a quiet gap (autoplay finished or stopped).
 */
export async function countBetsUntilIdle(
  page: Page,
  options?: {
    readonly maxBets?: number;
    readonly idleMs?: number;
    readonly firstBetTimeoutMs?: number;
    readonly overallTimeoutMs?: number;
    /** When set, use shorter idle after reaching this count (autoplay finished). */
    readonly targetCount?: number;
    readonly targetIdleMs?: number;
  },
): Promise<number> {
  const maxBets = options?.maxBets ?? 40;
  const idleMs = options?.idleMs ?? 5_000;
  const firstBetTimeoutMs = options?.firstBetTimeoutMs ?? 45_000;
  const overallTimeoutMs = options?.overallTimeoutMs ?? 180_000;
  const targetCount = options?.targetCount;
  const targetIdleMs = options?.targetIdleMs ?? 8_000;

  return new Promise((resolve) => {
    let count = 0;
    let idleTimer: ReturnType<typeof setTimeout> | undefined;
    let firstBetTimer: ReturnType<typeof setTimeout> | undefined;
    let settled = false;

    const finish = (value: number): void => {
      if (settled) {
        return;
      }
      settled = true;
      page.off('response', handler);
      if (idleTimer !== undefined) {
        clearTimeout(idleTimer);
      }
      if (firstBetTimer !== undefined) {
        clearTimeout(firstBetTimer);
      }
      clearTimeout(overallTimer);
      resolve(value);
    };

    const scheduleIdle = (): void => {
      if (idleTimer !== undefined) {
        clearTimeout(idleTimer);
        idleTimer = undefined;
      }
      // While chasing a target spin count, do not exit early on inter-spin gaps.
      if (targetCount !== undefined && count < targetCount) {
        return;
      }
      const quietMs =
        targetCount !== undefined && count >= targetCount ? targetIdleMs : idleMs;
      idleTimer = setTimeout(() => finish(count), quietMs);
    };

    const handler = (response: Response): void => {
      if (!response.ok() || !matchesBetUrl(response.url())) {
        return;
      }
      count += 1;
      if (firstBetTimer !== undefined) {
        clearTimeout(firstBetTimer);
        firstBetTimer = undefined;
      }
      if (count >= maxBets) {
        finish(count);
        return;
      }
      scheduleIdle();
    };

    page.on('response', handler);
    firstBetTimer = setTimeout(() => finish(count), firstBetTimeoutMs);
    const overallTimer = setTimeout(() => finish(count), overallTimeoutMs);
  });
}

async function waitForSpinIdle(sgapSession: SgapSession, maxMs = 8_000): Promise<void> {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    const lock = await sgapSession.spin.getLockState();
    const available = await sgapSession.spin.isAvailable();
    if (available && !lock.locked) {
      return;
    }
    await new Promise((resolve) => {
      setTimeout(resolve, 250);
    });
  }
}

/** True when mid-panel YES is on screen (buy confirm open). */
async function buyConfirmVisible(
  page: Page,
  driver: PlaywrightGameDriver,
  manifest: GameManifest,
): Promise<boolean> {
  const located = await locateControlByVision(page, driver, manifest, 'buyFeatureConfirm');
  return located.healed;
}

export async function openBuyFeaturePanel(
  sgapSession: SgapSession,
  sgapDriver: PlaywrightGameDriver,
  page: Page,
  openIndex = 0,
): Promise<boolean> {
  const openPoints = candidatePoints(sgapDriver.surface, sgapSession.manifest, 'buyFeature');

  await waitForIdleHud(page, sgapDriver, sgapSession.manifest, 12_000);
  await gateCanvasIntent({
    page,
    driver: sgapDriver,
    manifest: sgapSession.manifest,
    platform: sgapSession.platform,
    intent: 'buyFeature',
  });

  // Scene graph first, then the live pink-pill centroid — fixed ratios drift with
  // HUD layout. A vision centre outside the profile's accept window is scenery.
  const phaserOpen = await locateControlByPhaser(
    page,
    sgapSession.manifest,
    sgapDriver.iframeSelector,
    'buyFeature',
    { remember: false },
  );
  const visionOpen = phaserOpen.hit !== undefined
    ? { healed: false }
    : await locateControlByVision(page, sgapDriver, sgapSession.manifest, 'buyFeature', {
        remember: true,
      });
  const healedOpen = visionOpen.healed
    ? recallHealedRatio(sgapSession.manifest.gameId, 'buyFeature')
    : undefined;
  const openVision = sgapDriver.surface.controls.buyFeature?.vision;
  const accept = openVision?.accept ?? openVision?.band;
  const visionUsable =
    healedOpen !== undefined &&
    (accept === undefined || (healedOpen.y >= accept.y0 && healedOpen.y <= accept.y1));
  const located = phaserOpen.hit !== undefined
    ? { x: phaserOpen.hit.xRatio, y: phaserOpen.hit.yRatio }
    : visionUsable
      ? healedOpen
      : undefined;
  const point = located ?? openPoints[openIndex % openPoints.length]!;
  if (phaserOpen.hit !== undefined) {
    console.log(`[sgap-heal] buyFeature: ${phaserOpen.detail}`);
  } else if (visionUsable) {
    console.log(
      `[sgap-heal] buyFeature: pink pill at ${point.x.toFixed(3)},${point.y.toFixed(3)}`,
    );
  } else if (healedOpen !== undefined) {
    console.log(
      `[sgap-heal] buyFeature: ignoring pink blob at ${healedOpen.x.toFixed(3)},${healedOpen.y.toFixed(3)} — using manifest/fallback`,
    );
  }

  // Click+tap matches calibrate/probe success on Sugar Phaser (click-only often misses).
  await sgapDriver.clickCanvasAt(point, {
    timeoutMs: 12_000,
    singleInput: false,
    label: 'buyFeature',
    strategy: phaserOpen.hit !== undefined
      ? 'phaser'
      : visionUsable
        ? 'vision'
        : ladderStrategy(sgapSession.manifest, 'buyFeature', point),
  });
  // Panel animation is slower under parallel load / half-monitor layout.
  const waitMs = getLauncherMode() === 'staging' ? 1_600 : 900;
  await page.waitForTimeout(waitMs);

  const deadline = Date.now() + (getLauncherMode() === 'staging' ? 4_000 : 2_500);
  while (Date.now() < deadline) {
    if (await buyConfirmVisible(page, sgapDriver, sgapSession.manifest)) {
      return true;
    }
    await page.waitForTimeout(300);
  }
  console.log('[sgap-heal] buyFeature: BUY FEATURE pill not visible after open — will re-open');
  return false;
}

/** Dismiss buy panel without purchasing — cancel/Escape only (no grid spam). */
export async function dismissBuyFeaturePanel(
  sgapSession: SgapSession,
  sgapDriver: PlaywrightGameDriver,
  page: Page,
): Promise<void> {
  if (!(await closeBuyPanel(sgapDriver, 3).catch(() => false))) {
    await page.keyboard.press('Escape').catch(() => undefined);
  }
  // Non-grid dismiss only — forceGridSpam can hit the green BUY FEATURE confirm.
  await clearCanvasOverlays(sgapDriver, sgapSession.manifest, 2);
  await page.waitForTimeout(400);
}

export async function buyFeatureForBet(
  sgapSession: SgapSession,
  sgapDriver: PlaywrightGameDriver,
  page: Page,
  options?: { readonly settleAfter?: boolean; readonly selectAction?: string },
): Promise<BuyFeatureBetResult> {
  const fields = sgapSession.manifest.network!.fields;

  // Confirm points while panel stays open — do NOT re-tap buyFeature between these
  // (that toggles the panel shut and every confirm then hits base-idle).
  const confirmPoints = candidatePoints(
    sgapDriver.surface,
    sgapSession.manifest,
    'buyFeatureConfirm',
    ['buyFeatureConfirmAlt'],
  );

  await waitForIdleHud(page, sgapDriver, sgapSession.manifest, 12_000);
  await gateCanvasIntent({
    page,
    driver: sgapDriver,
    manifest: sgapSession.manifest,
    platform: sgapSession.platform,
    intent: 'buyFeature',
  });
  // Non-grid dismiss only — grid spam (acknowledge) can close the buy panel / open junk.
  await clearCanvasOverlays(sgapDriver, sgapSession.manifest, 2);
  await sgapSession.amplifyBet.disable({ timeoutMs: 8_000 }).catch(() => undefined);
  await waitForBetQuiet(page, 2_000);
  await waitForSpinIdle(sgapSession);

  const settle = async (response: Response): Promise<BuyFeatureBetResult> => {
    markSpinTriggered(sgapDriver);
    const requestStake = parseResponseStake(response);
    const requestTotalBet = parseRequestTotalBet(response);
    const requestBuyFeat = parseRequestBuyFeat(response);
    const snapshot = parseBetResponseBody(await response.json(), fields);
    if (options?.settleAfter !== false) {
      await clearCanvasOverlays(sgapDriver, sgapSession.manifest, 4, {
        forceGridSpam: true,
      });
    }
    return { ...snapshot, requestStake, requestTotalBet, requestBuyFeat };
  };

  let lastError: unknown;
  // One relocate, then one retry. A real buy response is returned as-is so a
  // wrong feature payload stays a game failure in the spec.
  const openRounds = 2;
  const buyTimeoutMs = getLauncherMode() === 'staging' ? 8_000 : 6_000;

  for (let round = 0; round < openRounds; round += 1) {
    if (!(await sgapDriver.isAttached())) {
      await sgapDriver.attach();
    }

    let straySpin = false;
    const watchStray = (response: Response): void => {
      if (response.ok() && matchesBetUrl(response.url()) && !isBuyPurchaseResponse(response)) {
        straySpin = true;
      }
    };
    page.on('response', watchStray);

    // Arm before open — Sugar's pink BUY pill can purchase on the open tap
    // (buyFeat=1) before a YES panel appears. A listener, not a timed
    // waitForResponse: opening the panel and locating confirm can outlast any
    // fixed window, and a purchase that lands after it is still the purchase.
    let purchase: Response | undefined;
    let onPurchase: (() => void) | undefined;
    const watchPurchase = (response: Response): void => {
      if (purchase === undefined && isBuyPurchaseResponse(response)) {
        purchase = response;
        onPurchase?.();
      }
    };
    page.on('response', watchPurchase);
    const purchaseWithin = (ms: number): Promise<void> =>
      purchase !== undefined
        ? Promise.resolve()
        : new Promise<void>((resolve) => {
            const timer = setTimeout(resolve, ms);
            onPurchase = () => {
              clearTimeout(timer);
              resolve();
            };
          });

    try {
      const opened = await openBuyFeaturePanel(sgapSession, sgapDriver, page, round);

      await purchaseWithin(2_000);
      if (purchase !== undefined) {
        console.log('[sgap-heal] buyFeature: purchase fired on open tap');
        return settle(purchase);
      }

      const pillVisible =
        opened || (await buyConfirmVisible(page, sgapDriver, sgapSession.manifest));
      if (!pillVisible) {
        lastError = new Error('buyFeature automation miss: BUY FEATURE pill not visible');
        console.log('[sgap-heal] buyFeature: panel did not open — not tapping confirm');
      } else {
        if (options?.selectAction !== undefined && purchase === undefined) {
          await sgapDriver.clickCanvas(options.selectAction, { timeoutMs: 8_000, singleInput: true });
          await page.waitForTimeout(500);
        }
        const spinHit = await locateControlByPhaser(
          page,
          sgapSession.manifest,
          sgapDriver.iframeSelector,
          'spin',
          { remember: false },
        );
        const spinPoint =
          spinHit.hit === undefined
            ? undefined
            : { x: spinHit.hit.xRatio, y: spinHit.hit.yRatio };
        const visionConfirm = await locateControlByVision(
          page,
          sgapDriver,
          sgapSession.manifest,
          'buyFeatureConfirm',
          { remember: true },
        );
        const healed = recallHealedRatio(sgapSession.manifest.gameId, 'buyFeatureConfirm');
        const tryPoints: ReadonlyArray<{ x: number; y: number }> =
          visionConfirm.healed && healed !== undefined
            ? [healed, ...confirmPoints]
            : confirmPoints;
        // Some layouts keep the HUD spin interactive under the panel at the pill's spot;
        // a point on the pill vision just saw is the confirm, not the spin.
        const pillPoint = visionConfirm.healed ? healed : undefined;
        const safePoints = tryPoints.filter(
          (point) =>
            spinPoint === undefined ||
            !sameControl(point, spinPoint) ||
            (pillPoint !== undefined && sameControl(point, pillPoint)),
        );

        if (safePoints.length === 0) {
          lastError = new Error('buyFeatureConfirm automation miss: confirm ratio is the spin button');
          console.log('[sgap-heal] buy confirm point is the spin button — relocating');
        } else {
        for (const point of safePoints) {
          if (purchase !== undefined) {
            return settle(purchase);
          }
          if (straySpin) {
            break;
          }
          if (!(await buyConfirmVisible(page, sgapDriver, sgapSession.manifest))) {
            console.log('[sgap-heal] buyFeatureConfirm: panel closed mid-confirm — re-open');
            break;
          }
          await sgapDriver.clickCanvasAt(point, {
            timeoutMs: 10_000,
            singleInput: true,
            label: 'buyFeatureConfirm',
            strategy:
              point === healed
                ? 'vision'
                : ladderStrategy(sgapSession.manifest, 'buyFeatureConfirm', point),
          });
          await purchaseWithin(1_200);
          if (purchase !== undefined) {
            return settle(purchase);
          }
        }
        }

        if (safePoints.length === 0) {
          // The saved confirm point is the spin button. Relocate; do not wait out a buy.
        } else if (straySpin) {
          lastError = new Error(
            'buyFeatureConfirm automation miss: click sent a normal spin',
          );
          console.log('[sgap-heal] buy confirm hit spin — relocating, not a game defect');
        } else {
          await purchaseWithin(buyTimeoutMs);
          if (purchase !== undefined) {
            return settle(purchase);
          }
          lastError = new Error(
            `buyFeatureConfirm automation miss: no buy /bet response within ${buyTimeoutMs / 1000}s after the confirm tap`,
          );
        }
      }
    } finally {
      page.off('response', watchStray);
      page.off('response', watchPurchase);
    }

    if (failureKind(lastError) === 'defect') {
      throw lastError;
    }
    if (round + 1 < openRounds) {
      await recoverMissedCanvasClick(
        page,
        sgapDriver,
        sgapSession.manifest,
        'buyFeature',
        lastError,
        sgapSession.platform,
      );
      await closeBuyPanel(sgapDriver).catch(() => false);
      await waitForBetQuiet(page, 800, 2_000);
    }
  }

  throw lastError;
}

/** Confirm and spin sit on top of each other when the saved confirm ratio is the spin button. */
function sameControl(
  a: { readonly x: number; readonly y: number },
  b: { readonly x: number; readonly y: number },
): boolean {
  return Math.hypot(a.x - b.x, a.y - b.y) < 0.03;
}

/**
 * Arm Amplify and spin until /bet carries the expected isEnhancedBet.
 * Local controller flag alone is not proof — a miss-tap still flips it.
 */
export async function spinForEnhancedBet(
  sgapSession: SgapSession,
  sgapDriver: PlaywrightGameDriver,
  page: Page,
  expectEnhanced: boolean,
  options?: { readonly maxAttempts?: number },
): Promise<BetResponseSnapshot> {
  const maxAttempts = options?.maxAttempts ?? 3;
  let last: BetResponseSnapshot | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    await prepareCanvasAmplify(sgapSession, sgapDriver, page);
    if (expectEnhanced) {
      // Do not disable-click first when the local flag may be wrong — that inverts
      // the UI (off→on) and then rearm toggles it back off. Rearm alone: reset
      // local flag + one tap, then prove on /bet.
      const amplify = sgapSession.amplifyBet as {
        rearm?: (options?: { timeoutMs?: number }) => Promise<void>;
        enable: (options?: { timeoutMs?: number }) => Promise<void>;
      };
      if (typeof amplify.rearm === 'function') {
        await amplify.rearm({ timeoutMs: 15_000 });
      } else {
        await amplify.enable({ timeoutMs: 15_000 });
      }
      // Let the amplify flag settle before arming /bet.
      await page.waitForTimeout(500);
    } else {
      if (sgapSession.amplifyBet.isAmplifyEnabled()) {
        await sgapSession.amplifyBet.disable({ timeoutMs: 15_000 });
      }
    }
    last = await spinForBet(sgapSession, sgapDriver, page);
    if (last.isEnhancedBet === expectEnhanced) {
      return last;
    }
    console.log(
      `[sgap-heal] amplify: /bet isEnhancedBet=${String(last.isEnhancedBet)} ` +
        `want=${String(expectEnhanced)} (attempt ${attempt}/${maxAttempts})`,
    );
    // No forceGridSpam — on Sugar it can hit BUY FEATURE / Rules and leave buyFeat=1.
    await page.keyboard.press('Escape').catch(() => undefined);
    await clearCanvasOverlays(sgapDriver, sgapSession.manifest, 2);
    await waitForIdleHud(page, sgapDriver, sgapSession.manifest, 12_000);
  }

  throw new Error(
    `Expected isEnhancedBet=${String(expectEnhanced)} on /bet after ${maxAttempts} amplify attempts, ` +
      `got ${String(last?.isEnhancedBet)}`,
  );
}

/** Buy feature with settle + retry — for parallel-load flakes on confirm. */
export async function buyFeatureForBetWithRetry(
  sgapSession: SgapSession,
  sgapDriver: PlaywrightGameDriver,
  page: Page,
  options?: { readonly maxAttempts?: number; readonly settleAfter?: boolean },
): Promise<BuyFeatureBetResult> {
  const maxAttempts = options?.maxAttempts ?? 2;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      if (attempt > 1) {
        await settleCanvasToBaseGame(
          page,
          sgapDriver,
          sgapSession.manifest,
          sgapSession.platform.getInitializeBody(),
        );
        await clearCanvasOverlays(sgapDriver, sgapSession.manifest, 6, {
          forceGridSpam: true,
        });
      }
      return await buyFeatureForBet(sgapSession, sgapDriver, page, options);
    } catch (error: unknown) {
      lastError = error;
      if (failureKind(error) === 'defect') {
        throw error;
      }
      await dismissBuyFeaturePanel(sgapSession, sgapDriver, page).catch(() => undefined);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}
