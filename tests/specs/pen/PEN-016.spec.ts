/**
 * PEN-016 — Server ignores client-supplied outcome on settle.
 *
 * Manual Test Case ID: PEN-016 (docs/PERSONALTESTING.md §3)
 * Intent: Cashout carries no outcome, but a malicious client may inject win data as
 * extra arguments/fields. The server must pay only what it dealt at StartRound, never
 * a client-claimed jackpot. Needs a joined session.
 */

import { test } from '../../fixtures/index.js';
import {
  expectPenChecks,
  penCheck,
  readBalance,
  rejectionReason,
  requireJoined,
  startPenSession,
  startRound,
  wasDealt,
} from '../../support/pen-hub.js';
import { parseScratchRound } from '../../../src/network/index.js';
import type { HubCompletion } from '../../../src/network/index.js';

const MANUAL_TEST_ID = 'PEN-016' as const;
const CLAIMED_JACKPOT = 999_999;

test.describe('PEN — Economy integrity', () => {
  test(`${MANUAL_TEST_ID} client-declared outcome is ignored`, async ({ sgapSession, sgapDriver, page }, testInfo) => {
    test.setTimeout(300_000);
    const session = await startPenSession({ sgapSession, sgapDriver, page, testInfo, manualTestId: MANUAL_TEST_ID });
    try {
      requireJoined(session);
      const minBet = session.config?.minBet ?? 0.1;
      const bought = await startRound(session, minBet, 0);
      test.skip(
        !wasDealt(bought.round),
        `StartRound dealt no card: ${rejectionReason(bought.completion, bought.round) ?? 'unknown'}`,
      );
      const dealtWin = bought.round?.card?.winAmount ?? bought.round?.winAmount ?? 0;
      const before = (await readBalance(session)) ?? session.balance ?? 0;

      // Inject a fat win claim as spurious Cashout arguments the API never asked for.
      const frame = `{"type":1,"invocationId":"pen16","target":"Cashout","arguments":[{"winAmount":${CLAIMED_JACKPOT},"winMultiplier":${CLAIMED_JACKPOT},"isWin":true}]}`;
      const completion = await session.client
        .sendRawInvocation(frame, { invocationId: 'pen16', timeoutMs: 12_000 })
        ?.catch((error: Error): HubCompletion => ({ error: error.message }));
      const settled = completion?.error === undefined && completion?.result !== undefined
        ? parseScratchRound('Cashout', completion.result, [])
        : undefined;
      const paid = settled?.winAmount ?? 0;
      const after = settled?.balance ?? (await readBalance(session)) ?? before;

      await expectPenChecks(testInfo, [
        penCheck(
          paid <= dealtWin + 0.0001 && paid < CLAIMED_JACKPOT,
          `Paid the server-dealt win, not the claimed jackpot (paid ${paid}, dealt ${dealtWin}, claimed ${CLAIMED_JACKPOT})`,
          `<= ${dealtWin}`,
          paid,
        ),
        penCheck(
          after <= before + dealtWin + 0.0001,
          `Balance moved by at most the dealt win (${before} → ${after})`,
          `<= ${before + dealtWin}`,
          after,
        ),
      ], { start: bought.completion, claimCompletion: completion, dealtWin, before, after });
    } finally {
      session.client.close();
    }
  });
});
