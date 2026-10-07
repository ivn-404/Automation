/**
 * PEN-053 — A token must stop working after the session is invalidated.
 *
 * Manual Test Case ID: PEN-053 (docs/PERSONALTESTING.md §security-extensions)
 * Intent: capture a token, log out / invalidate the session in the UI, then reconnect
 * with the old token — the hub must refuse it.
 *
 * BLOCKED (documented skip): the PEN harness has no logout/session-invalidation hook
 * for the staging account, and forcing a real logout would disrupt the shared launcher
 * session other cases depend on. Enable by wiring an operator-side session-revoke step
 * (or a second disposable account) before reconnecting with the captured token.
 */

import { test } from '../../fixtures/index.js';

test.describe('PEN — Authorization & token integrity', () => {
  test.skip('PEN-053 post-logout token replay (needs a session-invalidation hook)', () => {
    // Intentionally empty: see file header for why this is blocked.
  });
});
