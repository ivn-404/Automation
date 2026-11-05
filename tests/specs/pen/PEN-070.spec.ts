/**
 * PEN-070 — Slot /bet security checks.
 *
 * Manual Test Case ID: PEN-070
 * Intent: the scratch-hub PEN pack does not speak POST /api/v1/slots/bet. After one
 * real spin, replay that request's session with controlled bodies. A check is a
 * failure only when the server accepts a balance credit, a leaked error, a forged
 * balance, or a duplicate round. Observations that were not proven stay recorded
 * as such.
 */

import { test } from '../../fixtures/index.js';
import type { VerificationResult } from '../../../src/core/models/index.js';
import { settleCanvasToBaseGame } from '../../../src/platform/index.js';
import {
  InMemoryExecutionTracker,
  createDefaultExecutionReporters,
} from '../../../src/reporting/index.js';
import { spinForBet } from '../../support/canvas-bet-flow.js';
import { ensureBaseHud } from '../../support/session-guard.js';
import { readLauncherBalance } from '../../support/launcher-balance.js';
import { expectPenChecks, penCheck } from '../../support/pen-hub.js';
import {
  captureLiveSlotBet,
  postSlotBet,
  unresolvedRefusal,
  type CapturedSlotBet,
  type SlotProbeResult,
} from '../../support/pen-slot.js';

const MANUAL_TEST_ID = 'PEN-070' as const;

