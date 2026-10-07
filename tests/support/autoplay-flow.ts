/**
 * Shared autoplay helpers — arm bet listeners before start, retry under load.
 */

import type { Page, Response } from 'playwright';

import type { GameManifest, VerificationResult } from '../../src/core/models/index.js';
import { parseEnhancedBetFromBetRequest } from '../../src/data/parse-balance.js';
import { clearCanvasOverlays, settleCanvasToBaseGame } from '../../src/platform/index.js';
import type { PlaywrightGameDriver } from '../../src/driver/playwright-game-driver.js';
import type { SgapSession } from '../fixtures/index.js';
import { expect } from '../fixtures/index.js';
import { countBetsUntilIdle, expectNoBetWithin } from './canvas-bet-flow.js';
import { prepareCanvasTurbo } from './canvas-bet-control.js';
import { matchesBetUrl } from '../../src/network/bet-url.js';

export const isBetResponse = (url: string): boolean => matchesBetUrl(url);

export function stakeFromBetResponse(response: Response): string | undefined {
  try {
    const body = response.request().postDataJSON() as { bet?: string | number } | null;
    if (body === null || body.bet === undefined) {
      return undefined;
    }
    return String(body.bet);
  } catch {
    return undefined;
  }
}

export function requestHasEnhancedBet(response: Response): boolean | undefined {
  try {
    return parseEnhancedBetFromBetRequest(response.request().postDataJSON());
  } catch {
    return undefined;
  }
}

/** Fail closed: autoplay produced at least one successful /bet (not a turbo-on proof). */
export function verifyAutoplayProducedBets(
  responses: readonly Response[],
): VerificationResult {
  const ok = responses.filter((response) => response.ok());
  return {
    kind: 'bet',
    passed: ok.length > 0,
    message:
      ok.length === 0
        ? 'No /bet requests captured from autoplay'
        : `Autoplay produced ${ok.length} /bet response(s)`,
    expected: '>= 1',
    actual: ok.length,
  };
}

/** Arm N sequential bet-response waits (must be called before autoplay.start). */
export function armBetResponses(
  page: Page,
  count: number,
  perBetTimeoutMs = 90_000,
): Promise<Response[]> {
  return (async () => {
    const batch: Response[] = [];
    for (let i = 0; i < count; i += 1) {
      batch.push(
        await page.waitForResponse(
          (response) => response.ok() && isBetResponse(response.url()),
          { timeout: perBetTimeoutMs },
        ),
      );
    }
    return batch;
  })();
}

export async function prepareAutoplayCanvas(
  sgapSession: SgapSession,
  sgapDriver: PlaywrightGameDriver,
  page: Page,
  initializeBody?: unknown,
): Promise<void> {
  const initBody = initializeBody ?? sgapSession.platform.getInitializeBody();
  await settleCanvasToBaseGame(page, sgapDriver, sgapSession.manifest, initBody);
  await clearCanvasOverlays(sgapDriver, sgapSession.manifest, 4, {
    forceGridSpam: true,
  });
  await prepareCanvasTurbo(sgapSession, sgapDriver, page).catch(() => undefined);
  await sgapSession.turbo.enable({ timeoutMs: 15_000 }).catch(() => undefined);
}

export interface AutoplayStartOptions {
  readonly sgapSession: SgapSession;
  readonly sgapDriver: PlaywrightGameDriver;
  readonly page: Page;
  readonly maxAttempts?: number;
  readonly startTimeoutMs?: number;
  readonly spinCountAction?: string;
}

