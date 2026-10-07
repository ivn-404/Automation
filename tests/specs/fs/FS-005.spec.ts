/**
 * FS-005 — Feature / Free Spins
 *
 * Manual Test Case ID: FS-005
 * Intent: Multiplier applies correctly — free-spin payloads expose a finite
 * multiplierValue, and credited feature wins are at least the raw item wins
 * when a multiplier > 1 is present.
 */

import { test, expect } from '../../fixtures/index.js';
import { requireCapabilities } from '../../support/capabilities.js';
import { settleCanvasToBaseGame } from '../../../src/platform/index.js';
import {
  InMemoryExecutionTracker,
  createDefaultExecutionReporters,
} from '../../../src/reporting/index.js';
import { buyFeatureForBet } from '../../support/canvas-bet-flow.js';
import { featureEnteredFromBody } from '../../support/buy-feature-verify.js';
import {
  drainFreeSpins,
  readFreeSpinSession,
  sumWinAmounts,
} from '../../support/free-spin-flow.js';
import { getByPath } from '../../../src/shared/json-path.js';
import type { VerificationResult } from '../../../src/core/models/index.js';

const MANUAL_TEST_ID = 'FS-005' as const;

function slotTotalWin(body: unknown): number {
  const candidates = [
    getByPath(body, 'slot.totalWin'),
    getByPath(body, 'totalWin'),
    getByPath(body, 'win.amount'),
    getByPath(body, 'win'),
  ];
  for (const raw of candidates) {
    const value = Number(raw);
    if (Number.isFinite(value)) {
      return value;
    }
  }
  return Number.NaN;
}

test.describe('FS — Feature / Free Spins', () => {
  requireCapabilities('buyFeature', 'freeSpins', 'multiplierWild');

  test(`${MANUAL_TEST_ID} multiplier applies correctly`, async ({
    sgapSession,
    sgapDriver,
    page,
  }, testInfo) => {
    test.setTimeout(720_000);

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
      const session = readFreeSpinSession(buy.raw, { manifest: sgapSession.manifest });
      const multiplier = session?.multiplierValue ?? Number.NaN;

      verificationResults.push({
        kind: 'freeSpins',
        passed: entered && Number.isFinite(multiplier) && multiplier >= 0,
        message:
          entered && Number.isFinite(multiplier) && multiplier >= 0
            ? `Feature multiplier present (multiplierValue=${multiplier})`
            : 'Feature missing a finite free-spin multiplierValue',
        actual: multiplier,
      });

      const slotWin = slotTotalWin(buy.raw);
      const itemWins = session?.sumItemWins ?? 0;
      // When multiplier > 1 and item wins exist, slot total should not under-credit them.
      const multipliedOk =
        !Number.isFinite(slotWin) ||
        itemWins <= 0 ||
        multiplier <= 1 ||
        slotWin + 0.05 >= itemWins;
      verificationResults.push({
        kind: 'win',
        passed: multipliedOk,
        message: multipliedOk
          ? `Multiplier credit consistent (slotWin=${slotWin}, itemWins=${itemWins}, mult=${multiplier})`
          : `Slot totalWin ${slotWin} below raw item wins ${itemWins} with mult=${multiplier}`,
        expected: itemWins,
        actual: slotWin,
      });

      const fsSpins = entered
        ? await drainFreeSpins(sgapSession, sgapDriver, page, buy.raw, 24)
        : [];
      const credited = sumWinAmounts(fsSpins);
      const walletStart = Number(buy.balance?.amount ?? 'NaN');
      const walletEnd = Number(fsSpins.at(-1)?.balance?.amount ?? buy.balance?.amount ?? 'NaN');
      const walletGain = walletEnd - walletStart;
      const walletOk = !Number.isFinite(walletGain) || walletGain >= -0.02;
      verificationResults.push({
        kind: 'balance',
        passed: walletOk,
        message: walletOk
          ? `Wallet respected feature wins after multiplier (gain=${walletGain}, parsed=${credited})`
          : `Wallet dropped during feature (gain=${walletGain})`,
        actual: walletGain,
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
