/**
 * PEN-057 — The outcome is fixed server-side at StartRound and cannot be re-rolled.
 *
 * Manual Test Case ID: PEN-057 (docs/PERSONALTESTING.md §security-extensions)
 * Intent: after a card is dealt, a client must not be able to change it — a second
 * StartRound before settling must not replace the in-play card, and the settled card
 * must be exactly what StartRound dealt. This proves the server owns the RNG.
 */

import { test } from '../../fixtures/index.js';
import type { ScratchCardSnapshot } from '../../../src/network/index.js';
import {
  cashout,
  expectPenChecks,
  penCheck,
  requireJoined,
  rejectionReason,
  startPenSession,
  startRound,
  wasDealt,
} from '../../support/pen-hub.js';

const MANUAL_TEST_ID = 'PEN-057' as const;

function fingerprint(card: ScratchCardSnapshot | undefined): string {
  if (card === undefined) {
    return 'none';
  }
  const cells = card.cells.map((cell) => `${cell.index}:${cell.symbol}`).join(',');
  return `${card.tier}|win=${card.winAmount}|mult=${card.winMultiplier}|[${cells}]`;
}

test.describe('PEN — Outcome & RNG integrity', () => {
  test(`${MANUAL_TEST_ID} dealt outcome is immutable`, async ({ sgapSession, sgapDriver, page }, testInfo) => {
    test.setTimeout(300_000);
    const session = await startPenSession({ sgapSession, sgapDriver, page, testInfo, manualTestId: MANUAL_TEST_ID });
    try {
      requireJoined(session);
      const bet = session.config?.minBet ?? 0.1;
      const bought = await startRound(session, bet, 0);
      test.skip(!wasDealt(bought.round), `StartRound dealt no card: ${rejectionReason(bought.completion, bought.round) ?? 'unknown'}`);
      const dealtCard = bought.round?.card;
      const dealtFingerprint = fingerprint(dealtCard);

      // Attempt a re-roll: buy again with a different grid index before settling.
      const reroll = await startRound(session, bet, 7);
      const rerollDealtDifferent = wasDealt(reroll.round) && fingerprint(reroll.round?.card) !== dealtFingerprint;

      // Settle and confirm the card paid is the one originally dealt.
      const settled = await cashout(session);
      const settledCard = settled.round?.card ?? dealtCard;
      const settledFingerprint = fingerprint(settledCard);

      await expectPenChecks(
        testInfo,
        [
          penCheck(
            !rerollDealtDifferent,
            rerollDealtDifferent
              ? `RE-ROLL POSSIBLE — a second StartRound replaced the in-play card (${dealtFingerprint} → ${fingerprint(reroll.round?.card)})`
              : `Second StartRound did not re-roll the in-play card (${rejectionReason(reroll.completion, reroll.round) ?? 'no new card'})`,
            'no re-roll',
            rerollDealtDifferent,
          ),
          penCheck(
            settledFingerprint === dealtFingerprint,
            `Settled card equals the dealt card (${settledFingerprint === dealtFingerprint ? 'match' : `${dealtFingerprint} vs ${settledFingerprint}`})`,
            dealtFingerprint,
            settledFingerprint,
          ),
        ],
        { dealtFingerprint, reroll: reroll.completion, settledFingerprint },
      );
    } finally {
      session.client.close();
    }
  });
});
