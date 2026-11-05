/**
 * PEN-073 — TT-PT-023 rate ceiling.
 *
 * Twenty sequential /bet posts on one session. Stop on HTTP 429 or 5xx.
 * A consistent wallet is not a rate limit. The ceiling check passes only
 * when the server returns 429.
 */

import { test } from '../../fixtures/index.js';
import type { VerificationResult } from '../../../src/core/models/index.js';
import { settleCanvasToBaseGame } from '../../../src/platform/index.js';
import {
  InMemoryExecutionTracker,
  createDefaultExecutionReporters,
} from '../../../src/reporting/index.js';
import { matchesBetUrl } from '../../../src/network/bet-url.js';
import { spinForBet } from '../../support/canvas-bet-flow.js';
import { ensureBaseHud } from '../../support/session-guard.js';
import { expectPenChecks, penCheck } from '../../support/pen-hub.js';
import {
  captureFromRequest,
  postSlotBet,
  readSlotProbeText,
  unresolvedRefusal,
  type CapturedSlotBet,
  type SlotProbeResult,
} from '../../support/pen-slot.js';

const MANUAL_TEST_ID = 'TT-PT-023' as const;
const CAP = 20;

test.describe('PEN — Slot rate ceiling', () => {
  test(`${MANUAL_TEST_ID} bounded bet rate`, async ({
    sgapSession,
    sgapDriver,
    page,
  }, testInfo) => {
    test.setTimeout(300_000);
    const tracker = new InMemoryExecutionTracker();
    await tracker.start(MANUAL_TEST_ID, testInfo.project.name);
    testInfo.annotations.push(
      { type: 'manualTestId', description: MANUAL_TEST_ID },
      { type: 'category', description: 'PEN' },
      { type: 'ttPt', description: 'TT-PT-023' },
      { type: 'gameId', description: sgapSession.manifest.gameId },
    );

    const evidence: Record<string, unknown> = {};
    try {
      await ensureBaseHud(sgapSession, sgapDriver, page);
      await settleCanvasToBaseGame(
        page,
        sgapDriver,
        sgapSession.manifest,
        sgapSession.platform.getInitializeBody(),
      );
      const { captured, opening } = await captureOpeningBet(page, sgapSession.manifest, () =>
        spinForBet(sgapSession, sgapDriver, page),
      );
      const stake = Number(captured.body.bet ?? '1');
      let cursor = opening.balance;
      const steps: SlotProbeResult[] = [opening];
      let ledger = cursor !== undefined && Number.isFinite(stake) && opening.status < 300;
      let stop: '429' | '5xx' | 'unresolved' | 'rejected' | undefined;
      if (unresolvedRefusal(opening) || (opening.freeSpinItems ?? 0) > 0) {
        stop = 'unresolved';
        ledger = !opening.leaked;
      }
      for (let index = 0; index < CAP && stop === undefined && ledger; index += 1) {
        const step = await postSlotBet(page, captured, captured.body);
        steps.push(step);
        if (step.leaked || (step.win ?? 0) >= 250_000) {
          ledger = false;
          break;
        }
        if (step.status === 429) {
          stop = '429';
          break;
        }
        if (step.status >= 500) {
          stop = '5xx';
          break;
        }
        if (unresolvedRefusal(step)) {
          stop = 'unresolved';
          break;
        }
        if (step.status >= 400 || step.balance === undefined || cursor === undefined) {
          stop = 'rejected';
          ledger = false;
          break;
        }
        const withWin = cursor - stake + (step.win ?? 0);
        const stakeOnly = cursor - stake;
        const booked = Math.abs(step.balance - withWin) <= 0.02;
        const withheld = (step.win ?? 0) > 0 && Math.abs(step.balance - stakeOnly) <= 0.02;
        if (!booked && !withheld) {
          ledger = false;
        }
        cursor = step.balance;
        if (withheld || (step.freeSpinItems ?? 0) > 0) {
          stop = 'unresolved';
        }
      }
      evidence.steps = steps.map(summary);
      evidence.stop = stop ?? 'cap';
      const posted = steps.length - 1;
      const results: VerificationResult[] = [
        penCheck(
          ledger,
          ledger
            ? `TT-PT-023 ${posted} follow-up bets kept one stake ledger`
            : 'TT-PT-023 the wallet did not follow one stake per accepted bet',
          'each accepted bet moves balance by stake − win',
          evidence.steps,
        ),
        penCheck(
          stop === '429',
          stop === '429'
            ? `TT-PT-023 the server returned HTTP 429 after ${posted} bets`
            : stop === '5xx'
              ? `TT-PT-023 stopped on HTTP ${steps[steps.length - 1]?.status ?? 500}`
              : stop === 'unresolved'
                ? 'TT-PT-023 a round was still open, so the ceiling was not measured'
                : `TT-PT-023 ${posted} bets were accepted and no HTTP 429 was observed`,
          'HTTP 429 before the 20-bet cap',
          { count: posted, stop: evidence.stop },
        ),
      ];
      await expectPenChecks(testInfo, results, evidence);
      await tracker.record({
        manualTestId: MANUAL_TEST_ID,
        status: 'passed',
        startedAt: (await tracker.get(MANUAL_TEST_ID))!.startedAt,
        finishedAt: new Date().toISOString(),
        browserProject: testInfo.project.name,
        verificationResults: results,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      await tracker.finish(MANUAL_TEST_ID, 'failed', message);
      throw error;
    } finally {
      await createDefaultExecutionReporters().publish(await tracker.list());
    }
  });
});

async function captureOpeningBet(
  page: Parameters<typeof postSlotBet>[0],
  manifest: Parameters<typeof matchesBetUrl>[1],
  spin: () => Promise<unknown>,
): Promise<{ captured: CapturedSlotBet; opening: SlotProbeResult }> {
  const requestSeen = page.waitForRequest(
    (request) => request.method() === 'POST' && matchesBetUrl(request.url(), manifest),
    { timeout: 90_000 },
  );
  const responseSeen = page.waitForResponse(
    (response) => response.request().method() === 'POST' && matchesBetUrl(response.url(), manifest),
    { timeout: 90_000 },
  );
  await spin();
  const request = await requestSeen;
  const response = await responseSeen;
  return {
    captured: captureFromRequest(request),
    opening: readSlotProbeText(response.status(), await response.text()),
  };
}

function summary(result: SlotProbeResult): Record<string, unknown> {
  return {
    status: result.status,
    ...(result.balance !== undefined ? { balance: result.balance } : {}),
    ...(result.win !== undefined ? { win: result.win } : {}),
    ...(result.message !== undefined ? { message: result.message } : {}),
    leaked: result.leaked,
  };
}
