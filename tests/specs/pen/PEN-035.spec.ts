/**
 * PEN-035 — An unexpected binary frame does not move the balance.
 *
 * Manual Test Case ID: PEN-035 (docs/catalogs/PERSONALTESTING.md §7)
 */

import { test } from '../../fixtures/index.js';
import {
  expectPenChecks,
  penCheck,
  readBalance,
  requireJoined,
  safeInvoke,
  startPenSession,
} from '../../support/pen-hub.js';

const MANUAL_TEST_ID = 'PEN-035' as const;

test.describe('PEN — Protocol', () => {
  test(`${MANUAL_TEST_ID} unexpected compression is rejected`, async ({ sgapSession, sgapDriver, page }, testInfo) => {
    test.setTimeout(300_000);
    const session = await startPenSession({ sgapSession, sgapDriver, page, testInfo, manualTestId: MANUAL_TEST_ID });
    try {
      requireJoined(session);
      const before = (await readBalance(session)) ?? session.balance ?? 0;
      session.client.sendRaw('\x82\xa6packed\x01');
      session.client.sendRaw('{"protocol":"messagepack","version":1}\u001e');
      const closed = await session.client.waitForClose(4_000);
      let stillSafe = closed.closed;
      let follow = closed.closed ? `socket closed (${closed.reason ?? 'no reason'})` : 'socket stayed open';
      if (!closed.closed) {
        const probe = await safeInvoke(session, 'DefinitelyNotAMethod', []);
        stillSafe = typeof probe.error === 'string';
        follow = `follow-up ${probe.error ?? 'was accepted'}`;
      }
      const after = session.client.isOpen ? ((await readBalance(session)) ?? before) : before;
      await expectPenChecks(
        testInfo,
        [
          penCheck(stillSafe, `Unexpected frames did not leave a usable session (${follow})`, 'closed or rejected', follow),
          penCheck(
            !session.client.isOpen || Math.abs(after - before) <= 0.0001,
            `Balance stayed ${before} → ${after}`,
            before,
            after,
          ),
        ],
        { before, after, closed, follow },
      );
    } finally {
      session.client.close();
    }
  });
});
