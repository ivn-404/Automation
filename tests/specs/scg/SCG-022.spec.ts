/**
 * SCG-022 — Scratch Game
 *
 * Manual Test Case ID: SCG-022
 * Catalog: Win can only have three or more symbols
 * Intent: across several 3x3 cards, every winning card shows ≥3 of its tier symbol
 * and every losing card shows no paytable symbol three or more times. Plays until
 * at least one win and one loss were seen (max 12 cards).
 */

import { test } from '../../fixtures/index.js';
import { requireCapabilities } from '../../support/capabilities.js';
import type { VerificationResult } from '../../../src/core/models/index.js';
import {
  verifyScratchCardBought,
  verifyScratchWinRule,
} from '../../../src/verification/scratch-card-verification.js';
import { attachRound, buyAndScratchAll, expectChecks, startScratchCase } from '../../support/scratch-flow.js';

const MANUAL_TEST_ID = 'SCG-022' as const;
const MAX_CARDS = 12;

test.describe('SCG — Scratch Game', () => {
  requireCapabilities('scratchCard');

  test(`${MANUAL_TEST_ID} Win can only have three or more symbols`, async ({ sgapSession, sgapDriver, page }, testInfo) => {
    test.setTimeout(480_000);
    const scratch = await startScratchCase({ sgapSession, sgapDriver, page, testInfo, manualTestId: MANUAL_TEST_ID });

    await scratch.open();
    await scratch.selectSize(3);
    const checks: VerificationResult[] = [];
    let wins = 0;
    let losses = 0;
    for (let card = 1; card <= MAX_CARDS && (wins === 0 || losses === 0); card += 1) {
      const { started } = await buyAndScratchAll(scratch);
      if (started.card?.isWin === true) {
        wins += 1;
        await attachRound(testInfo, `scratch-win-${wins}.json`, started);
      } else {
        losses += 1;
      }
      checks.push(...verifyScratchCardBought(started, 3), ...verifyScratchWinRule(started));
    }
    testInfo.annotations.push({ type: 'cards', description: `${wins} win(s), ${losses} loss(es)` });
    test.skip(wins === 0, `No winning card in ${MAX_CARDS} cards — win side not observed`);

    await expectChecks(testInfo, checks);
  });
});
