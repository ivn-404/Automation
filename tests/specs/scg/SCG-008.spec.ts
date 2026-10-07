/**
 * SCG-008 — Scratch Game
 *
 * Manual Test Case ID: SCG-008
 * Catalog: Dimension selection is existing and clickable
 * Intent: the drawer draws 3×3 / 4×4 / 5×5 tabs, and each tap is taken — the
 * legend redraws differently for every size.
 */

import { test } from '../../fixtures/index.js';
import { requireCapabilities } from '../../support/capabilities.js';
import type { ScratchGridSize } from '../../../src/controllers/index.js';
import { expectChecks, readLegend, scratchCheck, startScratchCase } from '../../support/scratch-flow.js';

const MANUAL_TEST_ID = 'SCG-008' as const;

test.describe('SCG — Scratch Game', () => {
  requireCapabilities('scratchCard');

  test(`${MANUAL_TEST_ID} Dimension selection is existing and clickable`, async ({
    sgapSession,
    sgapDriver,
    page,
  }, testInfo) => {
    test.setTimeout(300_000);
    const scratch = await startScratchCase({ sgapSession, sgapDriver, page, testInfo, manualTestId: MANUAL_TEST_ID });

    await scratch.open();
    const tabs = (await scratch.readTextArea('sizeTabs')).map((text) => text.replace(/[x×]/gu, 'x'));
    const legends = new Map<ScratchGridSize, string>();
    for (const size of [3, 4, 5] as const) {
      await scratch.selectSize(size);
      legends.set(size, (await readLegend(scratch)).join(' '));
    }

    const distinct = new Set([legends.get(3), legends.get(4), legends.get(5)]);
    await expectChecks(testInfo, [
      ...(['3x3', '4x4', '5x5'] as const).map((label) =>
        scratchCheck(tabs.includes(label), `Size tab ${label} is drawn`, label, tabs),
      ),
      scratchCheck(
        distinct.size === 3,
        `Each size tap redraws the legend (3x3 "${legends.get(3)}", 4x4 "${legends.get(4)}", 5x5 "${legends.get(5)}")`,
        '3 distinct legends',
        Object.fromEntries(legends),
      ),
    ]);
  });
});
