/**
 * ES-010 — Edge & Stability
 *
 * Manual Test Case ID: ES-010
 * Intent: Game recovery after refresh — reload the host, reopen the game,
 * and confirm a verifiable spin still works.
 */

import { test, expect } from '../../fixtures/index.js';
import { primeCanvasSession, settleCanvasToBaseGame } from '../../../src/platform/index.js';
import {
  InMemoryExecutionTracker,
  createDefaultExecutionReporters,
} from '../../../src/reporting/index.js';
import { spinForBet } from '../../support/canvas-bet-flow.js';
import type { VerificationResult } from '../../../src/core/models/index.js';

const MANUAL_TEST_ID = 'ES-010' as const;
const LOAD_TIMEOUT_MS = 90_000;

test.describe('ES — Edge & Stability', () => {
  test(`${MANUAL_TEST_ID} game recovery after refresh`, async ({
    sgapSession,
    sgapDriver,
    page,
  }, testInfo) => {
    test.setTimeout(360_000);

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

      await sgapDriver.gameCanvas().waitFor({
        state: 'visible',
        timeout: LOAD_TIMEOUT_MS,
      });
      await settleCanvasToBaseGame(
        page,
        sgapDriver,
        sgapSession.manifest,
        sgapSession.platform.getInitializeBody(),
      );

      const bet = await spinForBet(sgapSession, sgapDriver, page);
      verificationResults.push({
        kind: 'stateManagement',
        passed: bet.balance !== undefined,
        message:
          bet.balance !== undefined
            ? `Recovered after refresh; spin balance=${bet.balance.amount}`
            : 'Post-refresh spin failed — session did not recover',
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
