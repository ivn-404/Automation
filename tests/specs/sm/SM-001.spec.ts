/**
 * SM-001 — State Management
 *
 * Manual Test Case ID: SM-001
 * Intent: Cannot spin during feature intro animation — after buy confirm,
 * spin is locked or a tap does not fire a new bet during intro.
 */

import { test, expect } from '../../fixtures/index.js';
import { requireCapabilities } from '../../support/capabilities.js';
import type { Response } from 'playwright';
import { settleCanvasToBaseGame } from '../../../src/platform/index.js';
import {
  InMemoryExecutionTracker,
  createDefaultExecutionReporters,
} from '../../../src/reporting/index.js';
import { buyFeatureForBet } from '../../support/canvas-bet-flow.js';
import {
  featureEnteredFromBody,
  freeSpinItemsRemaining,
} from '../../support/buy-feature-verify.js';
import type { VerificationResult } from '../../../src/core/models/index.js';
import { matchesBetUrl } from '../../../src/network/bet-url.js';

const MANUAL_TEST_ID = 'SM-001' as const;

const isBetResponse = (response: Response): boolean =>
  response.ok() && matchesBetUrl(response.url());

test.describe('SM — State Management', () => {
  requireCapabilities('buyFeature');

  test(`${MANUAL_TEST_ID} cannot spin during feature intro`, async ({
    sgapSession,
    sgapDriver,
    page,
  }, testInfo) => {
    test.setTimeout(300_000);

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
      await expect(sgapSession.buyFeature.isAvailable()).resolves.toBe(true);

      await sgapDriver.gameCanvas().waitFor({ state: 'visible' });
      await settleCanvasToBaseGame(
        page,
        sgapDriver,
        sgapSession.manifest,
        sgapSession.platform.getInitializeBody(),
      );

      const buyBet = await buyFeatureForBet(sgapSession, sgapDriver, page, {
        settleAfter: false,
      });
      const featureActive = featureEnteredFromBody(buyBet.raw);
      verificationResults.push({
        kind: 'stateManagement',
        passed: featureActive,
        message: featureActive
          ? `Buy entered feature session (freeSpin items=${freeSpinItemsRemaining(buyBet.raw)})`
          : 'Buy did not enter a feature session — cannot assert intro spin lock',
        actual: freeSpinItemsRemaining(buyBet.raw),
      });

      const lock = await sgapSession.spin.getLockState();
      const available = await sgapSession.spin.isAvailable();
      const controllerBlocked = lock.locked || !available;

      let postClickBet = false;
      if (!controllerBlocked) {
        const onResponse = (response: Response): void => {
          if (isBetResponse(response)) {
            postClickBet = true;
          }
        };
        page.on('response', onResponse);
        await sgapSession.spin.clickSpin({ timeoutMs: 5_000, singleInput: true }).catch(() => undefined);
        await page.waitForTimeout(2_000);
        page.off('response', onResponse);
      }

      verificationResults.push({
        kind: 'stateManagement',
        passed: controllerBlocked || !postClickBet,
        message: controllerBlocked
          ? `Spin blocked during feature intro (locked=${lock.locked}, available=${available})`
          : postClickBet
            ? 'Spin tap fired a bet during feature intro (expected blocked)'
            : 'Spin tap did not fire a bet during feature intro',
        expected: 'locked or no post-click bet',
        actual: { locked: lock.locked, available, postClickBet },
      });

      for (const result of verificationResults) {
        expect(result.passed, result.message).toBe(true);
      }

      expect(buyBet.balance).toBeDefined();

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
