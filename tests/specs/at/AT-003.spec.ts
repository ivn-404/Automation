/**
 * AT-003 — Additional Test
 *
 * Manual Test Case ID: AT-003
 * Intent: Refund handler on a failed bet — when /bet fails, the stake the HUD took on
 * spin is put back, the error can be dismissed, and the server never charged it
 * (the next real spin's balance continues from the pre-failure balance).
 *
 * Three independently reported contracts (F7-B):
 * 1. Server balance continuity after a Playwright-fulfilled HTTP 500
 * 2. Frontend HUD restoration after the simulated failure
 * 3. Error-dialog dismissal
 *
 * The injected 500 does not reach staging and does not prove a backend refund.
 */

import { allure } from 'allure-playwright';

import { test, expect } from '../../fixtures/index.js';
import { getLauncherMode } from '../../fixtures/local-launcher-html.js';
import { clearCanvasOverlays, settleCanvasToBaseGame } from '../../../src/platform/index.js';
import { InMemoryExecutionTracker, createDefaultExecutionReporters } from '../../../src/reporting/index.js';
import {
  aggregateAt003Contracts,
  at003ContractVerificationResults,
  at003IncompleteSkipReason,
  buildAt003LiveEvidence,
  classifyAt003Evidence,
  collectAt003DialogEvidence,
  roundCents,
  type At003ContractReport,
} from '../../../src/verification/at003-evidence.js';
import { spinForBet } from '../../support/canvas-bet-flow.js';
import { waitForIdleHud } from '../../support/canvas-healing.js';
import { slotHudBalance } from '../../support/scratch-flow.js';
import { captureBetCalls, dismissErrorDialog, ensureBaseHud } from '../../support/session-guard.js';
import { getByPath } from '../../../src/shared/json-path.js';
import { INJECTED_HEADER, observationFor } from '../../../src/observability/index.js';
import { listPhaserTexts } from '../../../src/runtime/index.js';
import { readInteractions } from '../../../src/reporting/interaction-journal.js';
import type { BetResponseSnapshot, VerificationResult } from '../../../src/core/models/index.js';

const MANUAL_TEST_ID = 'AT-003' as const;
const REFUND_WINDOW_MS = 10_000;

