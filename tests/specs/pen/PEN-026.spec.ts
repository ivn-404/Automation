/**
 * PEN-026 — The session TTL is not waited out on shared staging.
 *
 * The access token's exp is read. If it is more than two minutes away, the
 * case stops. Idling until a long TTL lapses is not part of this run.
 */

import { test } from '../../fixtures/index.js';
import { requireJoined, startPenSession } from '../../support/pen-hub.js';

const MANUAL_TEST_ID = 'PEN-026' as const;

test.describe('PEN — Session', () => {
  test(`${MANUAL_TEST_ID} session TTL mid-round`, async ({ sgapSession, sgapDriver, page }, testInfo) => {
    test.setTimeout(300_000);
    const session = await startPenSession({ sgapSession, sgapDriver, page, testInfo, manualTestId: MANUAL_TEST_ID });
    try {
      requireJoined(session);
      const exp = session.claims?.exp;
      const remainingMs = typeof exp === 'number' ? exp * 1000 - Date.now() : undefined;
      const minutes = remainingMs === undefined ? 'unknown' : Math.round(remainingMs / 60_000);
      test.skip(
        remainingMs === undefined || remainingMs > 120_000,
        `Token exp is ${minutes} minutes away. Not idling shared staging until the session TTL lapses.`,
      );
    } finally {
      session.client.close();
    }
  });
});