test.describe('PEN — Slot bet', () => {
  test(`${MANUAL_TEST_ID} slot /bet rejects forged money and keeps the session consistent`, async ({
    sgapSession,
    sgapDriver,
    page,
  }, testInfo) => {
    test.setTimeout(420_000);
    const tracker = new InMemoryExecutionTracker();
    await tracker.start(MANUAL_TEST_ID, testInfo.project.name);
    testInfo.annotations.push(
      { type: 'manualTestId', description: MANUAL_TEST_ID },
      { type: 'category', description: 'PEN' },
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

      const captured = await captureLiveSlotBet(page, sgapSession.manifest, () =>
        spinForBet(sgapSession, sgapDriver, page),
      );
      const stake = String(captured.body.bet ?? '1');
      const hostBefore = await readLauncherBalance(page);
      evidence.template = { keys: Object.keys(captured.body), stake, hostBefore };
      evidence.authenticated = captured.headers.authorization !== undefined;

      const results: VerificationResult[] = [];
      results.push(
        penCheck(
          captured.headers.authorization !== undefined,
          'Live spin captured an authenticated /bet request',
          'authorization present',
          captured.headers.authorization !== undefined,
        ),
      );

      const negative = await probe(page, captured, { ...captured.body, bet: '-100' });
      evidence.negative = summary(negative);
      results.push(
        penCheck(
          !credited(hostBefore, negative),
          `Negative bet did not raise the wallet (${hostBefore} → ${negative.balance ?? 'no balance'}, HTTP ${negative.status})`,
          'balance does not rise',
          negative.balance ?? negative.status,
        ),
        penCheck(!negative.leaked, 'Negative bet error does not leak internals', 'no leak', negative.leaked),
      );

      const zero = await probe(page, captured, { ...captured.body, bet: '0' });
      evidence.zero = summary(zero);
      results.push(
        penCheck(
          !freeWin(zero),
          `Zero bet did not pay a win without a stake (HTTP ${zero.status}, win ${zero.win ?? 'none'})`,
          'no free win',
          zero.win ?? zero.status,
        ),
        penCheck(!zero.leaked, 'Zero bet error does not leak internals', 'no leak', zero.leaked),
      );

      const huge = await probe(page, captured, { ...captured.body, bet: '1000000000' });
      evidence.huge = summary(huge);
      results.push(
        penCheck(
          !credited(hostBefore, huge),
          `Oversized bet did not raise the wallet (HTTP ${huge.status})`,
          'balance does not rise',
          huge.balance ?? huge.status,
        ),
        penCheck(!huge.leaked, 'Oversized bet error does not leak internals', 'no leak', huge.leaked),
      );

      const injected = await probe(page, captured, { ...captured.body, bet: "1' OR '1'='1" });
      evidence.injected = summary(injected);
      results.push(
        penCheck(!injected.leaked, 'Injected bet text does not leak internals', 'no leak', injected.message ?? injected.status),
        penCheck(
          !credited(hostBefore, injected),
          `Injected bet text did not raise the wallet (HTTP ${injected.status})`,
          'balance does not rise',
          injected.balance ?? injected.status,
        ),
      );

      const forged = await probe(page, captured, { ...captured.body, bet: stake, balance: 9_999_999 });
      evidence.forgedBalance = summary(forged);
      results.push(
        penCheck(
          forged.balance === undefined || forged.balance < 9_000_000,
          `Client-supplied balance was not adopted (server balance ${forged.balance ?? 'absent'})`,
          'not 9999999',
          forged.balance ?? forged.status,
        ),
      );

      const anonymous = await postSlotBet(page, captured, captured.body, { authorize: false });
      evidence.anonymous = summary(anonymous);
      results.push(
        penCheck(
          anonymous.status === 401 || anonymous.status === 403,
          `Bet without a session is refused (HTTP ${anonymous.status})`,
          '401 or 403',
          anonymous.status,
        ),
        penCheck(!anonymous.leaked, 'Anonymous bet error does not leak internals', 'no leak', anonymous.leaked),
      );

      const broken = await postSlotBet(page, captured, captured.body, { raw: '{not-json' });
      evidence.malformed = summary(broken);
      results.push(
        penCheck(
          broken.status >= 400,
          `Malformed JSON is rejected (HTTP ${broken.status})`,
          'HTTP 4xx/5xx',
          broken.status,
        ),
        penCheck(!broken.leaked, 'Malformed JSON error does not leak internals', 'no leak', broken.leaked),
      );

      const ledgerStart = forged.balance;
      const first = await probe(page, captured, captured.body);
      const replay = await probe(page, captured, captured.body);
      evidence.replay = { first: summary(first), replay: summary(replay) };
      const replayLedger = walkBets(ledgerStart, [first, replay], Number(stake));
      results.push(
        penCheck(
          replayLedger !== 'fail',
          replayLedger === 'ledger'
            ? `Identical body was settled as new wagers (${ledgerStart} → ${first.balance} → ${replay.balance}), not a second credit of one win`
            : replayLedger === 'open'
              ? `Identical body stopped when the round stayed open (${ledgerStart} → ${first.balance ?? 'no balance'} → ${replay.balance ?? 'refused'})`
              : `Identical body did not follow one stake per response (${ledgerStart} → ${first.balance} → ${replay.balance})`,
          'each accepted body moves balance by stake − win, or a later bet is refused while the round is open',
          { first: summary(first), replay: summary(replay) },
        ),
      );

      const burst: SlotProbeResult[] = [];
      for (let i = 0; i < 5; i += 1) {
        burst.push(await probe(page, captured, captured.body));
      }
      evidence.burst = burst.map(summary);
      const burstLedger = walkBets(replay.balance ?? first.balance ?? ledgerStart, burst, Number(stake));
      results.push(
        penCheck(
          burstLedger !== 'fail',
          burstLedger === 'ledger'
            ? `Five sequential bets each moved the wallet by one stake minus that spin's win`
            : burstLedger === 'open'
              ? `Sequential bets stopped when a round stayed open, and the wallet was not credited again`
              : `Five sequential bets did not reconcile to one stake each`,
          'balance ledger holds, or an open round refuses the rest',
          burst.map(summary),
        ),
        penCheck(
          true,
          'A rate-limit ceiling was not established; five sequential bets is below a load test',
          'observation only',
          burst.map((item) => item.status),
        ),
      );

      const hostAfter = await readLauncherBalance(page);
      evidence.hostAfter = hostAfter;
      results.push(
        penCheck(
          hostAfter !== undefined && hostBefore !== undefined && hostAfter <= hostBefore + 0.02,
          `Host wallet did not rise across the probes (${hostBefore} → ${hostAfter})`,
          `<= ${hostBefore}`,
          hostAfter,
        ),
      );

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

function probe(page: Parameters<typeof postSlotBet>[0], captured: CapturedSlotBet, body: Record<string, unknown>) {
  return postSlotBet(page, captured, body);
}

function summary(result: SlotProbeResult): Record<string, unknown> {
  return {
    status: result.status,
    ...(result.balance !== undefined ? { balance: result.balance } : {}),
    ...(result.roundId !== undefined ? { roundId: result.roundId } : {}),
    ...(result.win !== undefined ? { win: result.win } : {}),
    ...(result.message !== undefined ? { message: result.message } : {}),
    leaked: result.leaked,
  };
}

/** A response balance above the host wallet means the server credited the account. */
function credited(hostBefore: number | undefined, result: SlotProbeResult): boolean {
  if (hostBefore === undefined || result.balance === undefined) {
    return false;
  }
  return result.balance > hostBefore + 0.02;
}

function freeWin(result: SlotProbeResult): boolean {
  return result.status < 300 && (result.win ?? 0) > 0 && (result.balance ?? 0) > 0;
}

/** Each HTTP 2xx must land on previous − stake + that response's win. An open round stops the ramp. */
function walkBets(
  start: number | undefined,
  steps: readonly SlotProbeResult[],
  stake: number,
): 'ledger' | 'open' | 'fail' {
  if (start === undefined || !Number.isFinite(stake) || steps.length === 0) {
    return 'fail';
  }
  let cursor = start;
  let open = false;
  let settled = 0;
  for (const step of steps) {
    if (step.leaked || (step.win ?? 0) >= 250_000) {
      return 'fail';
    }
    if (unresolvedRefusal(step)) {
      if (step.balance !== undefined && step.balance > cursor + 0.02) {
        return 'fail';
      }
      open = true;
      continue;
    }
    if (open || step.status >= 300 || step.balance === undefined) {
      return 'fail';
    }
    const withWin = cursor - stake + (step.win ?? 0);
    const stakeOnly = cursor - stake;
    const booked = Math.abs(step.balance - withWin) <= 0.02;
    const withheld = (step.win ?? 0) > 0 && Math.abs(step.balance - stakeOnly) <= 0.02;
    if (!booked && !withheld) {
      return 'fail';
    }
    cursor = step.balance;
    if (withheld || (step.freeSpinItems ?? 0) > 0) {
      open = true;
      continue;
    }
    settled += 1;
  }
  if (open) {
    return 'open';
  }
  return settled === steps.length ? 'ledger' : 'fail';
}
