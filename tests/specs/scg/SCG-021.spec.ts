/**
 * SCG-021 — Scratch Game
 *
 * Manual Test Case ID: SCG-021
 * Catalog: Can scratch manually
 * Intent: dragging over the dust by hand (no SCRATCH ALL tap) scratches the card
 * off — the hub settles it (Cashout) with the dealt cells, win, and balance.
 */

import { test } from '../../fixtures/index.js';
import { requireCapabilities } from '../../support/capabilities.js';
import { verifyScratchCardSettled } from '../../../src/verification/scratch-card-verification.js';
import {
  attachDrawer,
  attachRound,
  expectChecks,
  scratchCheck,
  startScratchCase,
} from '../../support/scratch-flow.js';

const MANUAL_TEST_ID = 'SCG-021' as const;

test.describe('SCG — Scratch Game', () => {
  requireCapabilities('scratchCard');

  test(`${MANUAL_TEST_ID} Can scratch manually`, async ({ sgapSession, sgapDriver, page }, testInfo) => {
    test.setTimeout(300_000);
    const scratch = await startScratchCase({ sgapSession, sgapDriver, page, testInfo, manualTestId: MANUAL_TEST_ID });

    await scratch.open();
    await scratch.selectSize(3);
    const started = await scratch.buyCard();
    const settled = await scratch.scratchByHand();
    await attachRound(testInfo, 'scratch-cashout.json', settled);
    await attachDrawer(testInfo, scratch, 'scratch-revealed-by-hand.png');

    await expectChecks(testInfo, [
      scratchCheck(settled.target === 'Cashout', 'Hand drag settled the card (Cashout)', 'Cashout', settled.target),
      ...verifyScratchCardSettled(started, settled),
    ]);
  });
});
