/**
 * PEN-017 — Peeking at a loss and disconnecting does not refund the stake.
 *
 * Manual Test Case ID: PEN-017 (docs/catalogs/PERSONALTESTING.md §4)
 * Intent: buy until a loss, drop the socket before cashout, reconnect.
 * The stake stays charged. A new buy cannot be free.
 */

import { test } from '../../fixtures/index.js';
import type { PenSession } from '../../support/pen-hub.js';
import {
  expectPenChecks,
  openSecondClient,
  penCheck,
  readBalance,
  rejectionReason,
  requireJoined,
  startPenSession,
  startRound,
  wasDealt,
  cashout,
} from '../../support/pen-hub.js';

const MANUAL_TEST_ID = 'PEN-017' as const;
const MAX_BUYS = 6;

test.describe('PEN — Outcome integrity', () => {
  test(`${MANUAL_TEST_ID} a peeked loss stays charged`, async ({ sgapSession, sgapDriver, page }, testInfo) => {
    test.setTimeout(300_000);
    const session = await startPenSession({ sgapSession, sgapDriver, page, testInfo, manualTestId: MANUAL_TEST_ID });
    let other: PenSession | undefined;
    try {
      requireJoined(session);
      await cashout(session);
      const minBet = session.config?.minBet ?? 0.1;
      let before = session.balance ?? (await readBalance(session)) ?? 0;
      let stake = minBet;
      let found = false;
      for (let index = 0; index < MAX_BUYS; index += 1) {
        const bought = await startRound(session, minBet, 0);
        if (!wasDealt(bought.round)) {
          test.skip(true, `StartRound dealt no card: ${rejectionReason(bought.completion, bought.round) ?? 'unknown'}`);
          return;
        }
        stake = bought.round.betAmount;
        if (bought.round.card.isWin || bought.round.card.winAmount > 0) {
          await cashout(session);
          before = (await readBalance(session)) ?? before;
          continue;
        }
        found = true;
        break;
      }
      test.skip(!found, `No losing card in ${MAX_BUYS} buys`);
      session.client.close();
      const reconnected = await openSecondClient(session);
      test.skip(!reconnected.joined, `Reconnect could not JoinScratch: ${reconnected.joinError ?? 'unknown'}`);
      other = { ...session, client: reconnected.client };
      const after = reconnected.joinResult?.balance ?? (await readBalance(other)) ?? before;
      const again = await startRound(other, minBet, 0);
      const dealtAgain = wasDealt(again.round);
      if (dealtAgain) {
        await cashout(other);
      }
      const finalBalance = (await readBalance(other)) ?? after;
      await cashout(other);
      await expectPenChecks(
        testInfo,
        [
          penCheck(
            after <= before - stake + 0.0001,
            `Disconnect did not refund the losing stake (${before} → ${after}, stake ${stake})`,
            `<= ${before - stake}`,
            after,
          ),
          penCheck(
            !dealtAgain || finalBalance <= after - (again.round?.betAmount ?? minBet) + (again.round?.card?.winAmount ?? 0) + 0.0001,
            dealtAgain
              ? `The next buy was charged (${after} → ${finalBalance})`
              : `The next buy was refused while the loss stayed open (${rejectionReason(again.completion, again.round) ?? 'no reason'})`,
            'refused, or a new stake',
            { dealtAgain, finalBalance },
          ),
        ],
        { before, after, stake, again: again.completion, finalBalance },
      );
    } finally {
      other?.client.close();
      session.client.close();
    }
  });
});
