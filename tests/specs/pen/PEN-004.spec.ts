/**
 * PEN-004 — A stake below minBet is rejected or raised to minBet.
 *
 * Manual Test Case ID: PEN-004 (docs/catalogs/PERSONALTESTING.md §2)
 * Intent: StartRound(0.0001) must not book the sub-minimum amount. A clamp
 * is a debit of minBet. Anything smaller is a failure.
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

const MANUAL_TEST_ID = 'PEN-004' as const;
const SENT = 0.0001;

test.describe('PEN — Input validation', () => {
  test(`${MANUAL_TEST_ID} sub-minimum bet is rejected or clamped`, async ({ sgapSession, sgapDriver, page }, testInfo) => {
    test.setTimeout(300_000);
    const session = await startPenSession({ sgapSession, sgapDriver, page, testInfo, manualTestId: MANUAL_TEST_ID });
    try {
      requireJoined(session);
      const minBet = session.config?.minBet ?? 0.1;
      const before = session.balance ?? (await readBalance(session)) ?? 0;
      const { completion, round } = await startRound(session, SENT, 0);
      const dealt = wasDealt(round);
      const afterStart = round?.balance ?? (await readBalance(session)) ?? before;
      if (dealt) {
        await cashout(session);
      }
      const after = (await readBalance(session)) ?? afterStart;
      const reason = rejectionReason(completion, round);
      const booked = wasDealt(round) ? round.betAmount : undefined;
      const clamped = booked !== undefined && booked + 0.0001 >= minBet;
      const debit = before - afterStart;
      const debitMatches = clamped && Math.abs(debit - booked) <= 0.0001;
      await expectPenChecks(
        testInfo,
        [
          penCheck(
            (!dealt && Math.abs(after - before) <= 0.0001) || debitMatches,
            !dealt
              ? `Stake ${SENT} rejected, balance ${before} → ${after} (${reason ?? 'no reason given'})`
              : debitMatches
                ? `Stake ${SENT} was clamped to ${booked} (minBet ${minBet})`
                : `Stake ${SENT} was booked at ${booked ?? 'unknown'}, below minBet ${minBet}`,
            `rejected, or a debit of at least ${minBet}`,
            booked !== undefined ? { betAmount: booked, debit } : reason,
          ),
        ],
        { startRound: completion, before, afterStart, after, minBet },
      );
    } finally {
      session.client.close();
    }
  });
});
