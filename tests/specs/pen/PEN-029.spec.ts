/**
 * PEN-029 — Eight StartRound calls sent together book only what was dealt.
 *
 * Manual Test Case ID: PEN-029 (docs/catalogs/PERSONALTESTING.md §6)
 */

import { test } from '../../fixtures/index.js';
import {
  asRounds,
  cashout,
  expectPenChecks,
  invokeParallel,
  penCheck,
  readBalance,
  requireJoined,
  startPenSession,
  wasDealt,
} from '../../support/pen-hub.js';

const MANUAL_TEST_ID = 'PEN-029' as const;
const BURST = 8;

test.describe('PEN — State machine', () => {
  test(`${MANUAL_TEST_ID} eight back-to-back buys keep one ledger`, async ({ sgapSession, sgapDriver, page }, testInfo) => {
    test.setTimeout(300_000);
    const session = await startPenSession({ sgapSession, sgapDriver, page, testInfo, manualTestId: MANUAL_TEST_ID });
    try {
      requireJoined(session);
      await cashout(session);
      const bet = session.config?.minBet ?? 0.1;
      const initial = (await readBalance(session)) ?? session.balance ?? 0;
      const completions = await invokeParallel(
        session,
        Array.from({ length: BURST }, (_, index) => ({ target: 'StartRound', args: [bet, index % 3] })),
      );
      const dealt = asRounds('StartRound', completions).filter((round) => wasDealt(round.round));
      const sumBets = dealt.reduce((sum, round) => sum + (round.round?.betAmount ?? 0), 0);
      let sumWins = 0;
      for (let index = 0; index < BURST + 1; index += 1) {
        const settled = await cashout(session);
        if (settled.completion.error !== undefined || settled.round === undefined || settled.round.errorCode !== null) {
          break;
        }
        sumWins += settled.round.winAmount ?? 0;
      }
      const after = (await readBalance(session)) ?? Number.NaN;
      const expected = Math.round((initial - sumBets + sumWins) * 100) / 100;
      const actual = Math.round(after * 100) / 100;
      await expectPenChecks(
        testInfo,
        [
          penCheck(after >= -0.0001, `Balance stayed non-negative (${actual})`, '>= 0', actual),
          penCheck(
            Number.isFinite(actual) && Math.abs(actual - expected) < 0.01,
            `${dealt.length} of ${BURST} buys were dealt. Ledger ${initial} − ${sumBets} + ${sumWins} = ${expected} (actual ${actual})`,
            expected,
            actual,
          ),
        ],
        { initial, dealt: dealt.length, sumBets, sumWins, expected, actual },
      );
    } finally {
      session.client.close();
    }
  });
});
