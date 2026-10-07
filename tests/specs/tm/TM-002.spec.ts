/**
 * TM-002 — Turbo Mode
 *
 * Manual Test Case ID: TM-002
 * Intent: Reel speed increases in Turbo Mode.
 *
 * Manual — Package 1 /bet has no turbo field, and spin duration is not a
 * catalog gate. Workers must not run this spec.
 */

import { test } from '../../fixtures/index.js';

const MANUAL_TEST_ID = 'TM-002' as const;

test.describe.skip('TM — Turbo Mode', () => {
  test(`${MANUAL_TEST_ID} reel speed increases in turbo mode`, async () => {
    test.skip(true, 'Manual — reel speed has no /bet field and duration is not a catalog gate');
  });
});
