/**
 * TM-004 — Turbo Mode
 *
 * Manual Test Case ID: TM-004
 * Intent: a lightning tap does not break win-dialogue dismiss. Pass = /bet
 * completes, overlay can be cleared, follow-up spin still completes.
 * Do not use isEnhancedBet.
 */

import { test, expect } from '../../fixtures/index.js';
import { requireCapabilities } from '../../support/capabilities.js';
import {
  clearCanvasOverlays,
  settleCanvasToBaseGame,
  spamClickSkip,
} from '../../../src/platform/index.js';
import {
  InMemoryExecutionTracker,
  createDefaultExecutionReporters,
} from '../../../src/reporting/index.js';
import { spinForBet } from '../../support/canvas-bet-flow.js';
import { prepareCanvasTurbo } from '../../support/canvas-bet-control.js';
import { verifyBetSpinOutcome } from '../../../src/verification/bet-response-verification.js';
import type { BetResponseSnapshot, VerificationResult } from '../../../src/core/models/index.js';

const MANUAL_TEST_ID = 'TM-004' as const;
const MAX_WIN_HUNT = 12;

test.describe('TM — Turbo Mode', () => {
  requireCapabilities('turbo');

  test(`${MANUAL_TEST_ID} lightning tap does not break win dialogue`, async ({
    sgapSession,
    sgapDriver,
    page,
  }, testInfo) => {
    test.setTimeout(360_000);

    const tracker = new InMemoryExecutionTracker();
    await tracker.start(MANUAL_TEST_ID, testInfo.project.name);

    testInfo.annotations.push(
      { type: 'manualTestId', description: MANUAL_TEST_ID },
      { type: 'category', description: 'TM' },
      { type: 'gameId', description: sgapSession.manifest.gameId },
    );

    let verificationResults: VerificationResult[] = [];

    try {
      await expect(sgapDriver.isAttached()).resolves.toBe(true);
      await expect(sgapSession.turbo.isAvailable()).resolves.toBe(true);
      await expect(sgapSession.spin.isAvailable()).resolves.toBe(true);

      await sgapDriver.gameCanvas().waitFor({ state: 'visible' });
      await settleCanvasToBaseGame(
        page,
        sgapDriver,
        sgapSession.manifest,
        sgapSession.platform.getInitializeBody(),
      );

      await clearCanvasOverlays(sgapDriver, sgapSession.manifest, 4);
      await prepareCanvasTurbo(sgapSession, sgapDriver, page);
      await sgapSession.turbo.enable({ timeoutMs: 15_000 });

      let winBet: BetResponseSnapshot | undefined;
      for (let attempt = 0; attempt < MAX_WIN_HUNT; attempt += 1) {
        await clearCanvasOverlays(sgapDriver, sgapSession.manifest, 6);
        const bet = await spinForBet(sgapSession, sgapDriver, page);
        verificationResults.push(...verifyBetSpinOutcome(bet, { requireCompleted: true }));
        const win = Number(bet.win?.amount ?? '0');
        if (win > 0) {
          winBet = bet;
          break;
        }
      }

      if (winBet === undefined) {
        test.skip(true, `No winning spin after ${MAX_WIN_HUNT} attempts`);
        return;
      }

      await spamClickSkip(sgapDriver, sgapSession.manifest, 4, { force: true });
      await clearCanvasOverlays(sgapDriver, sgapSession.manifest, 10);
      await sgapDriver.clickCanvas('acknowledge', { singleInput: true }).catch(() => undefined);
      await sgapDriver.clickCanvas('dismiss', { singleInput: true }).catch(() => undefined);

      const available = await sgapSession.spin.isAvailable();
      const lock = await sgapSession.spin.getLockState();
      verificationResults.push({
        kind: 'stateManagement',
        passed: available && !lock.locked,
        message:
          available && !lock.locked
            ? 'Win dialogue dismissed; spin idle'
            : `Win dialogue path stuck: available=${available}, locked=${lock.locked}`,
        actual: { available, locked: lock.locked },
      });

      await clearCanvasOverlays(sgapDriver, sgapSession.manifest, 4);
      const followUp = await spinForBet(sgapSession, sgapDriver, page);
      verificationResults.push(...verifyBetSpinOutcome(followUp, { requireCompleted: true }));

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
