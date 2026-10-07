/**
 * SCG-020 — Scratch Game
 *
 * Manual Test Case ID: SCG-020
 * Catalog: Scratch all button
 * Intent: with a card in play, SCRATCH ALL is drawn; one tap reveals the card —
 * the hub settles it (Cashout) with the dealt cells, win, and balance.
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

const MANUAL_TEST_ID = 'SCG-020' as const;

test.describe('SCG — Scratch Game', () => {
  requireCapabilities('scratchCard');

  test(`${MANUAL_TEST_ID} Scratch all button`, async ({ sgapSession, sgapDriver, page }, testInfo) => {
    test.setTimeout(300_000);
    const scratch = await startScratchCase({ sgapSession, sgapDriver, page, testInfo, manualTestId: MANUAL_TEST_ID });

    await scratch.open();
    await scratch.selectSize(3);
    const started = await scratch.buyCard();
    const pill = await scratch.readTextArea('pill');
    const settled = await scratch.scratchAll();
    await attachRound(testInfo, 'scratch-cashout.json', settled);
    await attachDrawer(testInfo, scratch, 'scratch-revealed.png');

    await expectChecks(testInfo, [
      scratchCheck(pill.some((text) => /scratch all/iu.test(text)), `SCRATCH ALL drawn (${pill.join(' ')})`, 'SCRATCH ALL', pill),
      ...verifyScratchCardSettled(started, settled),
    ]);
  });
});
