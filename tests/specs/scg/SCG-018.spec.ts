/**
 * SCG-018 — Scratch Game
 *
 * Manual Test Case ID: SCG-018
 * Catalog: Cannot scratch upon launching panel
 * Intent: right after the drawer opens (no card bought), dragging over the dust
 * sends nothing to the scratch hub, costs nothing, and the pill still offers BUY CARD.
 */

import { test } from '../../fixtures/index.js';
import { requireCapabilities } from '../../support/capabilities.js';
import { attachDrawer, expectChecks, scratchCheck, startScratchCase } from '../../support/scratch-flow.js';

const MANUAL_TEST_ID = 'SCG-018' as const;

test.describe('SCG — Scratch Game', () => {
  requireCapabilities('scratchCard');

  test(`${MANUAL_TEST_ID} Cannot scratch upon launching panel`, async ({ sgapSession, sgapDriver, page }, testInfo) => {
    test.setTimeout(300_000);
    const scratch = await startScratchCase({ sgapSession, sgapDriver, page, testInfo, manualTestId: MANUAL_TEST_ID });
    const hub = scratch.hubWatcher();

    await scratch.open();
    const balanceBefore = hub.lastBalance();
    const since = Date.now();
    await scratch.dragScratchArea();
    await page.waitForTimeout(3_000);
    const sent = hub.invokedTargets(since);
    const pill = await scratch.readTextArea('pill');
    await attachDrawer(testInfo, scratch, 'scratch-after-drag-without-card.png');

    await expectChecks(testInfo, [
      scratchCheck(
        !sent.includes('StartRound') && !sent.includes('Cashout'),
        `Drag without a card sent no StartRound / Cashout (sent: ${sent.join(', ') || 'nothing'})`,
        'none',
        sent,
      ),
      scratchCheck(
        pill.some((text) => /buy card/iu.test(text)),
        `Pill still offers BUY CARD (${pill.join(' ')})`,
        'BUY CARD',
        pill,
      ),
      scratchCheck(
        hub.lastBalance() === balanceBefore,
        `Hub balance unchanged ${balanceBefore} → ${hub.lastBalance()}`,
        balanceBefore,
        hub.lastBalance(),
      ),
    ]);
  });
});
