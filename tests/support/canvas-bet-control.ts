/**
 * Shared bet-control helpers: spin → stake, with overlay settle + nudge retries.
 */

import type { Page, Response } from 'playwright';

import { getByPath } from '../../src/shared/json-path.js';
import { DEFAULT_BET_LEVELS, nearestBetLevelIndex, parseBetLevels } from '../../src/shared/bet-levels.js';
import {
  settleCanvasToBaseGame,
} from '../../src/platform/index.js';
import type { PlaywrightGameDriver } from '../../src/driver/playwright-game-driver.js';
import {
  clickDialogButton,
  dismissCanvasBlocker,
  forgetHealedRatio,
  gateCanvasIntent,
  isDismissableBlocker,
  readHudState,
  settleHudState,
} from '../../src/eye/index.js';
import { observationFor } from '../../src/observability/index.js';
import { expect, type SgapSession } from '../fixtures/index.js';
import { getLauncherMode } from '../fixtures/local-launcher-html.js';
import { recoverMissedCanvasClick } from './click-recovery.js';
import { ensurePortrait, waitForIdleHud } from './canvas-healing.js';
import { matchesBetUrl } from '../../src/network/bet-url.js';

export { DEFAULT_BET_LEVELS };

export interface BetLevelBounds {
  readonly levels: readonly number[];
  readonly min: string;
  readonly max: string;
}

function amountString(value: number): string {
  return String(Number(value.toFixed(4)));
}

function nearestLevelIndex(levels: readonly number[], stake: number): number {
  return nearestBetLevelIndex(levels, stake);
}

async function dismissCanvasBlockingModal(
  sgapDriver: PlaywrightGameDriver,
  manifest: import('../../src/core/models/index.js').GameManifest,
  blind = false,
): Promise<boolean> {
  if (!(await sgapDriver.isAttached())) {
    await sgapDriver.attach().catch(() => undefined);
  }
  if (!(await sgapDriver.isAttached())) {
    return false;
  }

  if (!blind) {
    const frame = sgapDriver.getFrame();
    const patterns = [/something went wrong/i, /session expired/i];
    for (const pattern of patterns) {
      if (!(await frame.getByText(pattern).first().isVisible().catch(() => false))) {
        continue;
      }
      blind = true;
      break;
    }
  }

  if (!blind) {
    return false;
  }

  if (process.env.SGAP_BLIND_OVERLAY_TAPS !== '1') {
    const observe = observationFor(sgapDriver.getPage());
    const tapDialogButton = async (): Promise<boolean> => {
      const label = await clickDialogButton(sgapDriver);
      if (label === undefined) {
        return false;
      }
      observe?.event('blocking-modal', `tapped dialog button "${label}"`);
      await sgapDriver.getPage().waitForTimeout(500).catch(() => undefined);
      return true;
    };
    if ((await readHudState(sgapDriver)).idle) {
      return false;
    }
    if (await tapDialogButton()) {
      return true;
    }
    // Reels and win count-ups finish on their own; only a HUD that stays covered needs a tap.
    const state = await settleHudState(sgapDriver, 4_000);
    if (state.idle) {
      return false;
    }
    if (await tapDialogButton()) {
      return true;
    }
    if (isDismissableBlocker(state.blocker.kind)) {
      await dismissCanvasBlocker(sgapDriver, manifest, state.blocker);
      return true;
    }
    if (state.blocker.kind === 'buy-confirm') {
      return false;
    }
    observe?.event('blocking-modal', `HUD still covered after 4s — fixed-point taps (${state.detail})`, {
      severity: 'warn',
    });
  }

  // Last resort: nothing recognisable on screen but the HUD is not idle.
  for (const name of ['errorOkAlt', 'errorOk', 'acknowledge', 'enter', 'dismiss', 'skip']) {
    if (manifest.canvasActions?.actions[name] === undefined) {
      continue;
    }
    await sgapDriver.clickCanvas(name, { singleInput: true }).catch(() => undefined);
  }
  // Sugar's error OK sits high (~0.27) above the reels; older builds put it mid-canvas.
  for (const point of [
    { x: 0.5, y: 0.24 },
    { x: 0.5, y: 0.3 },
    { x: 0.5, y: 0.55 },
    { x: 0.5, y: 0.6 },
    { x: 0.5, y: 0.5 },
  ] as const) {
    await sgapDriver
      .clickCanvasAt(point, { singleInput: true, label: 'errorOk+probe', timeoutMs: 5_000 })
      .catch(() => undefined);
  }
  await sgapDriver.getPage().waitForTimeout(500).catch(() => undefined);
  return true;
}

