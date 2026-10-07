/**
 * SCG-011 — Scratch Game
 *
 * Manual Test Case ID: SCG-011
 * Catalog: Clicking 5x5 size change the scratch dimension
 * Intent: after tapping 5x5, BUY CARD sends grid index 2 and the hub deals a 5x5 card (25 cells).
 */

import { test } from '../../fixtures/index.js';
import { requireCapabilities } from '../../support/capabilities.js';
import { startScratchCase } from '../../support/scratch-flow.js';
import { verifySizeChangesDimension } from '../../support/scratch-size-case.js';

const MANUAL_TEST_ID = 'SCG-011' as const;

test.describe('SCG — Scratch Game', () => {
  requireCapabilities('scratchCard');

  test(`${MANUAL_TEST_ID} Clicking 5x5 size change the scratch dimension`, async ({
    sgapSession,
    sgapDriver,
    page,
  }, testInfo) => {
    test.setTimeout(300_000);
    const scratch = await startScratchCase({ sgapSession, sgapDriver, page, testInfo, manualTestId: MANUAL_TEST_ID });
    await verifySizeChangesDimension(scratch, 5, testInfo);
  });
});
