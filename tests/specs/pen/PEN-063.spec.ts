/**
 * PEN-063 — Flooding and oversized frames must not crash the hub or leak internals.
 *
 * Manual Test Case ID: PEN-063 (docs/PERSONALTESTING.md §security-extensions)
 * Intent: a burst of invocations plus one oversized frame must be absorbed — the hub
 * either answers or throttles cleanly, the socket stays usable (or closes with a reason),
 * and no completion leaks a stack trace / internal path. Burst is kept modest for staging.
 */

import { test } from '../../fixtures/index.js';
import { type HubCompletion } from '../../../src/network/index.js';
import {
  expectPenChecks,
  invokeParallel,
  penCheck,
  requireJoined,
  startPenSession,
} from '../../support/pen-hub.js';

const MANUAL_TEST_ID = 'PEN-063' as const;
const BURST = 20;
const LEAK_MARKER = /(\bat\s+[\w.$]+\s*\(|Exception|StackTrace|System\.|\.cs:\d|[A-Za-z]:\\\\|\/src\/|node_modules)/u;

test.describe('PEN — Rate limiting & transport', () => {
  test(`${MANUAL_TEST_ID} flood and oversized frames are absorbed safely`, async ({ sgapSession, sgapDriver, page }, testInfo) => {
    test.setTimeout(300_000);
    const session = await startPenSession({ sgapSession, sgapDriver, page, testInfo, manualTestId: MANUAL_TEST_ID });
    try {
      requireJoined(session);

      // Burst of read-only JoinScratch calls, all sent before any completion is read.
      const burst = await invokeParallel(
        session,
        Array.from({ length: BURST }, () => ({ target: 'JoinScratch', args: session.joinArgs, options: { timeoutMs: 20_000 } })),
      );

      // One oversized frame: a StartRound whose grid index is a megabyte-long string.
      const huge = 'A'.repeat(1_000_000);
      const oversizedFrame = `{"type":1,"invocationId":"pen63","target":"StartRound","arguments":[0.1,"${huge}"]}`;
      const oversized = await session.client
        .sendRawInvocation(oversizedFrame, { invocationId: 'pen63', timeoutMs: 20_000 })
        ?.catch((error: Error): HubCompletion => ({ error: error.message }));

      const messages = [
        ...burst.map((c) => c.error ?? ''),
        oversized?.error ?? '',
      ].filter((m) => m.length > 0);
      const leaked = messages.find((m) => LEAK_MARKER.test(m));
      const socketState = session.client.isOpen ? 'open' : 'closed';

      await expectPenChecks(
        testInfo,
        [
          penCheck(
            leaked === undefined,
            leaked === undefined ? 'No stack trace / internal path leaked in error messages' : `LEAK — error exposes internals: "${leaked.slice(0, 160)}"`,
            'no internals',
            leaked ?? 'none',
          ),
          penCheck(
            session.client.isOpen || messages.length > 0,
            `Hub absorbed the flood without hanging (socket ${socketState}, ${messages.length} rejections)`,
          ),
        ],
        {
          burstSize: BURST,
          burstErrors: burst.filter((c) => c.error !== undefined).length,
          oversized,
          socketState,
        },
      );
    } finally {
      session.client.close();
    }
  });
});