export async function prepareBetNudge(
  sgapSession: SgapSession,
  sgapDriver: PlaywrightGameDriver,
  page?: Page,
): Promise<void> {
  const host = page ?? sgapDriver.getPage();
  await ensurePortrait(host, sgapSession.manifest, sgapDriver.iframeSelector);
  await dismissCanvasBlockingModal(sgapDriver, sgapSession.manifest);
  await gateCanvasIntent({
    page: host,
    driver: sgapDriver,
    manifest: sgapSession.manifest,
    platform: sgapSession.platform,
    intent: 'bet',
  });
  // Beelze +/− are white glyphs on the value row (y≈0.80), not amber. Amber
  // locate latches onto the BET label (~y=0.70) and the 0.40 amount.
  forgetHealedRatio(sgapSession.manifest.gameId, 'betPlus');
  forgetHealedRatio(sgapSession.manifest.gameId, 'betMinus');
  const idle = await waitForIdleHud(host, sgapDriver, sgapSession.manifest, 8_000);
  if (idle.healed) {
    console.log(`[sgap-heal] bet idle: ${idle.detail}`);
  }
}

/**
 * Seed stake from initialize when available (avoids an extra baseline spin).
 */
export function initialStakeFromSession(session: SgapSession): string | undefined {
  const body = session.platform.getInitializeBody();
  const raw = getByPath(body, 'data.bet') ?? getByPath(body, 'bet');
  if (raw === undefined || raw === null) {
    return undefined;
  }
  const stake = String(raw).trim();
  return stake.length > 0 ? stake : undefined;
}

/**
 * Resolve bet ladder from initialize `data.betLevels`, metadata.betLevels, or defaults.
 */
export function resolveBetLevels(session: SgapSession): BetLevelBounds {
  const body = session.platform.getInitializeBody();
  const raw =
    getByPath(body, 'data.betLevels') ??
    getByPath(body, 'betLevels') ??
    getByPath(body, 'data.slot.betLevels') ??
    getByPath(body, 'slot.betLevels') ??
    getByPath(body, 'data.config.betLevels') ??
    undefined;

  let levels: number[] = [];
  if (Array.isArray(raw)) {
    levels = raw
      .map((entry) => Number(entry))
      .filter((entry) => Number.isFinite(entry) && entry > 0);
  }

  if (levels.length < 2) {
    levels = [...parseBetLevels(session.manifest.metadata?.betLevels)];
  }

  levels.sort((a, b) => a - b);
  session.bet.useBetLevels(levels);
  return {
    levels,
    min: amountString(levels[0]!),
    max: amountString(levels[levels.length - 1]!),
  };
}

/**
 * Sugar's ladder is 23 levels, so confirming every rung meant ~22 spins and 3+ minutes
 * inside the walk — long enough for staging to recycle the session and reset the stake.
 * Batching a few nudges per confirm keeps the network re-sync frequent enough to catch
 * desync (which trips the canvas "Something went wrong" modal) without spinning on
 * every rung.
 */
const LADDER_STEPS_PER_CONFIRM = 3;

async function nudgeStakeOnce(
  sgapSession: SgapSession,
  sgapDriver: PlaywrightGameDriver,
  direction: 'increase' | 'decrease',
  page?: Page,
): Promise<void> {
  const apply = async (): Promise<void> => {
    if (direction === 'increase') {
      await sgapSession.bet.increase({ timeoutMs: 15_000 });
    } else {
      await sgapSession.bet.decrease({ timeoutMs: 15_000 });
    }
  };

  try {
    await apply();
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/disabled|not attached|detached/i.test(message)) {
      throw error;
    }
    await sgapDriver.attach().catch(() => undefined);
    await prepareBetNudge(sgapSession, sgapDriver, page);
    await apply();
  }
}

