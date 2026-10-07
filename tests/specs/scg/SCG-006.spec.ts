/**
 * SCG-006 — Scratch Game
 *
 * Manual Test Case ID: SCG-006
 * Catalog: Bet value matches backend request
 * Intent: the bet drawn in the drawer is the bet the game sends in StartRound and
 * the bet the hub books for the round.
 */

import { test } from '../../fixtures/index.js';
import { requireCapabilities } from '../../support/capabilities.js';
import {
  asNumber,
  attachRound,
  expectChecks,
  readDrawerBet,
  scratchCheck,
  startScratchCase,
} from '../../support/scratch-flow.js';

const MANUAL_TEST_ID = 'SCG-006' as const;

test.describe('SCG — Scratch Game', () => {
  requireCapabilities('scratchCard');

  test(`${MANUAL_TEST_ID} Bet value matches backend request`, async ({ sgapSession, sgapDriver, page }, testInfo) => {
    test.setTimeout(300_000);
    const scratch = await startScratchCase({ sgapSession, sgapDriver, page, testInfo, manualTestId: MANUAL_TEST_ID });

    await scratch.open();
    const shown = await readDrawerBet(scratch);
    const started = await scratch.buyCard();
    await attachRound(testInfo, 'scratch-start-round.json', started);
    await scratch.scratchAll();

    const sent = asNumber(started.requestArgs[0]);
    await expectChecks(testInfo, [
      scratchCheck(shown !== undefined, `Drawer bet label "${shown?.text}"`),
      scratchCheck(sent === shown?.amount, `StartRound request bet ${sent} = drawn ${shown?.text}`, shown?.amount, sent),
      scratchCheck(
        started.betAmount === shown?.amount,
        `Hub round bet ${started.betAmount} = drawn ${shown?.text}`,
        shown?.amount,
        started.betAmount,
      ),
    ]);
  });
});
