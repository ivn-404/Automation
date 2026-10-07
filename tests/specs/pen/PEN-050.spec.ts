/**
 * PEN-050 — IDOR: one player must not act on another player's round.
 *
 * Manual Test Case ID: PEN-050 (docs/PERSONALTESTING.md §security-extensions)
 * Intent: with player A's token, attempt to settle or read player B's round/session.
 *
 * BLOCKED (documented skip): this needs a second, independent staging player session,
 * and the scratch hub's `Cashout()` / `StartRound(bet, gridIndex)` carry NO cross-account
 * round or player identifier — a round is bound to the authenticated caller. IDOR is
 * therefore not expressible or verifiable with the single pinned PEN account. Provision
 * a second token (add a second lane player) to enable this case.
 */

import { test } from '../../fixtures/index.js';

test.describe('PEN — Authorization & token integrity', () => {
  test.skip('PEN-050 IDOR cross-player cashout (needs a second staging account)', () => {
    // Intentionally empty: see file header for why this is blocked.
  });
});
