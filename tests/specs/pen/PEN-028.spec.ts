/**
 * PEN-028 — Changing the bet before cashout does not rewrite the locked stake.
 *
 * Manual Test Case ID: PEN-028 (docs/catalogs/PERSONALTESTING.md §6)
 * Intent: buy at minBet, then StartRound at a higher stake and another grid.
 * The settlement still uses the first stake.
 */

import { test } from '../../fixtures/index.js';
import {
  cashout,
  expectPenChecks,
  penCheck,
  rejectionReason,
  requireJoined,
  startPenSession,
  startRound,
  wasDealt,
} from '../../support/pen-hub.js';

const MANUAL_TEST_ID = 'PEN-028' as const;

test.describe('PEN — State machine', () => {
  test(`${MANUAL_TEST_ID} the locked bet survives a mid-round change`, async ({ sgapSession, sgapDriver, page }, testInfo) => {
    test.setTimeout(300_000);
    const session = await startPenSession({ sgapSession, sgapDriver, page, testInfo, manualTestId: MANUAL_TEST_ID });
    try {
      requireJoined(session);
      await cashout(session);
      const minBet = session.config?.minBet ?? 0.1;
      const maxBet = session.config?.maxBet ?? 100;
      const raised = Math.min(maxBet, minBet * 10);
      const first = await startRound(session, minBet, 0);
      test.skip(
        !wasDealt(first.round),
        `StartRound dealt no card: ${rejectionReason(first.completion, first.round) ?? 'unknown'}`,
      );
      const locked = first.round.betAmount;
      const changed = await startRound(session, raised, 1);
      const settled = await cashout(session);
      const settledBet = settled.round?.betAmount;
      await expectPenChecks(
        testInfo,
        [
          penCheck(
            !wasDealt(changed.round),
            wasDealt(changed.round)
              ? `A second card was dealt at ${changed.round.betAmount} while ${locked} was in play`
              : `Bet change to ${raised} was refused (${rejectionReason(changed.completion, changed.round) ?? 'no reason given'})`,
            'no replacement card',
            rejectionReason(changed.completion, changed.round),
          ),
          penCheck(
            settledBet === undefined || Math.abs(settledBet - locked) <= 0.0001,
            `Settlement kept the locked stake ${locked} (settled bet ${settledBet ?? 'absent'})`,
            locked,
            settledBet,
          ),
        ],
        { locked, raised, changed: changed.completion, settled: settled.completion },
      );
    } finally {
      session.client.close();
    }
  });
});
