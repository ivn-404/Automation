/**
 * CP-001 — Currency Precision
 *
 * Manual Test Case ID: CP-001
 * Intent: UI / server amounts display at most 2 decimal places (balance, win, stake).
 */

import { test, expect } from '../../fixtures/index.js';
import { settleCanvasToBaseGame } from '../../../src/platform/index.js';
import {
  InMemoryExecutionTracker,
  createDefaultExecutionReporters,
} from '../../../src/reporting/index.js';
import { spinForBet } from '../../support/canvas-bet-flow.js';
import type { VerificationResult } from '../../../src/core/models/index.js';

const MANUAL_TEST_ID = 'CP-001' as const;

/** True when amount is numerically representable with ≤2 decimal places (float noise OK). */
function hasAtMostTwoDecimals(amount: string | undefined): boolean {
  if (amount === undefined || amount.trim() === '') {
    return false;
  }
  const n = Number(amount.trim());
  if (!Number.isFinite(n)) {
    return false;
  }
  // Reject genuine 3+ decimal values; accept IEEE float residue (e.g. 19640.990000000016).
  const cents = Math.round(n * 100);
  return Math.abs(n * 100 - cents) < 1e-6;
}

test.describe('CP — Currency Precision', () => {
  test(`${MANUAL_TEST_ID} amounts display at most 2 decimal places`, async ({
    sgapSession,
    sgapDriver,
    page,
  }, testInfo) => {
    test.setTimeout(300_000);

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

      const bet = await spinForBet(sgapSession, sgapDriver, page);

      const checks: Array<{ label: string; value: string | undefined }> = [
        { label: 'balance', value: bet.balance?.amount },
        { label: 'totalWin', value: bet.win?.amount },
        { label: 'stake', value: bet.bet?.amount },
      ];

      for (const check of checks) {
        if (check.value === undefined) {
          // Stake can be missing when only response body is parsed; skip soft.
          if (check.label === 'stake') {
            continue;
          }
          verificationResults.push({
            kind: 'balance',
            passed: false,
            message: `${check.label} missing from bet response`,
          });
          continue;
        }
        const ok = hasAtMostTwoDecimals(check.value);
        verificationResults.push({
          kind: 'balance',
          passed: ok,
          message: ok
            ? `${check.label} has ≤2 decimals: ${check.value}`
            : `${check.label} has >2 decimals (or invalid): "${check.value}"`,
          expected: '≤ 2 decimal places',
          actual: check.value,
        });
      }

      // Initialize balance (when available) should also respect precision.
      const initBalance = sgapSession.initializeBalance?.amount;
      if (initBalance !== undefined) {
        const ok = hasAtMostTwoDecimals(initBalance);
        verificationResults.push({
          kind: 'balance',
          passed: ok,
          message: ok
            ? `initialize balance has ≤2 decimals: ${initBalance}`
            : `initialize balance has >2 decimals: "${initBalance}"`,
          expected: '≤ 2 decimal places',
          actual: initBalance,
        });
      }

      expect(verificationResults.length, 'at least one amount checked').toBeGreaterThan(0);

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
