/**
 * AT-007 — Additional Test
 *
 * Manual Test Case ID: AT-007
 * Intent: Scroll and page orientation — host scroll must not leave the game
 * iframe in landscape ("Rotate to portrait"). Play remains verifiable.
 */

import { test, expect } from '../../fixtures/index.js';
import { settleCanvasToBaseGame } from '../../../src/platform/index.js';
import {
  describeOrientation,
  healPortraitOrientation,
  readOrientation,
} from '../../../src/platform/portrait-guard.js';
import {
  InMemoryExecutionTracker,
  createDefaultExecutionReporters,
} from '../../../src/reporting/index.js';
import { spinForBet } from '../../support/canvas-bet-flow.js';
import { verifyBetSpinOutcome } from '../../../src/verification/bet-response-verification.js';
import type { VerificationResult } from '../../../src/core/models/index.js';

const MANUAL_TEST_ID = 'AT-007' as const;

test.describe('AT — Additional Test', () => {
  test(`${MANUAL_TEST_ID} scroll and page orientation`, async ({
    sgapSession,
    sgapDriver,
    page,
  }, testInfo) => {
    test.setTimeout(300_000);

    const tracker = new InMemoryExecutionTracker();
    await tracker.start(MANUAL_TEST_ID, testInfo.project.name);

    testInfo.annotations.push(
      { type: 'manualTestId', description: MANUAL_TEST_ID },
      { type: 'category', description: 'AT' },
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
      await sgapSession.turbo.enable({ timeoutMs: 15_000 }).catch(() => undefined);

      const iframeSelector =
        sgapSession.manifest.locatorKeys.gameIframe ?? 'iframe[title="Game session"]';

      const before = await readOrientation(page, sgapSession.manifest);
      verificationResults.push({
        kind: 'stateManagement',
        passed: before.portrait || !before.readable,
        message: `Before scroll: ${describeOrientation(before)}`,
        actual: before,
      });

      await page.evaluate(() => {
        const view = globalThis as unknown as {
          scrollTo: (x: number, y: number) => void;
          scrollBy: (x: number, y: number) => void;
        };
        view.scrollBy(0, 240);
        view.scrollTo(0, 320);
      });
      await page.waitForTimeout(400);
      await page.evaluate(() => {
        const view = globalThis as unknown as { scrollTo: (x: number, y: number) => void };
        view.scrollTo(0, 0);
      });

      const heal = await healPortraitOrientation(page, sgapSession.manifest, iframeSelector, {
        allowViewportResize: false,
      });
      const after = heal.after;
      verificationResults.push({
        kind: 'stateManagement',
        passed: after.portrait || heal.healed,
        message: `After host scroll: ${describeOrientation(after)} (heal=${heal.outcome})`,
        actual: after,
      });

      const bet = await spinForBet(sgapSession, sgapDriver, page);
      verificationResults.push(...verifyBetSpinOutcome(bet, { requireCompleted: true }));

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
      await tracker.record({
        manualTestId: MANUAL_TEST_ID,
        status: 'failed',
        startedAt: (await tracker.get(MANUAL_TEST_ID))!.startedAt,
        finishedAt: new Date().toISOString(),
        browserProject: testInfo.project.name,
        errorMessage: message,
        verificationResults,
      });
      throw error;
    } finally {
      await createDefaultExecutionReporters().publish(await tracker.list());
    }
  });
});
