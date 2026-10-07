/**
 * ES-011 — Edge & Stability
 *
 * Manual Test Case ID: ES-011
 * Intent: No console / page errors during a verifiable gameplay spin.
 */

import { test, expect } from '../../fixtures/index.js';
import { settleCanvasToBaseGame } from '../../../src/platform/index.js';
import {
  InMemoryExecutionTracker,
  createDefaultExecutionReporters,
} from '../../../src/reporting/index.js';
import { spinForBet } from '../../support/canvas-bet-flow.js';
import { installConsoleErrorCollector } from '../../support/console-errors.js';
import type { VerificationResult } from '../../../src/core/models/index.js';

const MANUAL_TEST_ID = 'ES-011' as const;

test.describe('ES — Edge & Stability', () => {
  test(`${MANUAL_TEST_ID} no console errors during gameplay`, async ({
    sgapSession,
    sgapDriver,
    page,
  }, testInfo) => {
    test.setTimeout(240_000);

    const tracker = new InMemoryExecutionTracker();
    await tracker.start(MANUAL_TEST_ID, testInfo.project.name);

    testInfo.annotations.push(
      { type: 'manualTestId', description: MANUAL_TEST_ID },
      { type: 'category', description: 'ES' },
      { type: 'gameId', description: sgapSession.manifest.gameId },
    );

    const { errors } = installConsoleErrorCollector(page);
    let verificationResults: VerificationResult[] = [];

    try {
      await expect(sgapDriver.isAttached()).resolves.toBe(true);
      await expect(sgapSession.spin.isAvailable()).resolves.toBe(true);

      await sgapDriver.gameCanvas().waitFor({ state: 'visible' });
      await settleCanvasToBaseGame(
        page,
        sgapDriver,
        sgapSession.manifest,
        sgapSession.platform.getInitializeBody(),
      );

      const bet = await spinForBet(sgapSession, sgapDriver, page);
      verificationResults.push({
        kind: 'bet',
        passed: bet.balance !== undefined,
        message:
          bet.balance !== undefined
            ? 'Gameplay spin completed while collecting console errors'
            : 'Spin failed while collecting console errors',
        actual: bet.balance?.amount,
      });
      verificationResults.push({
        kind: 'stateManagement',
        passed: errors.length === 0,
        message:
          errors.length === 0
            ? 'No page/console errors during gameplay'
            : `Console/page errors during gameplay: ${errors.slice(0, 3).join(' | ')}`,
        expected: '0 errors',
        actual: errors.length,
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
