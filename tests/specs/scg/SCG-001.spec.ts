/**
 * SCG-001 — Scratch Game
 *
 * Manual Test Case ID: SCG-001
 * Catalog: Button is existing and clickable
 * Intent: the HUD shows a SCRATCH button, and tapping it opens the scratch drawer
 * (drawer title drawn + BUY CARD pill visible) where it was not drawn before.
 */

import { test } from '../../fixtures/index.js';
import { requireCapabilities } from '../../support/capabilities.js';
import { listPhaserTexts } from '../../../src/runtime/index.js';
import { attachDrawer, expectChecks, scratchCheck, startScratchCase } from '../../support/scratch-flow.js';

const MANUAL_TEST_ID = 'SCG-001' as const;

test.describe('SCG — Scratch Game', () => {
  requireCapabilities('scratchCard');

  test(`${MANUAL_TEST_ID} Button is existing and clickable`, async ({ sgapSession, sgapDriver, page }, testInfo) => {
    test.setTimeout(300_000);
    const scratch = await startScratchCase({ sgapSession, sgapDriver, page, testInfo, manualTestId: MANUAL_TEST_ID });

    const hudTexts = await listPhaserTexts(page, sgapDriver.iframeSelector);
    const buttonLabel = hudTexts.find((hit) => /^scratch$/iu.test(hit.text));
    const titleBefore = await scratch.readTextArea('title');

    await scratch.open();
    const location = await scratch.drawerLocation();
    const titleAfter = await scratch.readTextArea('title');
    await attachDrawer(testInfo, scratch, 'scratch-drawer-open.png');

    await expectChecks(testInfo, [
      scratchCheck(buttonLabel !== undefined, 'HUD shows a SCRATCH button label', 'SCRATCH', buttonLabel?.text),
      scratchCheck(
        !titleBefore.some((text) => /scratch card/iu.test(text)),
        'Drawer title is not drawn before the tap',
        'absent',
        titleBefore,
      ),
      scratchCheck(location !== 'closed', `Tap opened the drawer (${location})`, 'open', location),
      scratchCheck(
        titleAfter.some((text) => /scratch card/iu.test(text)),
        'Drawer title SCRATCH CARD drawn after the tap',
        'SCRATCH CARD',
        titleAfter,
      ),
    ]);
  });
});
