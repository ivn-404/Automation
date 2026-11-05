/**
 * PEN-020 — A paid multiplier is one the pay table published for that card.
 *
 * Manual Test Case ID: PEN-020 (docs/catalogs/PERSONALTESTING.md §4)
 * Intent: up to six buys. Every winning multiplier is in that response's
 * scratchPayTable. No win in the sample is not a pass.
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

const MANUAL_TEST_ID = 'PEN-020' as const;
const MAX_BUYS = 6;

test.describe('PEN — Outcome integrity', () => {
  test(`${MANUAL_TEST_ID} paid multipliers are in the pay table`, async ({ sgapSession, sgapDriver, page }, testInfo) => {
    test.setTimeout(300_000);
    const session = await startPenSession({ sgapSession, sgapDriver, page, testInfo, manualTestId: MANUAL_TEST_ID });
    try {
      requireJoined(session);
      await cashout(session);
      const minBet = session.config?.minBet ?? 0.1;
      const wins: { readonly multiplier: number; readonly tier: string; readonly table: readonly number[] }[] = [];
      for (let index = 0; index < MAX_BUYS; index += 1) {
        const bought = await startRound(session, minBet, index % 3);
        if (!wasDealt(bought.round)) {
          test.skip(wins.length === 0, `StartRound dealt no card: ${rejectionReason(bought.completion, bought.round) ?? 'unknown'}`);
          break;
        }
        const card = bought.round.card;
        if (card.isWin || card.winAmount > 0) {
          wins.push({
            multiplier: card.winMultiplier,
            tier: card.tier,
            table: bought.round.payTable.map((row) => row.multiplier),
          });
        }
        await cashout(session);
      }
      test.skip(wins.length === 0, `No winning card in ${MAX_BUYS} buys`);
      await expectPenChecks(
        testInfo,
        wins.map((win) =>
          penCheck(
            win.table.some((multiplier) => Math.abs(multiplier - win.multiplier) <= 0.0001),
            `Paid ${win.multiplier} for ${win.tier} is in the pay table [${win.table.join(', ')}]`,
            'multiplier is in scratchPayTable',
            win,
          ),
        ),
        { wins },
      );
    } finally {
      session.client.close();
    }
  });
});
