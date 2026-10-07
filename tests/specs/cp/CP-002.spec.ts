/**
 * CP-002 — Currency Precision
 *
 * Manual Test Case ID: CP-002
 * Intent: History and Balance display 2 decimal places — validate balance (and win)
 * amounts from consecutive spins, plus initialize balance when present.
 */

import { test, expect } from '../../fixtures/index.js';
import { clearCanvasOverlays, settleCanvasToBaseGame } from '../../../src/platform/index.js';
import {
  InMemoryExecutionTracker,
  createDefaultExecutionReporters,
} from '../../../src/reporting/index.js';
import { spinForBet } from '../../support/canvas-bet-flow.js';
import type { VerificationResult } from '../../../src/core/models/index.js';

const MANUAL_TEST_ID = 'CP-002' as const;

function hasAtMostTwoDecimals(amount: string | undefined): boolean {
  if (amount === undefined || amount.trim() === '') {
    return false;
  }
  const n = Number(amount.trim());
  if (!Number.isFinite(n)) {
    return false;
  }
  const cents = Math.round(n * 100);
  return Math.abs(n * 100 - cents) < 1e-6;
}

test.describe('CP — Currency Precision', () => {
  test(`${MANUAL_TEST_ID} history and balance display 2 decimal places`, async ({
    sgapSession,
    sgapDriver,
    page,
  }, testInfo) => {
    test.setTimeout(360_000);

    const tracker = new InMemoryExecutionTracker();
    await tracker.start(MANUAL_TEST_ID, testInfo.project.name);

    testInfo.annotations.push(
      { type: 'manualTestId', description: MANUAL_TEST_ID },
      { type: 'category', description: 'CP' },
      { type: 'gameId', description: sgapSession.manifest.gameId },
    );

    let verificationResults: VerificationResult[] = [];

    try {
      await expect(sgapDriver.isAttached()).resolves.toBe(true);
      expect(sgapSession.betWatcher).toBeDefined();

      await sgapDriver.gameCanvas().waitFor({ state: 'visible' });
      await settleCanvasToBaseGame(
        page,
        sgapDriver,
        sgapSession.manifest,
        sgapSession.platform.getInitializeBody(),
      );

      const initBalance = sgapSession.initializeBalance?.amount;
      if (initBalance !== undefined) {
        const ok = hasAtMostTwoDecimals(initBalance);
        verificationResults.push({
          kind: 'balance',
          passed: ok,
          message: ok
            ? `Initialize balance ≤2 decimals: ${initBalance}`
            : `Initialize balance >2 decimals: "${initBalance}"`,
          actual: initBalance,
        });
      }

      // Two spins = mini "history" of balance / win fields from server.
      for (let i = 1; i <= 2; i += 1) {
        await clearCanvasOverlays(sgapDriver, sgapSession.manifest, 6, {
          forceGridSpam: true,
        });
        const bet = await spinForBet(sgapSession, sgapDriver, page);

        for (const check of [
          { label: `spin${i}.balance`, value: bet.balance?.amount },
          { label: `spin${i}.totalWin`, value: bet.win?.amount },
        ]) {
          const ok = hasAtMostTwoDecimals(check.value);
          verificationResults.push({
            kind: 'balance',
            passed: ok,
            message: ok
              ? `${check.label} ≤2 decimals: ${check.value}`
              : `${check.label} >2 decimals: "${check.value}"`,
            expected: '≤ 2 decimal places',
            actual: check.value,
          });
        }
      }

      expect(verificationResults.length).toBeGreaterThan(0);
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
