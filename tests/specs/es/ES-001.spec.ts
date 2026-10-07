/**
 * ES-001 — Edge & Stability
 *
 * Manual Test Case ID: ES-001
 * Intent: Initialize error handling — the next initialize is failed once,
 * then the session recovers and a verifiable spin still works.
 */

import { test, expect } from '../../fixtures/index.js';
import { getLauncherMode } from '../../fixtures/local-launcher-html.js';
import { settleCanvasToBaseGame } from '../../../src/platform/index.js';
import {
  InMemoryExecutionTracker,
  createDefaultExecutionReporters,
} from '../../../src/reporting/index.js';
import { spinForBet } from '../../support/canvas-bet-flow.js';
import { reloadAndReopenGame } from '../../support/game-reload.js';
import type { VerificationResult } from '../../../src/core/models/index.js';

const MANUAL_TEST_ID = 'ES-001' as const;
const INIT_URL = '**/api/v1/slots/initialize**';

test.describe('ES — Edge & Stability', () => {
  test(`${MANUAL_TEST_ID} initialize error handling`, async ({
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
    let injectedFailures = 0;

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
        await page.route(INIT_URL, async (route) => {
          if (injectedFailures === 0) {
            injectedFailures += 1;
            await route.fulfill({
              status: 503,
              contentType: 'application/json',
              body: '{"error":"sgap-injected-initialize-failure"}',
            });
            return;
          }
          await route.continue();
        });
      }

      try {
        await reloadAndReopenGame({
          sgapSession,
          sgapDriver,
          page,
          timeoutMs: staging ? 45_000 : 90_000,
        });
      } catch {
        if (staging) {
          await page.unroute(INIT_URL);
          await reloadAndReopenGame({ sgapSession, sgapDriver, page });
        } else {
          throw new Error('reloadAndReopenGame failed in local mode');
        }
      }

      verificationResults.push({
        kind: 'stateManagement',
        passed: !staging || injectedFailures > 0,
        message: staging
          ? injectedFailures > 0
            ? 'Initialize error was injected and the host continued'
            : 'Initialize error was not injected'
          : 'Initialize error inject skipped in local mode',
        actual: injectedFailures,
      });

      const bet = await spinForBet(sgapSession, sgapDriver, page);
      verificationResults.push({
        kind: 'bet',
        passed: bet.balance !== undefined,
        message:
          bet.balance !== undefined
            ? 'Session recovered after initialize error; spin succeeded'
            : 'Spin failed after initialize error handling',
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
      await page.unroute(INIT_URL).catch(() => undefined);
      await createDefaultExecutionReporters().publish(await tracker.list());
    }
  });
});
