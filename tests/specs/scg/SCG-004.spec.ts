/**
 * SCG-004 — Scratch Game
 *
 * Manual Test Case ID: SCG-004
 * Catalog: Bet – decreases correctly
 * Intent: tapping the drawer bet − lowers the drawn bet, and the next card is
 * bought (StartRound) at that lower bet. Bet is raised first so − has room.
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

const MANUAL_TEST_ID = 'SCG-004' as const;

test.describe('SCG — Scratch Game', () => {
  requireCapabilities('scratchCard');

  test(`${MANUAL_TEST_ID} Bet – decreases correctly`, async ({ sgapSession, sgapDriver, page }, testInfo) => {
    test.setTimeout(300_000);
    const scratch = await startScratchCase({ sgapSession, sgapDriver, page, testInfo, manualTestId: MANUAL_TEST_ID });

    await scratch.open();
    await scratch.selectSize(3);
    await scratch.adjustBet('plus', 2);
    const before = await readDrawerBet(scratch);
    const first = await buyAndScratchAll(scratch);

    await scratch.adjustBet('minus');
    const after = await readDrawerBet(scratch);
    const second = await buyAndScratchAll(scratch);
    await attachRound(testInfo, 'scratch-start-round-before.json', first.started);
    await attachRound(testInfo, 'scratch-start-round-after.json', second.started);

    const sentBefore = asNumber(first.started.requestArgs[0]);
    const sentAfter = asNumber(second.started.requestArgs[0]);
    await expectChecks(testInfo, [
      scratchCheck(
        before !== undefined && after !== undefined && after.amount < before.amount,
        `Drawn bet ${before?.text} → ${after?.text} after −`,
        `< ${before?.amount}`,
        after?.amount,
      ),
      scratchCheck(sentBefore === before?.amount, `First StartRound sent bet ${sentBefore}`, before?.amount, sentBefore),
      scratchCheck(sentAfter === after?.amount, `Second StartRound sent bet ${sentAfter}`, after?.amount, sentAfter),
      scratchCheck(
        second.started.betAmount < first.started.betAmount,
        `Hub bet ${first.started.betAmount} → ${second.started.betAmount}`,
        `< ${first.started.betAmount}`,
        second.started.betAmount,
      ),
    ]);
  });
});
