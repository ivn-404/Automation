/**
 * SCG-014 — Scratch Game
 *
 * Manual Test Case ID: SCG-014
 * Catalog: Legends exist for 5x5
 * Intent: the 5x5 drawer draws its multiplier legend, and it matches the 5x5 paytable the hub returns.
 */

import { test } from '../../fixtures/index.js';
import { requireCapabilities } from '../../support/capabilities.js';
import { startScratchCase } from '../../support/scratch-flow.js';
import { verifyLegendForSize } from '../../support/scratch-size-case.js';

const MANUAL_TEST_ID = 'SCG-014' as const;

test.describe('SCG — Scratch Game', () => {
  requireCapabilities('scratchCard');

  test(`${MANUAL_TEST_ID} Legends exist for 5x5`, async ({ sgapSession, sgapDriver, page }, testInfo) => {
    test.setTimeout(300_000);
    const scratch = await startScratchCase({ sgapSession, sgapDriver, page, testInfo, manualTestId: MANUAL_TEST_ID });
    await verifyLegendForSize(scratch, 5, testInfo);
  });
});
