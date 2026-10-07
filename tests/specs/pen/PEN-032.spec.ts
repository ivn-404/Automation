/**
 * PEN-032 — Malformed SignalR frames fail closed.
 *
 * Manual Test Case ID: PEN-032 (docs/PERSONALTESTING.md §7)
 * Intent: frames that are not valid protocol (non-JSON, missing the \u001e record
 * separator, wrong shape) must be rejected cleanly — the server may drop the socket,
 * but it must never execute them, 500-storm, or leave a usable half-authenticated
 * connection. Runs without a joined session.
 */

import { test } from '../../fixtures/index.js';
import { expectPenChecks, penCheck, safeInvoke, startPenSession } from '../../support/pen-hub.js';

const MANUAL_TEST_ID = 'PEN-032' as const;

test.describe('PEN — Protocol hardening', () => {
  test(`${MANUAL_TEST_ID} malformed frames fail closed`, async ({ sgapSession, sgapDriver, page }, testInfo) => {
    test.setTimeout(300_000);
    const session = await startPenSession({ sgapSession, sgapDriver, page, testInfo, manualTestId: MANUAL_TEST_ID });
    try {
      // A complete but non-JSON frame, and an invocation frame missing its terminator.
      session.client.sendRaw('not json at all\u001e');
      session.client.sendRaw('{"type":1,"target":"StartRound","arguments":[1,0]');

      const closed = await session.client.waitForClose(6_000);
      // Fail-closed is acceptable (socket closed). If it stayed open, it must still
      // reject a known-unknown target cleanly rather than having accepted garbage.
      let stillSafe = closed.closed;
      let followUp = closed.closed ? `socket closed (${closed.reason})` : 'socket open';
      if (!closed.closed) {
        const probe = await safeInvoke(session, 'DefinitelyNotAMethod', []);
        stillSafe = typeof probe.error === 'string';
        followUp = `socket open, follow-up rejected: ${probe.error ?? 'ACCEPTED (bad)'}`;
      }
      await expectPenChecks(testInfo, [
        penCheck(stillSafe, `Malformed frames did not yield a usable/broken session (${followUp})`),
      ], { closed, followUp });
    } finally {
      session.client.close();
    }
  });
});