function amountNumber(value: string | number | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

async function reportAt003Contracts(
  testInfo: { attach: (name: string, options: { body: string | Buffer; contentType: string }) => Promise<void> },
  report: At003ContractReport,
): Promise<void> {
  const { classification } = report;
  await allure.parameter('at003.server', classification.server, { excluded: true });
  await allure.parameter('at003.hud', classification.hud, { excluded: true });
  await allure.parameter('at003.dialog', classification.dialog, { excluded: true });
  await allure.parameter('at003.overall', report.overall, { excluded: true });
  await allure.parameter('at003.injectedReachedStaging', 'false', { excluded: true });
  await allure.label('at003.overall', report.overall);
  await testInfo.attach('at003-contracts.json', {
    body: JSON.stringify(
      {
        overall: report.overall,
        server: classification.server,
        hud: classification.hud,
        dialog: classification.dialog,
        failedKinds: report.failedKinds,
        incompleteKinds: report.incompleteKinds,
        preFailure: classification.preFailure,
        expectedPostRecovery: classification.expectedPostRecovery,
        postRecovery: classification.postRecovery,
        notes: classification.notes,
        dialogEvidence: classification.dialogEvidence,
        message: report.message,
        injectedReachedStaging: false,
      },
      null,
      2,
    ),
    contentType: 'application/json',
  });
}

test.describe('AT — Additional Test', () => {
  test(`${MANUAL_TEST_ID} failed bet is refunded to the balance`, async ({
    sgapSession,
    sgapDriver,
    page,
  }, testInfo) => {
    test.setTimeout(420_000);
    test.skip(getLauncherMode() !== 'staging', 'Needs a real /bet to fail and recover');

    const tracker = new InMemoryExecutionTracker();
    await tracker.start(MANUAL_TEST_ID, testInfo.project.name);

    testInfo.annotations.push(
      { type: 'manualTestId', description: MANUAL_TEST_ID },
      { type: 'category', description: 'AT' },
      { type: 'gameId', description: sgapSession.manifest.gameId },
    );

    const betPattern = `${sgapSession.manifest.network!.betUrlPattern}**`;
    const observe = observationFor(page);
    let verificationResults: VerificationResult[] = [];
    let skipReason: string | undefined;
    let report: At003ContractReport | undefined;

    try {
      await expect(sgapDriver.isAttached()).resolves.toBe(true);
      await expect(sgapSession.spin.isAvailable()).resolves.toBe(true);

      await sgapDriver.gameCanvas().waitFor({ state: 'visible' });
      await ensureBaseHud(sgapSession, sgapDriver, page);
      await settleCanvasToBaseGame(
        page,
        sgapDriver,
        sgapSession.manifest,
        sgapSession.platform.getInitializeBody(),
      );

      const warm = await spinForBet(sgapSession, sgapDriver, page);
      const serverBefore = warm.balance!;
      let hudBefore: number | undefined;
      const hudBy = Date.now() + REFUND_WINDOW_MS;
      while (Date.now() < hudBy) {
        hudBefore = await slotHudBalance(page, sgapDriver.iframeSelector);
        if (hudBefore !== undefined && Math.abs(hudBefore - Number(serverBefore.amount)) < 0.005) {
          break;
        }
        await page.waitForTimeout(500);
      }

      const capture = captureBetCalls(page, sgapSession, () => false);
      let failedRequests = 0;
      await page.route(betPattern, async (route) => {
        failedRequests += 1;
        await route.fulfill({
          status: 500,
          contentType: 'application/json',
          headers: { [INJECTED_HEADER]: MANUAL_TEST_ID },
          body: JSON.stringify({ statusCode: 500, message: 'Internal server error' }),
        });
      });
      observe?.event('fault-injection-armed', `/bet answered with HTTP 500 by the test (${betPattern})`, {
        severity: 'warn',
      });

      await waitForIdleHud(page, sgapDriver, sgapSession.manifest, 12_000);
      for (let attempt = 0; attempt < 3 && failedRequests === 0; attempt += 1) {
        await sgapSession.spin.clickSpin({ timeoutMs: 20_000, singleInput: true, useHealedRatio: attempt > 0 });
        await page.waitForTimeout(1_500);
      }

      let hudAfter: number | undefined;
      const deadline = Date.now() + REFUND_WINDOW_MS;
      while (Date.now() < deadline) {
        hudAfter = await slotHudBalance(page, sgapDriver.iframeSelector);
        if (hudBefore !== undefined && hudAfter !== undefined && Math.abs(hudAfter - hudBefore) < 0.005) {
          break;
        }
        await page.waitForTimeout(500);
      }
      await testInfo.attach('failed-bet.png', { body: await page.screenshot(), contentType: 'image/png' });
      const refunded = (value: number | undefined) =>
        hudBefore !== undefined && value !== undefined && Math.abs(value - hudBefore) < 0.005;
      const refundedWithDialog = refunded(hudAfter);

      await page.unroute(betPattern);
      observe?.event('fault-injection-removed', `${failedRequests} request(s) failed by the test`);
      await observe?.sampleBalance('after injected 500');
      let phaserReadFailed = false;
      let textsBefore: string[] | undefined;
      try {
        textsBefore = (await listPhaserTexts(page, sgapDriver.iframeSelector)).map((hit) => hit.text);
      } catch {
        phaserReadFailed = true;
      }
      const interactionsBeforeDismiss = readInteractions(page).length;
      const dismissed = await dismissErrorDialog(page, sgapDriver);
      let textsAfter: string[] | undefined;
      try {
        textsAfter = (await listPhaserTexts(page, sgapDriver.iframeSelector)).map((hit) => hit.text);
      } catch {
        phaserReadFailed = true;
      }
      await observe?.sampleBalance('after error dialog attempt');
      const dialogEvidence = collectAt003DialogEvidence({
        phaserTextsBeforeDismiss: textsBefore,
        phaserTextsAfterDismiss: textsAfter,
        phaserReadFailed,
        observations: (observe?.observations() ?? []).flatMap((entry) =>
          entry.kind === 'event' ? [{ name: entry.name, detail: entry.detail }] : [],
        ),
        interactions: readInteractions(page).slice(interactionsBeforeDismiss),
      });
      if (!refundedWithDialog) {
        const afterDismissBy = Date.now() + REFUND_WINDOW_MS;
        while (Date.now() < afterDismissBy) {
          hudAfter = await slotHudBalance(page, sgapDriver.iframeSelector);
          if (refunded(hudAfter)) break;
          await page.waitForTimeout(500);
        }
      }
      observe?.event(
        'error-dialog-dismissed',
        dismissed ? 'helper reported closed' : 'helper would not close',
        {
          severity: dismissed ? 'info' : 'warn',
          data: dialogEvidence,
        },
      );
      await clearCanvasOverlays(sgapDriver, sgapSession.manifest, 2);
      observe?.event('overlays-cleared', 'clearCanvasOverlays after the failed bet');
      await observe?.sampleBalance('after error recovery');

      const hudRestoreSample = hudAfter;
      const balancePath = sgapSession.manifest.network?.fields?.balance ?? 'balance';
      const strayBalances = capture.calls
        .filter((call) => call.status < 300)
        .map((call) => getByPath(call.body, balancePath))
        .filter((value) => value !== undefined && value !== null);
      capture.stop();
      const recoveryBase =
        strayBalances.length > 0 ? { amount: String(strayBalances.at(-1)) } : serverBefore;
      if (strayBalances.length > 0) {
        testInfo.annotations.push({
          type: 'note',
          description: `${strayBalances.length} real bet(s) completed around the failure; recovery delta starts at ${recoveryBase.amount}`,
        });
      }

      observe?.event('recovery-spin', `real spin; expected balance continues from ${recoveryBase.amount}`);
      let next: BetResponseSnapshot | undefined;
      try {
        next = await spinForBet(sgapSession, sgapDriver, page);
      } catch (error: unknown) {
        observe?.event(
          'recovery-spin-missing',
          error instanceof Error ? error.message : String(error),
          { severity: 'warn' },
        );
      }

      let hudFinal: number | undefined;
      if (next?.balance?.amount !== undefined) {
        const settleBy = Date.now() + REFUND_WINDOW_MS;
        while (Date.now() < settleBy) {
          hudFinal = await slotHudBalance(page, sgapDriver.iframeSelector);
          if (hudFinal !== undefined && Math.abs(hudFinal - Number(next.balance.amount)) < 0.005) {
            break;
          }
          await page.waitForTimeout(500);
        }
      }

      const warmAmount = amountNumber(serverBefore.amount);
      const recoveryBaseAmount = amountNumber(recoveryBase.amount);
      const adjustments =
        warmAmount !== undefined && recoveryBaseAmount !== undefined
          ? roundCents(recoveryBaseAmount - warmAmount)
          : 0;

      const evidence = buildAt003LiveEvidence({
        gameId: sgapSession.manifest.gameId,
        preFailureHud: hudBefore,
        preFailureServer: warmAmount,
        hudAfterFailure: hudRestoreSample,
        serverAfterFailure: warmAmount,
        recoveryHud: hudFinal,
        recovery:
          next !== undefined
            ? {
                stake: amountNumber(next.bet?.amount),
                win: amountNumber(next.win?.amount),
                serverBalance: amountNumber(next.balance?.amount),
              }
            : undefined,
        dialog: dialogEvidence,
        otherVerifiedAdjustments: adjustments === 0 ? undefined : adjustments,
      });
      const classification = classifyAt003Evidence(evidence);
      report = aggregateAt003Contracts(classification, { failureInjected: failedRequests > 0 });

      verificationResults = [
        {
          kind: 'bet',
          passed: failedRequests > 0,
          message:
            failedRequests > 0
              ? `Spin sent /bet and it failed (HTTP 500 injected, ${failedRequests} request(s))`
              : 'Spin never sent /bet — could not exercise the failure path',
        },
        ...at003ContractVerificationResults(report),
      ];

      testInfo.annotations.push(
        { type: 'at003.server', description: classification.server },
        { type: 'at003.hud', description: classification.hud },
        { type: 'at003.dialog', description: classification.dialog },
        { type: 'at003.overall', description: report.overall },
      );
      await reportAt003Contracts(testInfo, report);

      const trackerStatus =
        report.overall === 'PASS' ? 'passed' : report.overall === 'INCOMPLETE_EVIDENCE' ? 'skipped' : 'failed';
      await tracker.record({
        manualTestId: MANUAL_TEST_ID,
        status: trackerStatus,
        startedAt: (await tracker.get(MANUAL_TEST_ID))!.startedAt,
        finishedAt: new Date().toISOString(),
        browserProject: testInfo.project.name,
        errorMessage: report.overall === 'PASS' ? undefined : report.message,
        verificationResults,
      });

      if (report.overall === 'INCOMPLETE_EVIDENCE') {
        skipReason = at003IncompleteSkipReason(report);
      } else {
        for (const result of verificationResults) {
          const actualKind =
            typeof result.actual === 'string'
              ? result.actual
              : result.actual !== null &&
                  typeof result.actual === 'object' &&
                  'kind' in result.actual
                ? String((result.actual as { kind?: string }).kind)
                : undefined;
          if (actualKind === 'INSUFFICIENT_EVIDENCE') {
            continue;
          }
          expect.soft(result.passed, result.message).toBe(true);
        }
        expect(report.overall, report.message).toBe('PASS');
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      if (report !== undefined) {
        await reportAt003Contracts(testInfo, report).catch(() => undefined);
      }
      await tracker.finish(MANUAL_TEST_ID, 'failed', message);
      const failed = await tracker.get(MANUAL_TEST_ID);
      if (failed !== undefined && verificationResults.length > 0) {
        await tracker.record({ ...failed, verificationResults });
      }
      throw error;
    } finally {
      await page.unroute(betPattern).catch(() => undefined);
      await createDefaultExecutionReporters().publish(await tracker.list());
    }

    if (skipReason !== undefined) {
      test.skip(true, skipReason);
    }
  });
});
