/**
 * SCG-023 — Scratch Game
 *
 * Manual Test Case ID: SCG-023
 * Catalog: Total win prompts
 * Intent: after a winning card is scratched, the drawer prompts TOTAL WIN with the
 * amount the hub paid (Cashout winAmount). Plays 3x3 cards until a win (max 15).
 */

import { test } from '../../fixtures/index.js';
import { requireCapabilities } from '../../support/capabilities.js';
import {
  attachDrawer,
  attachRound,
  buyAndScratchAll,
  expectChecks,
  scratchCheck,
  startScratchCase,
} from '../../support/scratch-flow.js';

const MANUAL_TEST_ID = 'SCG-023' as const;
const MAX_CARDS = 15;

function promptAmount(texts: readonly string[]): number | undefined {
  const amount = texts.find((text) => /^[\d,]+\.\d{2}$/u.test(text));
  return amount !== undefined ? Number(amount.replace(/,/gu, '')) : undefined;
}

test.describe('SCG — Scratch Game', () => {
  requireCapabilities('scratchCard');

  test(`${MANUAL_TEST_ID} Total win prompts`, async ({ sgapSession, sgapDriver, page }, testInfo) => {
    test.setTimeout(540_000);
    const scratch = await startScratchCase({ sgapSession, sgapDriver, page, testInfo, manualTestId: MANUAL_TEST_ID });

    await scratch.open();
    await scratch.selectSize(3);
    for (let card = 1; card <= MAX_CARDS; card += 1) {
      const { settled } = await buyAndScratchAll(scratch);
      if (settled.winAmount <= 0) {
        continue;
      }
      let prompt: readonly string[] = [];
      const deadline = Date.now() + 6_000;
      while (Date.now() < deadline) {
        prompt = await scratch.readTextArea('totalWin');
        if (promptAmount(prompt) === settled.winAmount) {
          break;
        }
        await page.waitForTimeout(300);
      }
      await attachRound(testInfo, 'scratch-cashout.json', settled);
      await attachDrawer(testInfo, scratch, 'scratch-total-win.png');
      const shown = promptAmount(prompt);
      await expectChecks(testInfo, [
        scratchCheck(prompt.some((text) => /total win/iu.test(text)), `TOTAL WIN prompt drawn (${prompt.join(' ')})`, 'TOTAL WIN', prompt),
        scratchCheck(
          shown === settled.winAmount,
          `Prompt amount ${shown} = Cashout win ${settled.winAmount}`,
          settled.winAmount,
          shown,
        ),
      ]);
      return;
    }
    test.skip(true, `No winning card in ${MAX_CARDS} cards`);
  });
});
