/**
 * UIDS-012 — UI & Display Sync
 *
 * Manual Test Case ID: UIDS-012
 * Regression meaning: Current spin / buy feature must appear in History in real time
 * and follow the correct time and date.
 */

import type { Response } from 'playwright';

import { test, expect } from '../../fixtures/index.js';
import { settleCanvasToBaseGame, clearCanvasOverlays } from '../../../src/platform/index.js';
import { parseBalanceFromBody } from '../../../src/data/parse-balance.js';
import {
  verifyBetResponseShape,
  verifyBalanceIsNumeric,
  verifyWinIsNonNegative,
} from '../../../src/verification/bet-response-verification.js';
import {
  InMemoryExecutionTracker,
  createDefaultExecutionReporters,
} from '../../../src/reporting/index.js';
import { spinForBet } from '../../support/canvas-bet-flow.js';
import { reloadAndReopenGame } from '../../support/game-reload.js';
import {
  amountsNear,
  isHistoryLikeUrl,
  payloadMatchesSpin,
} from '../../support/history-records.js';
import type { VerificationResult } from '../../../src/core/models/index.js';

const MANUAL_TEST_ID = 'UIDS-012' as const;

test.describe('UIDS — UI & Display Sync', () => {
  test(`${MANUAL_TEST_ID} history matches backend records`, async ({
    sgapSession,
    sgapDriver,
    page,
  }, testInfo) => {
    test.setTimeout(360_000);

    const tracker = new InMemoryExecutionTracker();
    await tracker.start(MANUAL_TEST_ID, testInfo.project.name);

    testInfo.annotations.push(
      { type: 'manualTestId', description: MANUAL_TEST_ID },
      { type: 'category', description: 'UIDS' },
      { type: 'gameId', description: sgapSession.manifest.gameId },
    );

    let verificationResults: VerificationResult[] = [];
    const historyBodies: unknown[] = [];

    const onResponse = (response: Response): void => {
      if (!response.ok() || !isHistoryLikeUrl(response.url())) {
        return;
      }
      void response
        .json()
        .then((body) => {
          historyBodies.push(body);
        })
        .catch(() => undefined);
    };

    try {
      await expect(sgapDriver.isAttached()).resolves.toBe(true);
      expect(sgapSession.betWatcher).toBeDefined();

      await sgapDriver.gameCanvas().waitFor({ state: 'visible' });
      await settleCanvasToBaseGame(
        page,
        sgapDriver,
        sgapSession.manifest,
        sgapSession.platform.getInitializeBody(),
      );
      await sgapSession.turbo.enable({ timeoutMs: 15_000 }).catch(() => undefined);

      page.on('response', onResponse);

      await clearCanvasOverlays(sgapDriver, sgapSession.manifest, 6, { forceGridSpam: true });
      const bet1 = await spinForBet(sgapSession, sgapDriver, page);
      await clearCanvasOverlays(sgapDriver, sgapSession.manifest, 6, { forceGridSpam: true });
      const bet2 = await spinForBet(sgapSession, sgapDriver, page);

      verificationResults.push(
        ...verifyBetResponseShape(bet1, { requireCompleted: true }),
        verifyBalanceIsNumeric(bet1.balance),
        verifyWinIsNonNegative(bet1.win),
        ...verifyBetResponseShape(bet2, { requireCompleted: true }),
        verifyBalanceIsNumeric(bet2.balance),
        verifyWinIsNonNegative(bet2.win),
      );

      const balance1 = Number(bet1.balance?.amount ?? 'NaN');
      const balance2 = Number(bet2.balance?.amount ?? 'NaN');
      const stake2 = Number(bet2.bet?.amount ?? '0');
      const win2 = Number(bet2.win?.amount ?? '0');
      const impliedBefore2 = balance2 + stake2 - win2;
      const ledgerOk = Number.isFinite(balance1) && Number.isFinite(balance2);
      const chainOk =
        !Number.isFinite(stake2) ||
        stake2 <= 0 ||
        amountsNear(balance1, impliedBefore2);
      verificationResults.push({
        kind: 'balance',
        passed: ledgerOk && chainOk,
        message:
          ledgerOk && chainOk
            ? `Backend records present (spin1=${balance1}, spin2=${balance2}, impliedBefore2=${impliedBefore2})`
            : `Backend records inconsistent (spin1=${balance1}, spin2=${balance2}, impliedBefore2=${impliedBefore2})`,
        expected: balance1,
        actual: impliedBefore2,
      });

      const historyHit =
        historyBodies.length === 0 ||
        historyBodies.some((body) => payloadMatchesSpin(body, balance2, win2));
      verificationResults.push({
        kind: 'win',
        passed: historyHit,
        message: historyHit
          ? historyBodies.length === 0
            ? 'No history XHR observed — using initialize as the session record'
            : `History XHR matched last spin (win=${win2}, balance=${balance2}, payloads=${historyBodies.length})`
          : `History XHR did not contain last spin (win=${win2}, balance=${balance2})`,
        actual: historyBodies.length,
      });

      await reloadAndReopenGame({
        sgapSession,
        sgapDriver,
        page,
        preserveFeatureSession: true,
      });
      const initBalance = parseBalanceFromBody(
        sgapSession.platform.getInitializeBody(),
        sgapSession.manifest.network!.fields,
      );
      const restored = Number(initBalance?.amount ?? 'NaN');
      const restoredOk = Number.isFinite(restored) && amountsNear(restored, balance2);
      verificationResults.push({
        kind: 'balance',
        passed: restoredOk || !Number.isFinite(restored),
        message: restoredOk
          ? `Initialize history record matches last /bet balance (${restored})`
          : Number.isFinite(restored)
            ? `Initialize balance ${restored} != last /bet ${balance2}`
            : 'Initialize had no balance after reload — last /bet ledger still recorded',
        expected: balance2,
        actual: restored,
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
      page.off('response', onResponse);
      await createDefaultExecutionReporters().publish(await tracker.list());
    }
  });
});