async function attemptAutoplayStart<T>(
  options: AutoplayStartOptions,
  collect: () => Promise<T>,
): Promise<T> {
  const { sgapSession, sgapDriver, page } = options;
  const maxAttempts = options.maxAttempts ?? 3;
  const startTimeoutMs = options.startTimeoutMs ?? 30_000;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    await clearCanvasOverlays(sgapDriver, sgapSession.manifest, 4, {
      forceGridSpam: true,
    });
    if (!(await sgapDriver.isAttached())) {
      await sgapDriver.attach();
    }
    await expect(sgapSession.autoplay.isAvailable()).resolves.toBe(true);
    await prepareCanvasTurbo(sgapSession, sgapDriver, page).catch(() => undefined);
    await sgapSession.turbo.enable({ timeoutMs: 15_000 }).catch(() => undefined);

    const collecting = collect();
    try {
      await sgapSession.autoplay.start({
        timeoutMs: startTimeoutMs,
        spinCountAction: options.spinCountAction,
      });
      expect(sgapSession.autoplay.isAutoplayActive()).toBe(true);
      return await collecting;
    } catch (error: unknown) {
      lastError = error;
      await stopAutoplayQuietly(sgapSession, page);
      if (attempt === maxAttempts) {
        throw error;
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

/** Start autoplay and collect N bet responses (listeners armed first). */
export async function startAutoplayCollectingBets(
  options: AutoplayStartOptions & {
    readonly betCount: number;
    readonly perBetTimeoutMs?: number;
  },
): Promise<Response[]> {
  const perBetTimeoutMs = options.perBetTimeoutMs ?? 90_000;
  return attemptAutoplayStart(options, () =>
    armBetResponses(options.page, options.betCount, perBetTimeoutMs),
  );
}

/** Start autoplay and count bets until idle (counter armed first). */
export async function startAutoplayCountingUntilIdle(
  options: AutoplayStartOptions & {
    readonly countOptions?: Parameters<typeof countBetsUntilIdle>[1];
  },
): Promise<number> {
  return attemptAutoplayStart(options, () =>
    countBetsUntilIdle(options.page, {
      maxBets: 40,
      idleMs: 40_000,
      firstBetTimeoutMs: 90_000,
      overallTimeoutMs: 300_000,
      ...options.countOptions,
    }),
  );
}

/** Collect bet responses while running an async action (e.g. mid-autoplay taps). */
export async function watchBetResponsesDuring(
  page: Page,
  during: () => Promise<void>,
  options?: {
    readonly minCount?: number;
    readonly timeoutMs?: number;
    readonly settleMs?: number;
  },
): Promise<Response[]> {
  const bets: Response[] = [];
  const handler = (response: Response): void => {
    if (response.ok() && isBetResponse(response.url())) {
      bets.push(response);
    }
  };
  page.on('response', handler);
  try {
    await during();
    const minCount = options?.minCount ?? 1;
    const deadline = Date.now() + (options?.timeoutMs ?? 60_000);
    while (bets.length < minCount && Date.now() < deadline) {
      await page.waitForTimeout(250);
    }
    if (options?.settleMs !== undefined && options.settleMs > 0) {
      await page.waitForTimeout(options.settleMs);
    }
    return bets;
  } finally {
    page.off('response', handler);
  }
}

export async function stopAutoplayQuietly(
  sgapSession: SgapSession,
  page: Page,
  options?: { readonly drainMs?: number; readonly quietMs?: number },
): Promise<void> {
  await sgapSession.autoplay.stop({ timeoutMs: 15_000 }).catch(() => undefined);
  sgapSession.autoplay.acknowledgeStopped();
  await page
    .waitForResponse(
      (response) => response.ok() && isBetResponse(response.url()),
      { timeout: options?.drainMs ?? 8_000 },
    )
    .catch(() => undefined);
  await expectNoBetWithin(page, options?.quietMs ?? 5_000);
}

export async function settleAutoplaySession(
  sgapSession: SgapSession,
  sgapDriver: PlaywrightGameDriver,
  page: Page,
  manifest: GameManifest,
  initializeBody?: unknown,
): Promise<void> {
  await stopAutoplayQuietly(sgapSession, page);
  await clearCanvasOverlays(sgapDriver, manifest, 4, { forceGridSpam: true });
  await settleCanvasToBaseGame(
    page,
    sgapDriver,
    manifest,
    initializeBody ?? sgapSession.platform.getInitializeBody(),
  );
}
