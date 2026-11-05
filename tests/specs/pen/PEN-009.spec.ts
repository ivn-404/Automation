/**
 * PEN-009 — Missing or extra StartRound arguments are rejected.
 *
 * Manual Test Case ID: PEN-009 (docs/catalogs/PERSONALTESTING.md §2)
 * Intent: StartRound(), StartRound(bet), and StartRound(bet, grid, extra)
 * do not deal a card and do not drop the socket.
 */

import { test } from '../../fixtures/index.js';
import { parseScratchRound } from '../../../src/network/index.js';
import {
  cashout,
  expectPenChecks,
  isCleanRejection,
  penCheck,
  requireJoined,
  safeInvoke,
  startPenSession,
  wasDealt,
} from '../../support/pen-hub.js';

const MANUAL_TEST_ID = 'PEN-009' as const;

test.describe('PEN — Input validation', () => {
  test(`${MANUAL_TEST_ID} argument count is rejected`, async ({ sgapSession, sgapDriver, page }, testInfo) => {
    test.setTimeout(300_000);
    const session = await startPenSession({ sgapSession, sgapDriver, page, testInfo, manualTestId: MANUAL_TEST_ID });
    try {
      requireJoined(session);
      const calls: readonly (readonly unknown[])[] = [[], [1], [1, 0, 999]];
      const checks = [];
      const evidence = [];
      for (const args of calls) {
        const completion = await safeInvoke(session, 'StartRound', args);
        const round = completion.error === undefined ? parseScratchRound('StartRound', completion.result, args) : undefined;
        const dealt = wasDealt(round);
        const refused =
          !dealt &&
          (isCleanRejection(completion) || (round?.errorCode ?? null) !== null) &&
          session.client.isOpen;
        evidence.push({ args, completion });
        if (dealt) {
          await cashout(session);
        }
        checks.push(
          penCheck(
            refused,
            refused
              ? `StartRound(${JSON.stringify(args)}) rejected (${completion.error ?? round?.message ?? 'no reason given'})`
              : dealt
                ? `StartRound(${JSON.stringify(args)}) dealt a card`
                : session.client.isOpen
                  ? `StartRound(${JSON.stringify(args)}) was accepted without an error (${round?.message ?? 'no message'})`
                  : `StartRound(${JSON.stringify(args)}) closed the socket`,
            'rejected, socket stays open',
            completion.error ?? round?.message,
          ),
        );
        if (!session.client.isOpen) {
          break;
        }
      }
      await expectPenChecks(testInfo, checks, evidence);
    } finally {
      session.client.close();
    }
  });
});
