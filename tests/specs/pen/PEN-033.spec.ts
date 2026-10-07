/**
 * PEN-033 — Oversized payload is bounded, not a hang/OOM.
 *
 * Manual Test Case ID: PEN-033 (docs/PERSONALTESTING.md §7)
 * Intent: a multi-MB argument must be bounded and rejected (or cleanly closed),
 * never an out-of-memory or an indefinite hang. Observable: the hub answers or the
 * socket closes within a short window — it does not silently swallow the frame.
 * Runs without a joined session.
 */

import { test } from '../../fixtures/index.js';
import { expectPenChecks, penCheck, safeInvoke, startPenSession } from '../../support/pen-hub.js';

const MANUAL_TEST_ID = 'PEN-033' as const;
const HUGE = 'A'.repeat(4 * 1024 * 1024); // 4 MB string argument.

test.describe('PEN — Protocol hardening', () => {
  test(`${MANUAL_TEST_ID} oversized payload is bounded`, async ({ sgapSession, sgapDriver, page }, testInfo) => {
    test.setTimeout(300_000);
    const session = await startPenSession({ sgapSession, sgapDriver, page, testInfo, manualTestId: MANUAL_TEST_ID });
    try {
      const start = Date.now();
      const completion = await safeInvoke(session, 'StartRound', [HUGE, 0], { timeoutMs: 20_000 });
      const elapsed = Date.now() - start;
      const socketClosed = !session.client.isOpen;
      const answered = typeof completion.error === 'string' || socketClosed;
      await expectPenChecks(testInfo, [
        penCheck(
          answered && elapsed < 20_000,
          `Oversized (4MB) StartRound was bounded in ${elapsed}ms (${completion.error ?? (socketClosed ? 'socket closed' : 'accepted?!')})`,
          'error / close within timeout',
          completion.error ?? (socketClosed ? 'socket closed' : 'no response'),
        ),
      ], { completion, elapsed, socketClosed });
    } finally {
      session.client.close();
    }
  });
});
