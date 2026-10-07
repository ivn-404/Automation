/**
 * AT-003 — Additional Test
 *
 * Manual Test Case ID: AT-003
 * Intent: Refund handler on a failed bet — when /bet fails, the stake the HUD took on
 * spin is put back, the error can be dismissed, and the server never charged it
 * (the next real spin's balance continues from the pre-failure balance).
 */

import { test, expect } from '../../fixtures/index.js';
import { getLauncherMode } from '../../fixtures/local-launcher-html.js';
import { clearCanvasOverlays, settleCanvasToBaseGame } from '../../../src/platform/index.js';
import {
  InMemoryExecutionTracker,
  createDefaultExecutionReporters,
} from '../../../src/reporting/index.js';
import { verifyBalanceDelta } from '../../../src/verification/bet-response-verification.js';
import { spinForBet } from '../../support/canvas-bet-flow.js';
import { waitForIdleHud } from '../../support/canvas-healing.js';
import { slotHudBalance } from '../../support/scratch-flow.js';
import { captureBetCalls, dismissErrorDialog, ensureBaseHud } from '../../support/session-guard.js';
import { getByPath } from '../../../src/shared/json-path.js';
import { INJECTED_HEADER, observationFor } from '../../../src/observability/index.js';
import type { VerificationResult } from '../../../src/core/models/index.js';

const MANUAL_TEST_ID = 'AT-003' as const;
const REFUND_WINDOW_MS = 10_000;

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

      // A real spin first: gives the server balance the refund must return to.
      const warm = await spinForBet(sgapSession, sgapDriver, page);
      const serverBefore = warm.balance!;
      // The HUD applies the stake when the reel animation ends, after /bet has landed.
      let hudBefore: number | undefined;
      const hudBy = Date.now() + REFUND_WINDOW_MS;
      while (Date.now() < hudBy) {
        hudBefore = await slotHudBalance(page, sgapDriver.iframeSelector);
        if (hudBefore !== undefined && Math.abs(hudBefore - Number(serverBefore.amount)) < 0.005) {
          break;
        }
        await page.waitForTimeout(500);
      }
      verificationResults.push({
        kind: 'balance',
        passed: hudBefore !== undefined && Math.abs(hudBefore - Number(serverBefore.amount)) < 0.005,
        message: `HUD balance ${hudBefore} matches server balance ${serverBefore.amount} before the failed bet`,
        actual: hudBefore,
      });

      // Healing taps can fire a real spin around the failure; the recovery delta must
      // start from the last balance the server actually reported.
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
      verificationResults.push({
        kind: 'bet',
        passed: failedRequests > 0,
        message:
          failedRequests > 0
            ? `Spin sent /bet and it failed (HTTP 500 injected, ${failedRequests} request(s))`
            : 'Spin never sent /bet — could not exercise the failure path',
      });

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
      verificationResults.push({
        kind: 'balance',
        passed: hudBefore !== undefined && hudAfter !== undefined && Math.abs(hudAfter - hudBefore) < 0.005,
        message:
          hudBefore !== undefined && hudAfter !== undefined && Math.abs(hudAfter - hudBefore) < 0.005
            ? `Stake refunded on the HUD after the failed bet (${hudAfter})`
            : `HUD balance not refunded after the failed bet (before=${hudBefore}, after=${hudAfter})`,
        expected: hudBefore,
        actual: hudAfter,
      });

      await page.unroute(betPattern);
      observe?.event('fault-injection-removed', `${failedRequests} request(s) failed by the test`);
      const dismissed = await dismissErrorDialog(page, sgapDriver);
      observe?.event('error-dialog-dismissed', dismissed ? 'closed' : 'would not close', {
        severity: dismissed ? 'info' : 'warn',
      });
      await clearCanvasOverlays(sgapDriver, sgapSession.manifest, 2);
      observe?.event('overlays-cleared', 'clearCanvasOverlays after the failed bet');
      await observe?.sampleBalance('after error recovery');
      verificationResults.push({
        kind: 'stateManagement',
        passed: dismissed,
        message: dismissed ? 'Failed-bet error dialog dismissed' : 'Failed-bet error dialog would not close',
      });

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
      const next = await spinForBet(sgapSession, sgapDriver, page);
      verificationResults.push(
        verifyBalanceDelta({
          before: recoveryBase,
          after: next.balance!,
          win: next.win!,
          stakeAmount: next.bet?.amount,
        }),
      );
      // The HUD counts a win up after the response lands.
      let hudFinal: number | undefined;
      const settleBy = Date.now() + REFUND_WINDOW_MS;
      while (Date.now() < settleBy) {
        hudFinal = await slotHudBalance(page, sgapDriver.iframeSelector);
        if (hudFinal !== undefined && Math.abs(hudFinal - Number(next.balance!.amount)) < 0.005) {
          break;
        }
        await page.waitForTimeout(500);
      }
      verificationResults.push({
        kind: 'balance',
        passed: hudFinal !== undefined && Math.abs(hudFinal - Number(next.balance!.amount)) < 0.005,
        message: `HUD balance ${hudFinal} matches the server after recovery (${next.balance!.amount})`,
        actual: hudFinal,
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
      await page.unroute(betPattern).catch(() => undefined);
      await createDefaultExecutionReporters().publish(await tracker.list());
    }
  });
});
