/**
 * AT-004 — Additional Test
 *
 * Manual Test Case ID: AT-004
 * Intent: Multiple sessions are not allowed on one account — opening the same game for
 * the same player in a second tab must retire the first session: its next spin is
 * rejected by the server (no completed bet, no stake taken) and the player is told
 * the session is no longer active.
 */

import type { Response } from 'playwright';

import { test, expect } from '../../fixtures/index.js';
import { getLauncherMode } from '../../fixtures/local-launcher-html.js';
import { settleCanvasToBaseGame } from '../../../src/platform/index.js';
import {
  InMemoryExecutionTracker,
  createDefaultExecutionReporters,
} from '../../../src/reporting/index.js';
import { isBuyPurchaseRequest } from '../../../src/network/index.js';
import { spinForBet } from '../../support/canvas-bet-flow.js';
import { waitForIdleHud } from '../../support/canvas-healing.js';
import {
  SESSION_INACTIVE_TEXT,
  captureBetCalls,
  ensureBaseHud,
  openSecondSession,
  playerIdOf,
  sessionIdOf,
  waitForPhaserText,
  type SecondSession,
} from '../../support/session-guard.js';
import type { VerificationResult } from '../../../src/core/models/index.js';
import { matchesUrlPattern } from '../../../src/network/bet-url.js';

const MANUAL_TEST_ID = 'AT-004' as const;

test.describe('AT — Additional Test', () => {
  test(`${MANUAL_TEST_ID} multiple sessions are not allowed on one account`, async ({
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

    const betPattern = sgapSession.manifest.network!.betUrlPattern;
    let verificationResults: VerificationResult[] = [];
    let second: SecondSession | undefined;

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

      const firstBet = await spinForBet(sgapSession, sgapDriver, page);
      verificationResults.push({
        kind: 'bet',
        passed: firstBet.transactionState === 'completed',
        message: `First session is live (spin ${firstBet.transactionState ?? 'unknown'}, balance=${firstBet.balance?.amount})`,
      });
      const firstSessionId = sessionIdOf(sgapSession.platform.getInitializeBody());
      const player = playerIdOf(sgapSession.platform.getInitializeBody());

      second = await openSecondSession(sgapSession, page);
      const secondSessionId = sessionIdOf(second.initializeBody);
      const secondPlayer = playerIdOf(second.initializeBody);
      await testInfo.attach('second-session.png', { body: await second.page.screenshot(), contentType: 'image/png' });
      verificationResults.push({
        kind: 'stateManagement',
        passed:
          secondSessionId !== undefined && secondSessionId !== firstSessionId && secondPlayer === player,
        message: `Second tab opened a new session for the same player (player=${secondPlayer}, first=${firstSessionId}, second=${secondSessionId})`,
      });

      await page.bringToFront();
      const capture = captureBetCalls(page, sgapSession, isBuyPurchaseRequest);
      await waitForIdleHud(page, sgapDriver, sgapSession.manifest, 12_000);
      let staleResponse: Response | undefined;
      for (let attempt = 0; attempt < 3 && staleResponse === undefined; attempt += 1) {
        const responsePromise = page
          .waitForResponse((response) => matchesUrlPattern(response.url(), betPattern), { timeout: 15_000 })
          .catch(() => undefined);
        await sgapSession.spin.clickSpin({ timeoutMs: 20_000, singleInput: true, useHealedRatio: attempt > 0 });
        staleResponse = await responsePromise;
      }
      const staleBody = (await staleResponse?.json().catch(() => undefined)) as
        | { transactionState?: string; message?: string; errorCode?: string }
        | undefined;
      verificationResults.push({
        kind: 'bet',
        passed: staleResponse !== undefined,
        message:
          staleResponse !== undefined
            ? `First session's spin reached the server (HTTP ${staleResponse.status()})`
            : 'First session never sent /bet after the second session opened',
      });
      const rejected =
        staleResponse !== undefined &&
        (!staleResponse.ok() || staleBody?.transactionState !== 'completed');
      verificationResults.push({
        kind: 'bet',
        passed: rejected,
        message: rejected
          ? `Server rejected the stale session's spin (HTTP ${staleResponse!.status()} ${staleBody?.errorCode ?? ''} "${staleBody?.message ?? ''}")`
          : 'Stale session was still allowed to spin — two sessions are active on one account',
        actual: { status: staleResponse?.status(), body: staleBody },
      });

      const notice = await waitForPhaserText(page, sgapDriver.iframeSelector, SESSION_INACTIVE_TEXT, 12_000);
      await testInfo.attach('first-session-after.png', { body: await page.screenshot(), contentType: 'image/png' });
      verificationResults.push({
        kind: 'stateManagement',
        passed: notice !== undefined,
        message:
          notice !== undefined
            ? `First session tells the player: "${notice.text}"`
            : 'No "session not active" message shown in the first session',
      });

      await page.waitForTimeout(1_000);
      capture.stop();
      const completed = capture.calls.filter(
        (call) => call.status < 300 && (call.body as { transactionState?: string } | undefined)?.transactionState === 'completed',
      );
      verificationResults.push({
        kind: 'balance',
        passed: completed.length === 0,
        message:
          completed.length === 0
            ? 'No completed bet from the retired session'
            : `${completed.length} bet(s) completed on the retired session`,
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
