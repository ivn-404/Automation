/**
 * PEN-006 — Type confusion on the bet argument.
 *
 * Manual Test Case ID: PEN-006 (docs/PERSONALTESTING.md §2)
 * Intent: StartRound with a wrongly-typed bet (string, boolean, object, null, and
 * the JSON-inexpressible NaN/Infinity via a raw frame) must be rejected cleanly —
 * no crash, no dropped auth, no round dealt. Needs a joined session.
 */

import { test } from '../../fixtures/index.js';
import {
  expectPenChecks,
  penCheck,
  rejectionReason,
  requireJoined,
  startPenSession,
  startRound,
  wasDealt,
} from '../../support/pen-hub.js';
import type { HubCompletion } from '../../../src/network/index.js';

const MANUAL_TEST_ID = 'PEN-006' as const;
const TYPED_BETS: readonly unknown[] = ['1', '1e3', true, {}, null];

test.describe('PEN — Input validation', () => {
  test(`${MANUAL_TEST_ID} type confusion on bet is rejected`, async ({ sgapSession, sgapDriver, page }, testInfo) => {
    test.setTimeout(300_000);
    const session = await startPenSession({ sgapSession, sgapDriver, page, testInfo, manualTestId: MANUAL_TEST_ID });
    try {
      requireJoined(session);
      const checks = [];
      const evidence = [];
      for (const bet of TYPED_BETS) {
        const { completion, round } = await startRound(session, bet, 0);
        evidence.push({ bet, completion });
        const reason = rejectionReason(completion, round);
        const dealt = wasDealt(round);
        checks.push(
          penCheck(
            !dealt,
            dealt
              ? `bet ${JSON.stringify(bet)}: card dealt, bet ${round.betAmount} — BAD`
              : `bet ${JSON.stringify(bet)}: rejected, no card dealt (${reason ?? 'no reason given'})`,
            'rejected, no card',
            dealt ? round.betAmount : reason,
          ),
        );
        if (dealt) {
          await session.client.invoke('Cashout', []).catch(() => undefined);
        }
      }
      // NaN / Infinity cannot be expressed in JSON — inject them as a raw frame.
      for (const literal of ['NaN', 'Infinity']) {
        const frame = `{"type":1,"invocationId":"pen6-${literal}","target":"StartRound","arguments":[${literal},0]}`;
        const completion = await session.client
          .sendRawInvocation(frame, { invocationId: `pen6-${literal}`, timeoutMs: 8_000 })
          ?.catch((error: Error): HubCompletion => ({ error: error.message }));
        checks.push(
          penCheck(
            completion === undefined || completion.error !== undefined || !session.client.isOpen,
            `raw bet ${literal} rejected/closed, not accepted (${completion?.error ?? 'no completion'})`,
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
