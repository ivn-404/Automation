/**
 * SCG-019 — Scratch Game
 *
 * Manual Test Case ID: SCG-019
 * Catalog: Buy Card button
 * Intent: BUY CARD is drawn; tapping it sends StartRound, the hub deals a card and
 * books the bet (balance drops by the bet), and the pill turns into SCRATCH ALL.
 */

import { test } from '../../fixtures/index.js';
import { requireCapabilities } from '../../support/capabilities.js';
import { verifyScratchCardBought } from '../../../src/verification/scratch-card-verification.js';
import {
  attachRound,
  expectChecks,
  scratchCheck,
  slotHudBalance,
  startScratchCase,
} from '../../support/scratch-flow.js';

const MANUAL_TEST_ID = 'SCG-019' as const;

test.describe('SCG — Scratch Game', () => {
  requireCapabilities('scratchCard');

  test(`${MANUAL_TEST_ID} Buy Card button`, async ({ sgapSession, sgapDriver, page }, testInfo) => {
    test.setTimeout(300_000);
    const scratch = await startScratchCase({ sgapSession, sgapDriver, page, testInfo, manualTestId: MANUAL_TEST_ID });
    const hub = scratch.hubWatcher();

    await scratch.open();
    await scratch.selectSize(3);
    const pillBefore = await scratch.readTextArea('pill');
    const balanceBefore = hub.lastBalance() ?? (await slotHudBalance(page, sgapDriver.iframeSelector));
    const started = await scratch.buyCard();
    await attachRound(testInfo, 'scratch-start-round.json', started);
    const pillAfter = await scratch.readTextArea('pill');
    await scratch.scratchAll();

    const expectedBalance = balanceBefore !== undefined ? Math.round((balanceBefore - started.betAmount) * 100) / 100 : undefined;
    await expectChecks(testInfo, [
      scratchCheck(pillBefore.some((text) => /buy card/iu.test(text)), `BUY CARD drawn (${pillBefore.join(' ')})`, 'BUY CARD', pillBefore),
      ...verifyScratchCardBought(started, 3),
      scratchCheck(
        expectedBalance !== undefined && started.balance === expectedBalance,
        `Balance ${balanceBefore} − bet ${started.betAmount} = ${started.balance}`,
        expectedBalance,
        started.balance,
      ),
      scratchCheck(
        pillAfter.some((text) => /scratch all/iu.test(text)),
        `Pill turns into SCRATCH ALL after buying (${pillAfter.join(' ')})`,
        'SCRATCH ALL',
        pillAfter,
      ),
    ]);
  });
});
