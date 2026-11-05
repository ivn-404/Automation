/**
 * PEN-036 — Reconnecting three times mid-round does not duplicate it.
 *
 * Manual Test Case ID: PEN-036 (docs/catalogs/PERSONALTESTING.md §7)
 */

import { test } from '../../fixtures/index.js';
import type { PenSession } from '../../support/pen-hub.js';
import {
  cashout,
  expectPenChecks,
  openSecondClient,
  penCheck,
  readBalance,
  rejectionReason,
  requireJoined,
  startPenSession,
  startRound,
  wasDealt,
} from '../../support/pen-hub.js';

const MANUAL_TEST_ID = 'PEN-036' as const;
const RECONNECTS = 3;

test.describe('PEN — Protocol', () => {
  test(`${MANUAL_TEST_ID} repeated reconnect does not duplicate the round`, async ({ sgapSession, sgapDriver, page }, testInfo) => {
    test.setTimeout(300_000);
    const session = await startPenSession({ sgapSession, sgapDriver, page, testInfo, manualTestId: MANUAL_TEST_ID });
    let current: PenSession = session;
    try {
      requireJoined(session);
      await cashout(session);
      const bet = session.config?.minBet ?? 0.1;
      const before = (await readBalance(session)) ?? session.balance ?? 0;
      const bought = await startRound(session, bet, 0);
      if (!wasDealt(bought.round)) {
        test.skip(true, `StartRound dealt no card: ${rejectionReason(bought.completion, bought.round) ?? 'unknown'}`);
        return;
      }
      const stake = bought.round.betAmount;
      const dealtWin = bought.round.card.winAmount;
      session.client.close();
      for (let index = 0; index < RECONNECTS; index += 1) {
        const next = await openSecondClient(session);
        test.skip(!next.joined, `Reconnect ${index + 1} failed: ${next.joinError ?? 'unknown'}`);
        current.client.close();
        current = { ...session, client: next.client };
      }
      await cashout(current);
      const after = (await readBalance(current)) ?? Number.NaN;
      const expected = Math.round((before - stake + dealtWin) * 100) / 100;
      const actual = Math.round(after * 100) / 100;
      await expectPenChecks(
        testInfo,
        [
          penCheck(
            Number.isFinite(actual) && Math.abs(actual - expected) < 0.01,
            `Three reconnects left ${before} − ${stake} + ${dealtWin} = ${expected} (actual ${actual})`,
            expected,
            actual,
          ),
        ],
        { before, stake, dealtWin, expected, actual },
      );
    } finally {
      current.client.close();
      session.client.close();
    }
  });
});
