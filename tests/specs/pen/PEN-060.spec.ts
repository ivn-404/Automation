/**
 * PEN-060 — Cashout ignores a client-supplied payout AND balance.
 *
 * Manual Test Case ID: PEN-060 (docs/PERSONALTESTING.md §security-extensions)
 * Intent: complements PEN-016. Cashout carries an inflated `winAmount` AND a spoofed
 * `player.balance`. The server must pay only what it dealt and report its own balance,
 * never the client's numbers.
 */

import { test } from '../../fixtures/index.js';
import { parseScratchRound, type HubCompletion } from '../../../src/network/index.js';
import {
  expectPenChecks,
  penCheck,
  readBalance,
  requireJoined,
  rejectionReason,
  startPenSession,
  startRound,
  wasDealt,
} from '../../support/pen-hub.js';

const MANUAL_TEST_ID = 'PEN-060' as const;
const SPOOF_WIN = 500_000;
const SPOOF_BALANCE = 9_000_000;

test.describe('PEN — Economy edge values', () => {
  test(`${MANUAL_TEST_ID} client-spoofed payout and balance are ignored`, async ({ sgapSession, sgapDriver, page }, testInfo) => {
    test.setTimeout(300_000);
    const session = await startPenSession({ sgapSession, sgapDriver, page, testInfo, manualTestId: MANUAL_TEST_ID });
    try {
      requireJoined(session);
      const bet = session.config?.minBet ?? 0.1;
      const bought = await startRound(session, bet, 0);
      test.skip(!wasDealt(bought.round), `StartRound dealt no card: ${rejectionReason(bought.completion, bought.round) ?? 'unknown'}`);
      const dealtWin = bought.round?.card?.winAmount ?? bought.round?.winAmount ?? 0;
      const before = (await readBalance(session)) ?? session.balance ?? 0;

      const frame = `{"type":1,"invocationId":"pen60","target":"Cashout","arguments":[{"winAmount":${SPOOF_WIN},"player":{"balance":${SPOOF_BALANCE}}}]}`;
      const completion = await session.client
        .sendRawInvocation(frame, { invocationId: 'pen60', timeoutMs: 12_000 })
        ?.catch((error: Error): HubCompletion => ({ error: error.message }));
      const settled =
        completion?.error === undefined && completion?.result !== undefined
          ? parseScratchRound('Cashout', completion.result, [])
          : undefined;
      const paid = settled?.winAmount ?? 0;
      const after = settled?.balance ?? (await readBalance(session)) ?? before;

      await expectPenChecks(
        testInfo,
        [
          penCheck(
            paid <= dealtWin + 0.0001 && paid < SPOOF_WIN,
            `Paid the dealt win, not the spoofed ${SPOOF_WIN} (paid ${paid}, dealt ${dealtWin})`,
            `<= ${dealtWin}`,
            paid,
          ),
          penCheck(
            after < SPOOF_BALANCE && after <= before + dealtWin + 0.0001,
            `Balance is server-computed, not the spoofed ${SPOOF_BALANCE} (${before} → ${after})`,
            `<= ${before + dealtWin}`,
            after,
          ),
        ],
        { dealtWin, before, after, completion },
      );
    } finally {
      session.client.close();
    }
  });
});
