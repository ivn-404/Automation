/**
 * SCG-016 — Scratch Game
 *
 * Manual Test Case ID: SCG-016
 * Catalog: Base bet on 4x4 dimension cannot go below minimum
 * Intent: on 4x4, bet − stops at a floor; extra − taps keep the drawn bet and the
 * StartRound bet at that floor, which is not below the hub minBet.
 */

import { test } from '../../fixtures/index.js';
import { requireCapabilities } from '../../support/capabilities.js';
import { startScratchCase } from '../../support/scratch-flow.js';
import { verifyMinimumBetForSize } from '../../support/scratch-size-case.js';

const MANUAL_TEST_ID = 'SCG-016' as const;

test.describe('SCG — Scratch Game', () => {
  requireCapabilities('scratchCard');

  test(`${MANUAL_TEST_ID} Base bet on 4x4 dimension cannot go below minimum`, async ({
    sgapSession,
    sgapDriver,
    page,
  }, testInfo) => {
    test.setTimeout(300_000);
    const scratch = await startScratchCase({ sgapSession, sgapDriver, page, testInfo, manualTestId: MANUAL_TEST_ID });
    await verifyMinimumBetForSize(scratch, 4, testInfo);
  });
});
