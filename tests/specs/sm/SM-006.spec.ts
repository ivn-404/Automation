/**
 * SM-006 — State Management
 *
 * Manual Test Case ID: SM-006
 * Regression meaning: No infinite loading — assets must load and be visible on
 * the reel table; the game must become playable.
 */

import { test, expect } from '../../fixtures/index.js';
import { primeCanvasSession, settleCanvasToBaseGame } from '../../../src/platform/index.js';
import {
  InMemoryExecutionTracker,
  createDefaultExecutionReporters,
} from '../../../src/reporting/index.js';
import { spinForBet } from '../../support/canvas-bet-flow.js';
import type { VerificationResult } from '../../../src/core/models/index.js';

const MANUAL_TEST_ID = 'SM-006' as const;
const LOAD_TIMEOUT_MS = 90_000;

test.describe('SM — State Management', () => {
  test(`${MANUAL_TEST_ID} no infinite loading state`, async ({
    sgapSession,
    sgapDriver,
    page,
  }, testInfo) => {
    test.setTimeout(360_000);

    const tracker = new InMemoryExecutionTracker();
    await tracker.start(MANUAL_TEST_ID, testInfo.project.name);

    testInfo.annotations.push(
      { type: 'manualTestId', description: MANUAL_TEST_ID },
      { type: 'category', description: 'SM' },
      { type: 'gameId', description: sgapSession.manifest.gameId },
    );

    let verificationResults: VerificationResult[] = [];

    try {
      await expect(sgapDriver.isAttached()).resolves.toBe(true);
      await expect(sgapSession.spin.isAvailable()).resolves.toBe(true);

      const reloadStarted = Date.now();
      await page.reload({ waitUntil: 'domcontentloaded', timeout: LOAD_TIMEOUT_MS });
      await sgapSession.platform.openGameHost({ timeoutMs: LOAD_TIMEOUT_MS });
      await sgapSession.platform.openGame({ timeoutMs: LOAD_TIMEOUT_MS });
      await sgapSession.platform.prepareActiveGameView({ timeoutMs: LOAD_TIMEOUT_MS });
      await sgapDriver.attach();
      await primeCanvasSession({
        page,
        driver: sgapDriver,
        manifest: sgapSession.manifest,
        initializeBody: sgapSession.platform.getInitializeBody(),
      });

      const canvas = sgapDriver.gameCanvas();
      await canvas.waitFor({ state: 'visible', timeout: LOAD_TIMEOUT_MS });
      const loadMs = Date.now() - reloadStarted;

      await settleCanvasToBaseGame(
        page,
        sgapDriver,
        sgapSession.manifest,
        sgapSession.platform.getInitializeBody(),
      );

      verificationResults.push({
        kind: 'stateManagement',
        passed: loadMs <= LOAD_TIMEOUT_MS,
        message: `Game canvas visible after reload (${loadMs}ms)`,
        expected: `<= ${LOAD_TIMEOUT_MS}ms`,
        actual: loadMs,
      });

      const bet = await spinForBet(sgapSession, sgapDriver, page);
      verificationResults.push({
        kind: 'stateManagement',
        passed: bet.balance !== undefined,
        message:
          bet.balance !== undefined
            ? 'Post-reload spin succeeded (no infinite loading / freeze)'
            : 'Post-reload spin failed — possible loading hang',
        actual: bet.balance?.amount,
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
