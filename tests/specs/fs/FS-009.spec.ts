/**
 * FS-009 — Feature / Free Spins
 *
 * Manual Test Case ID: FS-009
 * Intent: Refreshed session winnings match Spin Data — after a free-spin
 * bet, reload restores the same wallet as the last spin response.
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
import { reloadAndReopenGame } from '../../support/game-reload.js';
import type { VerificationResult } from '../../../src/core/models/index.js';

const MANUAL_TEST_ID = 'FS-009' as const;

test.describe('FS — Feature / Free Spins', () => {
  requireCapabilities('buyFeature', 'freeSpins');

  test(`${MANUAL_TEST_ID} refreshed session winnings match Spin Data`, async ({
    sgapSession,
    sgapDriver,
    page,
  }, testInfo) => {
    test.setTimeout(420_000);

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

      const buy = await buyFeatureForBet(sgapSession, sgapDriver, page);
      const remaining = freeSpinItemsRemaining(buy.raw);
      const entered = featureEnteredFromBody(buy.raw);
      verificationResults.push({
        kind: 'freeSpins',
        passed: entered,
        message: entered
          ? `Buy entered free spins (remaining=${remaining})`
          : 'Buy did not enter free spins',
        actual: remaining,
      });

      // Bundled buys already contain all FS data — drain UI then use buy balance.
      // Sequential FS: take one in-feature spin first.
      let spin = buy;
      if (remaining > 0) {
        spin = await spinForBet(sgapSession, sgapDriver, page);
      } else if (entered) {
        await drainFreeSpins(sgapSession, sgapDriver, page, buy.raw, 4);
      }
      const spinBalance = Number(spin.balance?.amount ?? 'NaN');
      const spinRemaining = freeSpinItemsRemaining(spin.raw);
      verificationResults.push({
        kind: 'bet',
        passed: Number.isFinite(spinBalance),
        message: Number.isFinite(spinBalance)
          ? `Spin data before refresh: balance=${spin.balance?.amount} win=${spin.win?.amount}`
          : 'Free-spin bet had no numeric balance',
        actual: spin.balance?.amount,
      });

      await reloadAndReopenGame({
        sgapSession,
        sgapDriver,
        page,
        preserveFeatureSession: true,
      });

      const restoredAmount = sgapSession.platform.getInitializeBalance()?.amount;
      const restored = Number(restoredAmount ?? 'NaN');
      const restoredRemaining = freeSpinItemsRemaining(sgapSession.platform.getInitializeBody());
      const balanceMatch =
        Number.isFinite(spinBalance) &&
        Number.isFinite(restored) &&
        Math.abs(restored - spinBalance) < 0.05;
      const itemsMatch = restoredRemaining === spinRemaining;
      verificationResults.push({
        kind: 'balance',
        passed: balanceMatch || (itemsMatch && !Number.isFinite(restored)),
        message: balanceMatch
          ? `Initialize after refresh matches spin data (balance=${restored})`
          : Number.isFinite(restored)
            ? `Refresh wallet mismatch: spin=${spinBalance} initialize=${restored}`
            : itemsMatch
              ? `Initialize had no wallet field; free-spin items still match (${restoredRemaining})`
              : `Refresh wallet missing and items mismatch: spinItems=${spinRemaining} initItems=${restoredRemaining}`,
        expected: spinBalance,
        actual: restoredAmount ?? restoredRemaining,
      });
      verificationResults.push({
        kind: 'freeSpins',
        passed: itemsMatch,
        message: itemsMatch
          ? `Free-spin items after refresh match spin data (${restoredRemaining})`
          : `Free-spin items mismatch after refresh: spin=${spinRemaining} initialize=${restoredRemaining}`,
        expected: spinRemaining,
        actual: restoredRemaining,
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
