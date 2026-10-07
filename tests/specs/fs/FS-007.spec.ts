/**
 * FS-007 — Feature / Free Spins
 *
 * Manual Test Case ID: FS-007
 * Intent: Game state resets after Feature — spin is idle/unlocked and a
 * follow-up base-game spin works.
 */

import { test, expect } from '../../fixtures/index.js';
import { requireCapabilities } from '../../support/capabilities.js';
import { settleCanvasToBaseGame } from '../../../src/platform/index.js';
import {
  InMemoryExecutionTracker,
  createDefaultExecutionReporters,
} from '../../../src/reporting/index.js';
import { buyFeatureForBet, spinForBet } from '../../support/canvas-bet-flow.js';
import {
  featureEnteredFromBody,
  freeSpinItemsRemaining,
} from '../../support/buy-feature-verify.js';
import { drainFreeSpins } from '../../support/free-spin-flow.js';
import type { VerificationResult } from '../../../src/core/models/index.js';

const MANUAL_TEST_ID = 'FS-007' as const;

test.describe('FS — Feature / Free Spins', () => {
  requireCapabilities('buyFeature', 'freeSpins');

  test(`${MANUAL_TEST_ID} game state resets correctly after Feature`, async ({
    sgapSession,
    sgapDriver,
    page,
  }, testInfo) => {
    test.setTimeout(480_000);

    const tracker = new InMemoryExecutionTracker();
    await tracker.start(MANUAL_TEST_ID, testInfo.project.name);

    testInfo.annotations.push(
      { type: 'manualTestId', description: MANUAL_TEST_ID },
      { type: 'category', description: 'FS' },
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
      await sgapSession.turbo.enable({ timeoutMs: 15_000 }).catch(() => undefined);

      const buy = await buyFeatureForBet(sgapSession, sgapDriver, page);
      const entered = featureEnteredFromBody(buy.raw);
      verificationResults.push({
        kind: 'freeSpins',
        passed: entered,
        message: entered ? 'Buy entered feature' : 'Buy did not enter feature',
      });

      if (entered) {
        await drainFreeSpins(sgapSession, sgapDriver, page, buy.raw);
      } else {
        await settleCanvasToBaseGame(
          page,
          sgapDriver,
          sgapSession.manifest,
          buy.raw,
        );
      }

      if (!(await sgapDriver.isAttached())) {
        await sgapDriver.attach();
      }
      await settleCanvasToBaseGame(
        page,
        sgapDriver,
        sgapSession.manifest,
        sgapSession.platform.getInitializeBody(),
      );

      const available = await sgapSession.spin.isAvailable();
      const lock = await sgapSession.spin.getLockState();
      verificationResults.push({
        kind: 'stateManagement',
        passed: available && !lock.locked,
        message:
          available && !lock.locked
            ? 'Spin idle/unlocked after feature exit'
            : `Spin not reset after feature (available=${available}, locked=${lock.locked})`,
        expected: 'idle',
        actual: lock.locked ? lock.reason ?? 'locked' : available ? 'idle' : 'detached',
      });

      const followUp = await spinForBet(sgapSession, sgapDriver, page);
      verificationResults.push({
        kind: 'bet',
        passed: followUp.balance !== undefined && freeSpinItemsRemaining(followUp.raw) === 0,
        message:
          followUp.balance !== undefined && freeSpinItemsRemaining(followUp.raw) === 0
            ? 'Base-game spin after feature reset succeeded'
            : 'Follow-up spin after feature reset failed or still in free spins',
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
      await createDefaultExecutionReporters().publish(await tracker.list());
    }
  });
});
