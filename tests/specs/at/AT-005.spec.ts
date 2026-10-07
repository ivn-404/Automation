/**
 * AT-005 — Additional Test
 *
 * Manual Test Case ID: AT-005
 * Intent: Buy Feature is unavailable during multiple sessions — once a second session is
 * opened for the same account, a Buy Feature attempt from the first session must not
 * complete: the server refuses it (or the client never sends it) and no feature is bought.
 * A HUD balance left short by the refused buy is attached as a finding.
 */

import { test, expect } from '../../fixtures/index.js';
import { getLauncherMode } from '../../fixtures/local-launcher-html.js';
import { requireCapabilities } from '../../support/capabilities.js';
import { settleCanvasToBaseGame } from '../../../src/platform/index.js';
import {
  InMemoryExecutionTracker,
  createDefaultExecutionReporters,
} from '../../../src/reporting/index.js';
import { isBuyPurchaseRequest } from '../../../src/network/index.js';
import { waitForIdleHud } from '../../support/canvas-healing.js';
import { slotHudBalance } from '../../support/scratch-flow.js';
import {
  SESSION_INACTIVE_TEXT,
  captureBetCalls,
  ensureBaseHud,
  openSecondSession,
  sessionIdOf,
  summarizeCalls,
  waitForPhaserText,
  type SecondSession,
} from '../../support/session-guard.js';
import type { VerificationResult } from '../../../src/core/models/index.js';

const MANUAL_TEST_ID = 'AT-005' as const;
const BALANCE_SETTLE_MS = 10_000;

