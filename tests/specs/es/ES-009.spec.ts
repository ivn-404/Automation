/**
 * ES-009 — Edge & Stability
 *
 * Manual Test Case ID: ES-009
 * Intent: Network delay handling — a delayed bet still completes, and a
 * follow-up spin works after the delay is removed.
 */

import { test, expect } from '../../fixtures/index.js';
import { getLauncherMode } from '../../fixtures/local-launcher-html.js';
import { settleCanvasToBaseGame } from '../../../src/platform/index.js';
import {
  InMemoryExecutionTracker,
  createDefaultExecutionReporters,
} from '../../../src/reporting/index.js';
import { spinForBet } from '../../support/canvas-bet-flow.js';
import type { VerificationResult } from '../../../src/core/models/index.js';

const MANUAL_TEST_ID = 'ES-009' as const;
const BET_DELAY_MS = 2_500;
const BET_URL = '**/api/v1/slots/bet**';

test.describe('ES — Edge & Stability', () => {
  test(`${MANUAL_TEST_ID} network delay handling`, async ({
    sgapSession,
    sgapDriver,
    page,
  }, testInfo) => {
    test.setTimeout(300_000);

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
      await settleCanvasToBaseGame(
        page,
        sgapDriver,
        sgapSession.manifest,
        sgapSession.platform.getInitializeBody(),
      );

      const staging = getLauncherMode() === 'staging';
      if (staging) {
        await page.route(BET_URL, async (route) => {
          await new Promise((resolve) => {
            setTimeout(resolve, BET_DELAY_MS);
          });
          await route.continue();
        });
      }

      const delayed = await spinForBet(sgapSession, sgapDriver, page);
      verificationResults.push({
        kind: 'stateManagement',
        passed: delayed.balance !== undefined,
        message:
          delayed.balance !== undefined
            ? staging
              ? `Spin completed through ${BET_DELAY_MS}ms bet delay`
              : 'Spin completed (delay inject skipped in local mode)'
            : 'Spin failed while bet responses were delayed',
        actual: delayed.balance?.amount,
      });

      if (staging) {
        await page.unroute(BET_URL);
      }

      const followUp = await spinForBet(sgapSession, sgapDriver, page);
      verificationResults.push({
        kind: 'bet',
        passed: followUp.balance !== undefined,
        message:
          followUp.balance !== undefined
            ? 'Follow-up spin after network delay recovered'
            : 'Follow-up spin failed after network delay',
        actual: followUp.balance?.amount,
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
      await page.unroute(BET_URL).catch(() => undefined);
      await createDefaultExecutionReporters().publish(await tracker.list());
    }
  });
});
