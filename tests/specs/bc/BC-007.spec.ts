/**
 * BC-007 — Bet Control
 *
 * Manual Test Case ID: BC-007
 * Intent: Currency formatting is correct — stake / balance / win amounts from the
 * bet response are finite currency values with at most 2 decimal places (USD path
 * on Sugar staging). Multi-currency labels (KRW, TND, …) are validated when the
 * initialize payload exposes a currency code.
 */

import { test, expect } from '../../fixtures/index.js';
import { settleCanvasToBaseGame } from '../../../src/platform/index.js';
import {
  InMemoryExecutionTracker,
  createDefaultExecutionReporters,
} from '../../../src/reporting/index.js';
import { spinForBet } from '../../support/canvas-bet-flow.js';
import { getByPath } from '../../../src/shared/json-path.js';
import type { VerificationResult } from '../../../src/core/models/index.js';

const MANUAL_TEST_ID = 'BC-007' as const;

function isCurrencyAmount(amount: string | undefined): boolean {
  if (amount === undefined || amount.trim() === '') {
    return false;
  }
  const n = Number(amount);
  if (!Number.isFinite(n) || n < 0) {
    return false;
  }
  const cents = Math.round(n * 100);
  return Math.abs(n * 100 - cents) < 1e-6;
}

test.describe('BC — Bet Control', () => {
  test(`${MANUAL_TEST_ID} currency formatting correct`, async ({
    sgapSession,
    sgapDriver,
    page,
  }, testInfo) => {
    test.setTimeout(180_000);

    const tracker = new InMemoryExecutionTracker();
    await tracker.start(MANUAL_TEST_ID, testInfo.project.name);

    testInfo.annotations.push(
      { type: 'manualTestId', description: MANUAL_TEST_ID },
      { type: 'category', description: 'BC' },
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

      const initBody = sgapSession.platform.getInitializeBody();
      const currency =
        (getByPath(initBody, 'data.currency') as string | undefined) ??
        (getByPath(initBody, 'currency') as string | undefined) ??
        (getByPath(initBody, 'data.player.currency') as string | undefined);

      if (typeof currency === 'string' && currency.length > 0) {
        const known = /^(USD|ZAR|KRW|TND|EUR|GBP|CNY|JPY)$/i.test(currency);
        verificationResults.push({
          kind: 'bet',
          passed: known,
          message: known
            ? `Initialize currency code recognized: ${currency}`
            : `Unexpected currency code: ${currency}`,
          actual: currency,
        });
      }

      const bet = await spinForBet(sgapSession, sgapDriver, page);

      for (const check of [
        { label: 'stake', value: bet.bet?.amount },
        { label: 'balance', value: bet.balance?.amount },
        { label: 'totalWin', value: bet.win?.amount },
      ]) {
        if (check.value === undefined && check.label === 'stake') {
          continue;
        }
        const ok = isCurrencyAmount(check.value);
        verificationResults.push({
          kind: 'bet',
          passed: ok,
          message: ok
            ? `${check.label} is a well-formed currency amount: ${check.value}`
            : `${check.label} has invalid currency formatting: "${check.value}"`,
          expected: 'finite ≥0 with ≤2 decimals',
          actual: check.value,
        });
      }

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