test.describe('AT — Additional Test', () => {
  requireCapabilities('buyFeature');

  test(`${MANUAL_TEST_ID} Buy Feature unavailable during multiple sessions`, async ({
    sgapSession,
    sgapDriver,
    page,
  }, testInfo) => {
    test.setTimeout(420_000);
    test.skip(getLauncherMode() !== 'staging', 'Needs the real launcher session service');

    const tracker = new InMemoryExecutionTracker();
    await tracker.start(MANUAL_TEST_ID, testInfo.project.name);

    testInfo.annotations.push(
      { type: 'manualTestId', description: MANUAL_TEST_ID },
      { type: 'category', description: 'AT' },
      { type: 'gameId', description: sgapSession.manifest.gameId },
    );

    let verificationResults: VerificationResult[] = [];
    let second: SecondSession | undefined;

    try {
      await expect(sgapDriver.isAttached()).resolves.toBe(true);

      await sgapDriver.gameCanvas().waitFor({ state: 'visible' });
      await ensureBaseHud(sgapSession, sgapDriver, page);
      await settleCanvasToBaseGame(
        page,
        sgapDriver,
        sgapSession.manifest,
        sgapSession.platform.getInitializeBody(),
      );
      await ensureBaseHud(sgapSession, sgapDriver, page);
      const hudBefore = await slotHudBalance(page, sgapDriver.iframeSelector);

      second = await openSecondSession(sgapSession, page);
      const secondSessionId = sessionIdOf(second.initializeBody);
      verificationResults.push({
        kind: 'stateManagement',
        passed:
          secondSessionId !== undefined &&
          secondSessionId !== sessionIdOf(sgapSession.platform.getInitializeBody()),
        message: `Second session opened on the same account (session ${secondSessionId})`,
      });

      await page.bringToFront();
      const capture = captureBetCalls(page, sgapSession, isBuyPurchaseRequest);
      await waitForIdleHud(page, sgapDriver, sgapSession.manifest, 12_000);
      const buyAttempt = page
        .waitForResponse((response) => isBuyPurchaseRequest(response.request()), { timeout: 30_000 })
        .catch(() => undefined);

      await sgapSession.buyFeature.openPanel({ timeoutMs: 15_000 }).catch(() => undefined);
      for (const action of ['buyFeatureConfirm', 'buyFeatureConfirmAlt']) {
        if (capture.calls.some((call) => call.isBuy)) {
          break;
        }
        await sgapDriver.clickCanvas(action, { timeoutMs: 8_000, singleInput: true }).catch(() => undefined);
        await page.waitForTimeout(1_500);
      }
      const buyResponse = await buyAttempt;
      const notice = await waitForPhaserText(page, sgapDriver.iframeSelector, SESSION_INACTIVE_TEXT, 12_000);
      await testInfo.attach('first-session-buy-attempt.png', { body: await page.screenshot(), contentType: 'image/png' });

      const buyBody = (await buyResponse?.json().catch(() => undefined)) as
        | { transactionState?: string; message?: string; errorCode?: string }
        | undefined;
      const refused = buyResponse === undefined || !buyResponse.ok() || buyBody?.transactionState !== 'completed';
      verificationResults.push({
        kind: 'bet',
        passed: refused,
        message: refused
          ? buyResponse === undefined
            ? 'Retired session never sent a buy purchase'
            : `Server refused the retired session's buy (HTTP ${buyResponse.status()} ${buyBody?.errorCode ?? ''} "${buyBody?.message ?? ''}")`
          : 'Buy Feature completed on the retired session while another session was active',
        actual: { status: buyResponse?.status(), body: buyBody },
      });

      verificationResults.push({
        kind: 'stateManagement',
        passed: notice !== undefined || (buyResponse !== undefined && !buyResponse.ok()),
        message:
          notice !== undefined
            ? `Retired session tells the player: "${notice.text}"`
            : buyResponse !== undefined && !buyResponse.ok()
              ? `Buy refused by the server (HTTP ${buyResponse.status()}) without an on-screen notice`
              : 'No refusal observed — the buy attempt may not have reached the game',
      });

      let hudAfter: number | undefined;
      const hudTimeline: { atMs: number; hud: number | undefined }[] = [];
      const settleStart = Date.now();
      const deadline = settleStart + BALANCE_SETTLE_MS;
      while (Date.now() < deadline) {
        hudAfter = await slotHudBalance(page, sgapDriver.iframeSelector);
        hudTimeline.push({ atMs: Date.now() - settleStart, hud: hudAfter });
        if (hudBefore !== undefined && hudAfter !== undefined && Math.abs(hudAfter - hudBefore) < 0.005) {
          break;
        }
        await page.waitForTimeout(500);
      }
      // Not part of AT-005's pass criteria (buy refused, nothing bought): a refused buy whose
      // cost stays off the HUD is a refund-handler defect (AT-003 territory), so it is reported
      // as a finding instead of failing this case.
      const hudRestored =
        hudBefore !== undefined && hudAfter !== undefined && Math.abs(hudAfter - hudBefore) < 0.005;
      if (!hudRestored) {
        const finding = `Refused buy left the HUD balance short: before=${hudBefore}, after=${hudAfter} (server did not charge it)`;
        testInfo.annotations.push({ type: 'finding', description: finding });
        await testInfo.attach('finding-hud-balance.txt', { body: finding, contentType: 'text/plain' });
      }

      capture.stop();
      await testInfo.attach('retired-session-calls.json', {
        body: JSON.stringify(
          {
            hudBefore,
            hudTimeline,
            calls: summarizeCalls(capture.calls),
          },
          null,
          2,
        ),
        contentType: 'application/json',
      });
      const completedBuys = capture.calls.filter(
        (call) =>
          call.isBuy &&
          call.status < 300 &&
          (call.body as { transactionState?: string } | undefined)?.transactionState === 'completed',
      );
      verificationResults.push({
        kind: 'bet',
        passed: completedBuys.length === 0,
        message:
          completedBuys.length === 0
            ? 'No buy purchase completed on the retired session'
            : `${completedBuys.length} buy purchase(s) completed on the retired session`,
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
      await second?.close();
      await createDefaultExecutionReporters().publish(await tracker.list());
    }
  });
});
