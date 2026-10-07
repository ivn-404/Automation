/**
 * PEN-010 — Replaying a Cashout frame does not double-credit.
 *
 * Manual Test Case ID: PEN-010 (docs/PERSONALTESTING.md §3)
 * Intent: capture a winning Cashout and replay the raw frame (same invocationId,
 * then a fresh one). The win must be credited at most once. Needs a joined session.
 */

import { test } from '../../fixtures/index.js';
import {
  cashout,
  expectPenChecks,
  penCheck,
  readBalance,
  rejectionReason,
  requireJoined,
  startPenSession,
  startRound,
  wasDealt,
} from '../../support/pen-hub.js';

const MANUAL_TEST_ID = 'PEN-010' as const;

test.describe('PEN — Economy integrity', () => {
  test(`${MANUAL_TEST_ID} cashout replay credits win once`, async ({ sgapSession, sgapDriver, page }, testInfo) => {
    test.setTimeout(300_000);
    const session = await startPenSession({ sgapSession, sgapDriver, page, testInfo, manualTestId: MANUAL_TEST_ID });
    try {
      requireJoined(session);
      const minBet = session.config?.minBet ?? 0.1;
      const bought = await startRound(session, minBet, 0);
      test.skip(!wasDealt(bought.round), `StartRound dealt no card: ${rejectionReason(bought.completion, bought.round) ?? 'unknown'}`);

      const settle = await cashout(session, { invocationId: 'pen10-cashout' });
      const settledBalance = settle.round?.balance ?? (await readBalance(session)) ?? 0;

      // Replay 1: byte-identical frame, same invocationId.
      session.client.sendRaw('{"type":1,"invocationId":"pen10-cashout","target":"Cashout","arguments":[]}\u001e');
      // Replay 2: identical intent, fresh invocationId.
      const replay = await cashout(session, { invocationId: 'pen10-replay' });
      const afterReplay = replay.round?.balance ?? (await readBalance(session)) ?? settledBalance;

      await expectPenChecks(testInfo, [
        penCheck(
          replay.completion.error !== undefined || (replay.round?.winAmount ?? 0) === 0,
          `Replayed Cashout is a no-op (${replay.completion.error ?? `win ${replay.round?.winAmount}`})`,
          'rejected / no extra win',
          replay.completion.error ?? replay.round?.winAmount,
        ),
        penCheck(
          afterReplay <= settledBalance + 0.0001,
          `Win credited at most once across replays (${settledBalance} → ${afterReplay})`,
          `<= ${settledBalance}`,
          afterReplay,
        ),
      ], { start: bought.completion, settle: settle.completion, replay: replay.completion, settledBalance, afterReplay });
    } finally {
      session.client.close();
    }
  });
});
