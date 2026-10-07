/**
 * SCG-013 — Scratch Game
 *
 * Manual Test Case ID: SCG-013
 * Catalog: Legends exist for 4x4
 * Intent: the 4x4 drawer draws its multiplier legend, and it matches the 4x4 paytable the hub returns.
 */

import { test } from '../../fixtures/index.js';
import { requireCapabilities } from '../../support/capabilities.js';
import { startScratchCase } from '../../support/scratch-flow.js';
import { verifyLegendForSize } from '../../support/scratch-size-case.js';

const MANUAL_TEST_ID = 'SCG-013' as const;

test.describe('SCG — Scratch Game', () => {
  requireCapabilities('scratchCard');

  test(`${MANUAL_TEST_ID} Legends exist for 4x4`, async ({ sgapSession, sgapDriver, page }, testInfo) => {
    test.setTimeout(300_000);
    const scratch = await startScratchCase({ sgapSession, sgapDriver, page, testInfo, manualTestId: MANUAL_TEST_ID });
    await verifyLegendForSize(scratch, 4, testInfo);
  });
});
