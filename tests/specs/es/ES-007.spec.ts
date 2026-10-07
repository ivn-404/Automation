/**
 * ES-007 — Edge & Stability
 *
 * Manual Test Case ID: ES-007
 * Intent: Max Win cap logic works — initialize declares the cap (`maxWin`, a multiple of
 * the bet) and no round the server settles pays more than `maxWin × bet`: checked on base
 * spins and on a bought feature (where the largest wins happen), including the
 * accumulated free-spin total.
 */

import { test, expect } from '../../fixtures/index.js';
import { requireCapabilities } from '../../support/capabilities.js';
import { settleCanvasToBaseGame } from '../../../src/platform/index.js';
import {
  InMemoryExecutionTracker,
  createDefaultExecutionReporters,
} from '../../../src/reporting/index.js';
import { getByPath } from '../../../src/shared/json-path.js';
import { buyFeatureForBetWithRetry, spinForBet } from '../../support/canvas-bet-flow.js';
import { drainFreeSpins } from '../../support/free-spin-flow.js';
import { ensureBaseHud } from '../../support/session-guard.js';
import type { BetResponseSnapshot, VerificationResult } from '../../../src/core/models/index.js';

const MANUAL_TEST_ID = 'ES-007' as const;
const BASE_SPINS = 5;

function readMaxWin(initBody: unknown): number {
  return Number(getByPath(initBody, 'data.maxWin') ?? getByPath(initBody, 'maxWin'));
}

function capCheck(label: string, win: number, stake: number, maxWin: number): VerificationResult {
  const cap = maxWin * stake;
  const ok = Number.isFinite(win) && Number.isFinite(cap) && cap > 0 && win <= cap + 0.005;
  return {
    kind: 'bet',
    passed: ok,
    message: ok
      ? `${label}: win ${win} ≤ cap ${cap} (${maxWin}× bet ${stake})`
      : `${label}: win ${win} exceeds the Max Win cap ${cap} (${maxWin}× bet ${stake})`,
    expected: `≤ ${cap}`,
    actual: win,
  };
}

test.describe('ES — Edge & Stability', () => {
  requireCapabilities('maxWin');
  test(`${MANUAL_TEST_ID} Max Win cap logic works`, async ({
    sgapSession,
    sgapDriver,
    page,
  }, testInfo) => {
    test.setTimeout(720_000);

    const tracker = new InMemoryExecutionTracker();
    await tracker.start(MANUAL_TEST_ID, testInfo.project.name);

    testInfo.annotations.push(
      { type: 'manualTestId', description: MANUAL_TEST_ID },
      { type: 'category', description: 'ES' },
      { type: 'gameId', description: sgapSession.manifest.gameId },
    );

    let verificationResults: VerificationResult[] = [];

    try {
      await expect(sgapDriver.isAttached()).resolves.toBe(true);
      await expect(sgapSession.spin.isAvailable()).resolves.toBe(true);

      await sgapDriver.gameCanvas().waitFor({ state: 'visible' });
      await ensureBaseHud(sgapSession, sgapDriver, page);
      await settleCanvasToBaseGame(
        page,
        sgapDriver,
        sgapSession.manifest,
        sgapSession.platform.getInitializeBody(),
      );
      await sgapSession.turbo.enable({ timeoutMs: 15_000 }).catch(() => undefined);

      const maxWin = readMaxWin(sgapSession.platform.getInitializeBody());
      verificationResults.push({
        kind: 'bet',
        passed: Number.isFinite(maxWin) && maxWin > 0,
        message:
          Number.isFinite(maxWin) && maxWin > 0
            ? `Initialize declares maxWin=${maxWin}×`
            : 'Initialize does not declare a positive maxWin',
        actual: maxWin,
      });

      for (let spin = 1; spin <= BASE_SPINS; spin += 1) {
        const bet = await spinForBet(sgapSession, sgapDriver, page);
        verificationResults.push(
          capCheck(`Base spin ${spin}`, Number(bet.win?.amount ?? 'NaN'), Number(bet.bet?.amount ?? 'NaN'), maxWin),
        );
      }

      if (await sgapSession.buyFeature.isAvailable()) {
        const buy = await buyFeatureForBetWithRetry(sgapSession, sgapDriver, page, { settleAfter: false });
        const stake = Number(buy.requestStake ?? buy.bet?.amount ?? 'NaN');
        const drained: readonly BetResponseSnapshot[] = await drainFreeSpins(
          sgapSession,
          sgapDriver,
          page,
          buy.raw,
          24,
        );
        const rounds = [buy, ...drained];
        rounds.forEach((round, index) => {
          verificationResults.push(
            capCheck(index === 0 ? 'Feature buy' : `Free spin ${index}`, Number(round.win?.amount ?? 'NaN'), stake, maxWin),
          );
        });
        const accumulated = Math.max(
          0,
          ...rounds.map((round) => Number(getByPath(round.raw, 'fsTotalAccumulatedWin') ?? 0)).filter(Number.isFinite),
        );
        verificationResults.push(capCheck('Feature accumulated win', accumulated, stake, maxWin));
        await settleCanvasToBaseGame(
          page,
          sgapDriver,
          sgapSession.manifest,
          sgapSession.platform.getInitializeBody(),
        );
      }

      await testInfo.attach('max-win-cap.json', {
        body: JSON.stringify(verificationResults, null, 2),
        contentType: 'application/json',
      });

      for (const result of verificationResults) {
        expect(result.passed, result.message).toBe(true);
      }

      await tracker.record({
        manualTestId: MANUAL_TEST_ID,
        status: 'passed',
        startedAt: (await tracker.get(MANUAL_TEST_ID))!.startedAt,
        finishedAt: new Date().toISOString(),
        browserProject: testInfo.project.name,
        verificationResults,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      await tracker.finish(MANUAL_TEST_ID, 'failed', message);
      const failed = await tracker.get(MANUAL_TEST_ID);
      if (failed !== undefined && verificationResults.length > 0) {
        await tracker.record({ ...failed, verificationResults });
      }
      throw error;
    } finally {
      await createDefaultExecutionReporters().publish(await tracker.list());
    }
  });
});
