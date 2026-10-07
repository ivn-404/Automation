/**
 * SCG-007 — Scratch Game
 *
 * Manual Test Case ID: SCG-007
 * Catalog: Bet currency is same with the slot bet currency
 * Intent: the currency drawn with the scratch bet ($ / USD) is the currency the
 * slot HUD shows for its bet.
 */

import { test } from '../../fixtures/index.js';
import { requireCapabilities } from '../../support/capabilities.js';
import {
  currencyCodeOf,
  expectChecks,
  readDrawerBet,
  scratchCheck,
  slotHudCurrencies,
  startScratchCase,
} from '../../support/scratch-flow.js';

const MANUAL_TEST_ID = 'SCG-007' as const;

test.describe('SCG — Scratch Game', () => {
  requireCapabilities('scratchCard');

  test(`${MANUAL_TEST_ID} Bet currency is same with the slot bet currency`, async ({
    sgapSession,
    sgapDriver,
    page,
  }, testInfo) => {
    test.setTimeout(300_000);
    const scratch = await startScratchCase({ sgapSession, sgapDriver, page, testInfo, manualTestId: MANUAL_TEST_ID });

    const slotCurrencies = await slotHudCurrencies(page, sgapDriver.iframeSelector);
    await scratch.open();
    const shown = await readDrawerBet(scratch);
    const scratchCurrency = shown !== undefined ? currencyCodeOf(shown.marker) : undefined;

    await expectChecks(testInfo, [
      scratchCheck(slotCurrencies.length === 1, `Slot HUD currency ${slotCurrencies.join(', ')}`, 'one code', slotCurrencies),
      scratchCheck(
        scratchCurrency !== undefined,
        `Scratch bet "${shown?.text}" has a currency marker "${shown?.marker}"`,
      ),
      scratchCheck(
        scratchCurrency === slotCurrencies[0],
        `Scratch bet currency ${scratchCurrency} = slot bet currency ${slotCurrencies[0]}`,
        slotCurrencies[0],
        scratchCurrency,
      ),
    ]);
  });
});
