/**
 * PEN-003 — Oversized bet is rejected or clamped to maxBet.
 *
 * Manual Test Case ID: PEN-003 (docs/PERSONALTESTING.md §2)
 * Intent: StartRound with a stake far above maxBet (1e9, MAX_SAFE_INTEGER) must be
 * rejected or clamped to maxBet — never booked at the oversized value. Needs a
 * joined session (skips while the hub outage blocks JoinScratch).
 */

import { test } from '../../fixtures/index.js';
import {
  expectPenChecks,
  penCheck,
  rejectionReason,
  requireJoined,
  startPenSession,
  startRound,
  wasDealt,
} from '../../support/pen-hub.js';

const MANUAL_TEST_ID = 'PEN-003' as const;

test.describe('PEN — Input validation', () => {
  test(`${MANUAL_TEST_ID} oversized bet rejected or clamped`, async ({ sgapSession, sgapDriver, page }, testInfo) => {
    test.setTimeout(300_000);
    const session = await startPenSession({ sgapSession, sgapDriver, page, testInfo, manualTestId: MANUAL_TEST_ID });
    try {
      requireJoined(session);
      const maxBet = session.config?.maxBet ?? 100;
      const checks = [];
      const evidence = [];
      for (const bet of [1e9, Number.MAX_SAFE_INTEGER]) {
        const { completion, round } = await startRound(session, bet, 0);
        evidence.push({ bet, completion });
        const reason = rejectionReason(completion, round);
        const dealt = wasDealt(round);
        checks.push(
          penCheck(
            !dealt || round.betAmount <= maxBet + 0.0001,
            dealt
              ? `bet ${bet}: card dealt, clamped to ${round.betAmount} (<= maxBet ${maxBet}?)`
              : `bet ${bet}: rejected, no card dealt (${reason ?? 'no reason given'})`,
            `rejected or <= ${maxBet}`,
            dealt ? round.betAmount : reason,
          ),
        );
        // If a card was actually dealt, settle it so we don't strand a round.
        if (dealt) {
          await session.client.invoke('Cashout', []).catch(() => undefined);
        }
      }
      await expectPenChecks(testInfo, checks, evidence);
    } finally {
      session.client.close();
    }
  });
});
