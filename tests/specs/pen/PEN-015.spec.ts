/**
 * PEN-015 — Payout never exceeds the win cap.
 *
 * Manual Test Case ID: PEN-015 (docs/PERSONALTESTING.md §3/§4)
 * Intent: over a sample of rounds, every paid win must respect bet × maxWinMultiplier
 * and maxWin, and every paid winMultiplier must be within maxWinMultiplier — even
 * though the pay-table legend shows a higher multiplier than the cap. Needs a joined
 * session. (Forcing the top tier is server-side RNG; this asserts the cap holds on
 * whatever is dealt.)
 */

import { test } from '../../fixtures/index.js';
import {
  cashout,
  expectPenChecks,
  penCheck,
  requireJoined,
  startPenSession,
  startRound,
  wasDealt,
} from '../../support/pen-hub.js';

const MANUAL_TEST_ID = 'PEN-015' as const;
const SAMPLE = 12;

test.describe('PEN — Economy integrity', () => {
  test(`${MANUAL_TEST_ID} payout respects the win cap`, async ({ sgapSession, sgapDriver, page }, testInfo) => {
    test.setTimeout(300_000);
    const session = await startPenSession({ sgapSession, sgapDriver, page, testInfo, manualTestId: MANUAL_TEST_ID });
    try {
      requireJoined(session);
      const minBet = session.config?.minBet ?? 0.1;
      const maxWin = session.config?.maxWin ?? 200;
      const maxWinMultiplier = session.config?.maxWinMultiplier ?? 200;
      const checks = [];
      const evidence = [];
      for (let i = 0; i < SAMPLE; i += 1) {
        const bought = await startRound(session, minBet, i % 3);
        if (!wasDealt(bought.round)) {
          continue;
        }
        const settled = await cashout(session);
        evidence.push({ start: bought.completion, settle: settled.completion });
        const card = settled.round?.card ?? bought.round.card;
        const win = settled.round?.winAmount ?? 0;
        const mult = card?.winMultiplier ?? 0;
        const capByMult = bought.round.betAmount * maxWinMultiplier;
        checks.push(
          penCheck(
            win <= maxWin + 0.0001 && win <= capByMult + 0.0001 && mult <= maxWinMultiplier + 0.0001,
            `round ${i}: win ${win} <= min(maxWin ${maxWin}, bet×mult ${capByMult.toFixed(2)}), mult ${mult} <= ${maxWinMultiplier}`,
            `<= caps`,
            { win, mult },
          ),
        );
      }
      test.skip(checks.length === 0, 'No rounds could be dealt to sample payouts');
      await expectPenChecks(testInfo, checks, evidence);
    } finally {
      session.client.close();
    }
  });
});
