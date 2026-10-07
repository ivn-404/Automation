/**
 * SCG-005 — Scratch Game
 *
 * Manual Test Case ID: SCG-005
 * Catalog: Bet locked during scratching
 * Intent: while a bought card is in play, bet + taps change neither the drawn bet
 * nor the bet of the next card (StartRound).
 */

import { test } from '../../fixtures/index.js';
import { requireCapabilities } from '../../support/capabilities.js';
import {
  asNumber,
  attachRound,
  buyAndScratchAll,
  expectChecks,
  readDrawerBet,
  scratchCheck,
  startScratchCase,
} from '../../support/scratch-flow.js';

const MANUAL_TEST_ID = 'SCG-005' as const;

test.describe('SCG — Scratch Game', () => {
  requireCapabilities('scratchCard');

  test(`${MANUAL_TEST_ID} Bet locked during scratching`, async ({ sgapSession, sgapDriver, page }, testInfo) => {
    test.setTimeout(300_000);
    const scratch = await startScratchCase({ sgapSession, sgapDriver, page, testInfo, manualTestId: MANUAL_TEST_ID });

    await scratch.open();
    await scratch.selectSize(3);
    const started = await scratch.buyCard();
    const inPlay = await readDrawerBet(scratch);
    await scratch.adjustBet('plus', 2);
    const afterTaps = await readDrawerBet(scratch);
    await scratch.scratchAll();

    const next = await buyAndScratchAll(scratch);
    await attachRound(testInfo, 'scratch-start-round-locked.json', started);
    await attachRound(testInfo, 'scratch-start-round-next.json', next.started);

    const sent = asNumber(started.requestArgs[0]);
    const sentNext = asNumber(next.started.requestArgs[0]);
    await expectChecks(testInfo, [
      scratchCheck(
        inPlay !== undefined && afterTaps?.amount === inPlay.amount,
        `Drawn bet during play ${inPlay?.text} → ${afterTaps?.text} after + ×2`,
        inPlay?.amount,
        afterTaps?.amount,
      ),
      scratchCheck(sentNext === sent, `Next card bet ${sentNext} equals the locked bet ${sent}`, sent, sentNext),
      scratchCheck(
        next.started.betAmount === started.betAmount,
        `Hub bet ${started.betAmount} → ${next.started.betAmount}`,
        started.betAmount,
        next.started.betAmount,
      ),
    ]);
  });
});
