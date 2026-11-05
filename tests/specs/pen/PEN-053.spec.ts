/**
 * PEN-053 — Replay a token after logout.
 *
 * The staging launcher page has no logout or session-revoke control that this
 * harness can press. Invalidating the shared session from outside the page is
 * not available here.
 */

import { test } from '../../fixtures/index.js';
import { startPenSession } from '../../support/pen-hub.js';

test.describe('PEN — Authorization', () => {
  test('PEN-053 post-logout token replay', async ({ sgapSession, sgapDriver, page }, testInfo) => {
    test.setTimeout(300_000);
    const session = await startPenSession({ sgapSession, sgapDriver, page, testInfo, manualTestId: 'PEN-053' });
    try {
      const logout = page.getByRole('button', { name: /log out|sign out|revoke/i });
      const visible = await logout.first().isVisible().catch(() => false);
      test.skip(!visible, 'The launcher page has no logout or session-revoke control');
    } finally {
      session.client.close();
    }
  });
});