/** Confirm the live stake via spin; settle and retry once when the canvas errors. */
async function confirmStakeBySpin(
  sgapSession: SgapSession,
  sgapDriver: PlaywrightGameDriver,
  page?: Page,
): Promise<string> {
  const host = page ?? sgapDriver.getPage();
  try {
    return await spinForStake(sgapSession, sgapDriver, page);
  } catch {
    await dismissCanvasBlockingModal(sgapDriver, sgapSession.manifest, true);
    if (!(await sgapDriver.isAttached())) {
      await sgapDriver.attach();
    }
    if (page !== undefined) {
      await settleCanvasToBaseGame(
        page,
        sgapDriver,
        sgapSession.manifest,
        sgapSession.platform.getInitializeBody(),
      );
    }
    await host.waitForTimeout(800);
    return spinForStake(sgapSession, sgapDriver, page);
  }
}

/**
 * Tap the stake down to the bottom rung without spinning.
 *
 * The stake lives on the player account, so a spec that finishes at max leaves the
 * next spec's first spin at max. Taps go straight to the canvas because the tracked
 * stake may already be stale.
 */
export async function resetStakeToMinimum(
  sgapSession: SgapSession,
  sgapDriver: PlaywrightGameDriver,
  levels: readonly number[],
  page?: Page,
): Promise<void> {
  const host = page ?? sgapDriver.getPage();
  await dismissCanvasBlockingModal(sgapDriver, sgapSession.manifest, true);
  await prepareBetNudge(sgapSession, sgapDriver, page);
  if (!(await sgapDriver.isAttached())) {
    await sgapDriver.attach();
  }

  for (let step = 0; step < levels.length; step += 1) {
    await sgapDriver
      .clickCanvas('betMinus', { timeoutMs: 10_000, singleInput: true })
      .catch(() => undefined);
    await host.waitForTimeout(150);
  }

  sgapSession.bet.observeBet(amountString(levels[0]!));
  await dismissCanvasBlockingModal(sgapDriver, sgapSession.manifest, true);
}

/**
 * Click +/- toward a boundary, confirming the stake over the network every few steps.
 */
export async function walkStakeToBoundary(
  sgapSession: SgapSession,
  sgapDriver: PlaywrightGameDriver,
  boundary: 'min' | 'max',
  fromStake: string,
  levels: readonly number[],
  page?: Page,
): Promise<string> {
  const targetIndex = boundary === 'min' ? 0 : levels.length - 1;
  const direction = boundary === 'min' ? 'decrease' : 'increase';
  const host = page ?? sgapDriver.getPage();
  let stake = fromStake;
  sgapSession.bet.useBetLevels(levels);
  sgapSession.bet.observeBet(stake);
  let stuckRounds = 0;

  for (let guard = 0; guard < 20; guard += 1) {
    if (nearestLevelIndex(levels, Number(stake)) === targetIndex) {
      break;
    }

    await prepareBetNudge(sgapSession, sgapDriver, page);
    if (!(await sgapDriver.isAttached())) {
      await sgapDriver.attach();
    }

    let nudges = 0;
    let predictedIndex = nearestLevelIndex(levels, Number(stake));
    while (nudges < LADDER_STEPS_PER_CONFIRM && predictedIndex !== targetIndex) {
      await nudgeStakeOnce(sgapSession, sgapDriver, direction, page);
      predictedIndex += direction === 'increase' ? 1 : -1;
      nudges += 1;
      await host.waitForTimeout(250);
    }
    if (nudges === 0) {
      break;
    }

    await dismissCanvasBlockingModal(sgapDriver, sgapSession.manifest, true);
    const nextStake = await confirmStakeBySpin(sgapSession, sgapDriver, page);

    const moved =
      direction === 'increase'
        ? Number(nextStake) > Number(stake) + 0.0001
        : Number(nextStake) < Number(stake) - 0.0001;
    stake = nextStake;
    sgapSession.bet.observeBet(stake);
    await dismissCanvasBlockingModal(sgapDriver, sgapSession.manifest, true);
    await host.waitForTimeout(400);

    if (!moved) {
      stuckRounds += 1;
      if (stuckRounds >= 2) {
        break;
      }
      continue;
    }
    stuckRounds = 0;
  }

  return stake;
}

