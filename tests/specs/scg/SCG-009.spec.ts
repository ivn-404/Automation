/**
 * SCG-009 — Scratch Game
 *
 * Manual Test Case ID: SCG-009
 * Catalog: Clicking 3x3 size change the scratch dimension
 * Intent: after tapping 3x3, BUY CARD sends grid index 0 and the hub deals a 3x3 card (9 cells).
 */

import { test } from '../../fixtures/index.js';
import { requireCapabilities } from '../../support/capabilities.js';
import { startScratchCase } from '../../support/scratch-flow.js';
import { verifySizeChangesDimension } from '../../support/scratch-size-case.js';

const MANUAL_TEST_ID = 'SCG-009' as const;

test.describe('SCG — Scratch Game', () => {
  requireCapabilities('scratchCard');

  test(`${MANUAL_TEST_ID} Clicking 3x3 size change the scratch dimension`, async ({
    sgapSession,
    sgapDriver,
    page,
  }, testInfo) => {
    test.setTimeout(300_000);
    const scratch = await startScratchCase({ sgapSession, sgapDriver, page, testInfo, manualTestId: MANUAL_TEST_ID });
    await verifySizeChangesDimension(scratch, 3, testInfo);
  });
});
