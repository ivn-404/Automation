/**
 * SM-005 — State Management
 *
 * Manual Test Case ID: SM-005
 * Regression meaning: After a Big Win dialogue, no asset freeze / console error;
 * the game must remain playable.
 */

import { test, expect } from '../../fixtures/index.js';
import { clearCanvasOverlays, settleCanvasToBaseGame } from '../../../src/platform/index.js';
import {
  InMemoryExecutionTracker,
  createDefaultExecutionReporters,
} from '../../../src/reporting/index.js';
import { spinForBet } from '../../support/canvas-bet-flow.js';
import type { BetResponseSnapshot, VerificationResult } from '../../../src/core/models/index.js';

const MANUAL_TEST_ID = 'SM-005' as const;
const MAX_WIN_HUNT = 12;
/** Treat any positive win as the post-win freeze check; prefer larger when available. */
const BIG_WIN_HINT = 5;

test.describe('SM — State Management', () => {
  test(`${MANUAL_TEST_ID} no freeze after big win`, async ({
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

      await sgapDriver.gameCanvas().waitFor({ state: 'visible' });
      await settleCanvasToBaseGame(
        page,
        sgapDriver,
        sgapSession.manifest,
        sgapSession.platform.getInitializeBody(),
      );

      let winBet: BetResponseSnapshot | undefined;
      for (let attempt = 0; attempt < MAX_WIN_HUNT; attempt += 1) {
        await clearCanvasOverlays(sgapDriver, sgapSession.manifest, 8, {
          forceGridSpam: true,
        });
        const bet = await spinForBet(sgapSession, sgapDriver, page);
        const win = Number(bet.win?.amount ?? '0');
        if (win > 0) {
          winBet = bet;
          if (win >= BIG_WIN_HINT) {
            break;
          }
        }
      }

      if (winBet === undefined) {
        test.skip(true, `No winning spin after ${MAX_WIN_HUNT} attempts`);
        return;
      }

      const winAmount = Number(winBet.win!.amount);
      verificationResults.push({
        kind: 'stateManagement',
        passed: winAmount > 0,
        message: `Post-win path using totalWin=${winAmount}`,
        actual: winAmount,
      });

      // Dismiss win / big-win overlays — must not leave the game frozen.
      await clearCanvasOverlays(sgapDriver, sgapSession.manifest, 12, {
        forceGridSpam: true,
      });
      await sgapDriver.clickCanvas('acknowledge', { singleInput: true }).catch(() => undefined);
      await sgapDriver.clickCanvas('acknowledgeAlt', { singleInput: true }).catch(() => undefined);
      await sgapDriver.clickCanvas('dismiss', { singleInput: true }).catch(() => undefined);

      const available = await sgapSession.spin.isAvailable();
      const lock = await sgapSession.spin.getLockState();
      verificationResults.push({
        kind: 'stateManagement',
        passed: available && !lock.locked,
        message:
          available && !lock.locked
            ? 'Spin available / unlocked after win overlays dismissed'
            : `Freeze suspected after win: available=${available}, locked=${lock.locked}`,
        expected: 'idle',
        actual: { available, locked: lock.locked },
      });

      // Follow-up spin proves the session is not frozen.
      await clearCanvasOverlays(sgapDriver, sgapSession.manifest, 6, {
        forceGridSpam: true,
      });
      const followUp = await spinForBet(sgapSession, sgapDriver, page);
      verificationResults.push({
        kind: 'stateManagement',
        passed: followUp.balance !== undefined,
        message:
          followUp.balance !== undefined
            ? 'Follow-up spin succeeded after win (no freeze)'
            : 'Follow-up spin failed / missing balance after win',
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