/**
 * Extra nudge at a boundary; stake must not leave the bound.
 */
export async function assertStakeClamped(
  sgapSession: SgapSession,
  sgapDriver: PlaywrightGameDriver,
  direction: 'increase' | 'decrease',
  expectedStake: string,
  page?: Page,
): Promise<string> {
  await prepareBetNudge(sgapSession, sgapDriver, page);
  // Always tap the boundary control (BetController skips edge clicks by design).
  const action = direction === 'increase' ? 'betPlus' : 'betMinus';
  await sgapDriver.clickCanvas(action, { timeoutMs: 15_000, singleInput: true });
  await dismissCanvasBlockingModal(sgapDriver, sgapSession.manifest, true);

  const stake = await spinForStake(sgapSession, sgapDriver, page);
  sgapSession.bet.observeBet(stake);
  expect(
    Number(stake),
    `stake should stay clamped at ${expectedStake} after extra ${direction}`,
  ).toBeCloseTo(Number(expectedStake), 4);
  return stake;
}

/**
 * Start a spin, nudge bet+/- after request starts (mid-spin), then await complete.
 * Returns the stake on the in-flight bet request.
 */
export async function spinWithMidSpinBetNudge(
  sgapSession: SgapSession,
  sgapDriver: PlaywrightGameDriver,
  direction: 'increase' | 'decrease' = 'increase',
  nudgeCount = 3,
  page?: Page,
): Promise<string> {
  const timeoutMs = getLauncherMode() === 'staging' ? 90_000 : 30_000;
  let lastError: unknown;

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const host = page ?? sgapDriver.getPage();

    try {
      const ready = await prepareCanvasSpin(sgapSession, sgapDriver, page);
      if (!ready) {
        lastError = new Error('spin control not visible after splash/idle wait');
        continue;
      }
      sgapSession.betWatcher!.reset();
      sgapSession.betWatcher!.arm({ timeoutMs });

      const startDone = sgapSession.spin.waitForSpinStart({ timeoutMs });
      await sgapSession.spin.clickSpin({
        timeoutMs,
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

      const action = direction === 'increase' ? 'betPlus' : 'betMinus';
      for (let i = 0; i < nudgeCount; i += 1) {
        await sgapDriver
          .clickCanvas(action, { timeoutMs: 10_000, singleInput: true })
          .catch(() => undefined);
      }

      const bet = await sgapSession.betWatcher!.read({ timeoutMs });
      expect(bet.bet?.amount).toBeDefined();

      await sgapDriver
        .getFrame()
        .locator('body')
        .evaluate(() => {
          const w = window as unknown as { __sgapSpinning?: boolean };
          w.__sgapSpinning = false;
        })
        .catch(() => undefined);

      await waitForIdleHud(host, sgapDriver, sgapSession.manifest, 8_000);
      return bet.bet!.amount;
    } catch (error: unknown) {
      lastError = error;
      sgapSession.betWatcher!.reset();
      await recoverMissedCanvasClick(
        host,
        sgapDriver,
        sgapSession.manifest,
        'spin',
        error,
        sgapSession.platform,
      );
    }
  }

  throw lastError;
}

export async function prepareCanvasSpin(
  sgapSession: SgapSession,
  sgapDriver: PlaywrightGameDriver,
  page?: Page,
): Promise<boolean> {
  const host = page ?? sgapDriver.getPage();
  await ensurePortrait(host, sgapSession.manifest, sgapDriver.iframeSelector);
  await dismissCanvasBlockingModal(sgapDriver, sgapSession.manifest);
  await gateCanvasIntent({
    page: host,
    driver: sgapDriver,
    manifest: sgapSession.manifest,
    platform: sgapSession.platform,
    intent: 'spin',
  });

  const idleMs = getLauncherMode() === 'staging' ? 16_000 : 8_000;
  const located = await waitForIdleHud(host, sgapDriver, sgapSession.manifest, idleMs);
  if (located.healed) {
    console.log(`[sgap-heal] spin: ${located.detail}`);
    return true;
  }
  console.log(`[sgap-heal] spin not ready: ${located.detail}`);
  return false;
}

/** Idle HUD, then one lightning tap. Pass is a following /bet completing — not turbo-on. */
export async function prepareCanvasTurbo(
  sgapSession: SgapSession,
  sgapDriver: PlaywrightGameDriver,
  page?: Page,
): Promise<void> {
  const host = page ?? sgapDriver.getPage();
  await ensurePortrait(host, sgapSession.manifest, sgapDriver.iframeSelector);
  const idle = await waitForIdleHud(host, sgapDriver, sgapSession.manifest, 12_000);
  if (idle.healed) {
    console.log(`[sgap-heal] turbo idle: ${idle.detail}`);
  }
}

/** Idle HUD, then one Amplify tap. Pass is /bet `isEnhancedBet`, not the local flag. */
export async function prepareCanvasAmplify(
  sgapSession: SgapSession,
  sgapDriver: PlaywrightGameDriver,
  page?: Page,
): Promise<void> {
  const host = page ?? sgapDriver.getPage();
  await ensurePortrait(host, sgapSession.manifest, sgapDriver.iframeSelector);
  const idle = await waitForIdleHud(host, sgapDriver, sgapSession.manifest, 12_000);
  if (idle.healed) {
    console.log(`[sgap-heal] amplify idle: ${idle.detail}`);
  }
}

/**
 * Report bet requests the server rejects.
 *
 * BetResponseWatcher only matches `response.ok()`, so a rejected bet never resolves
 * the waiter and surfaces as a plain timeout — indistinguishable from a missed tap.
 * Returns a disposer.
 */
export function logRejectedBets(page: Page): () => void {
  const handler = (response: Response): void => {
    if (response.ok() || !matchesBetUrl(response.url())) {
      return;
    }
    void (async () => {
      const stake = response.request().postData() ?? '<no request body>';
      const body = await response.text().catch(() => '<unreadable>');
      console.log(
        `[sgap-bet-reject] status=${response.status()} stake=${stake} body=${body.slice(0, 300)}`,
      );
    })();
  };
  page.on('response', handler);
  return () => page.off('response', handler);
}

/** Stake the server charged for one spin, via the session's SpinController. */
export async function spinForStake(
  sgapSession: SgapSession,
  _sgapDriver?: PlaywrightGameDriver,
  _page?: Page,
): Promise<string> {
  // Stake reads follow a bet change, and the first /bet after one is slower on staging.
  const timeoutMs = getLauncherMode() === 'staging' ? 90_000 : 30_000;
  const bet = await sgapSession.spin.spinAndRead({ timeoutMs });
  expect(bet.bet?.amount).toBeDefined();
  return bet.bet!.amount;
}

export async function nudgeUntilStakeChanges(
  sgapSession: SgapSession,
  sgapDriver: PlaywrightGameDriver,
  direction: 'increase' | 'decrease',
  fromStake: string,
  maxAttempts = 5,
  page?: Page,
): Promise<string> {
  let stake = fromStake;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    await prepareBetNudge(sgapSession, sgapDriver, page);
    if (direction === 'increase') {
      await sgapSession.bet.increase({ timeoutMs: 15_000 });
    } else {
      await sgapSession.bet.decrease({ timeoutMs: 15_000 });
    }

    try {
      const host = page ?? sgapDriver.getPage();
      await host.waitForTimeout(250);
      stake = await spinForStake(sgapSession, sgapDriver, page);
      sgapSession.bet.observeBet(stake);
      const changed =
        direction === 'increase'
          ? Number(stake) > Number(fromStake)
          : Number(stake) < Number(fromStake);
      if (changed) {
        return stake;
      }
    } catch (error: unknown) {
      lastError = error;
    }
  }

  if (lastError !== undefined) {
    throw lastError;
  }
  return stake;
}
