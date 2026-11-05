/**
 * PEN-038 — Keyboard shortcuts do not book more than one stake.
 *
 * Manual Test Case ID: PEN-038 (docs/catalogs/PERSONALTESTING.md §7)
 * Intent: focus the canvas and press Space, c, and ArrowUp once each.
 * The wallet does not move by more than one stake plus that card's win.
 */

import { test } from '../../fixtures/index.js';
import {
  cashout,
  expectPenChecks,
  penCheck,
  readBalance,
  requireJoined,
  startPenSession,
} from '../../support/pen-hub.js';

const MANUAL_TEST_ID = 'PEN-038' as const;

test.describe('PEN — Protocol', () => {
  test(`${MANUAL_TEST_ID} shortcut keys stay within one stake`, async ({ sgapSession, sgapDriver, page }, testInfo) => {
    test.setTimeout(300_000);
    const session = await startPenSession({ sgapSession, sgapDriver, page, testInfo, manualTestId: MANUAL_TEST_ID });
    try {
      requireJoined(session);
      await cashout(session);
      const before = (await readBalance(session)) ?? session.balance ?? 0;
      const minBet = session.config?.minBet ?? 0.1;
      const maxWin = session.config?.maxWinMultiplier ?? 200;
      const canvas = page.frameLocator(sgapDriver.iframeSelector).locator('canvas').first();
      const visible = await canvas.isVisible().catch(() => false);
      if (visible) {
        await canvas.click({ position: { x: 20, y: 20 }, force: true }).catch(() => undefined);
      }
      for (const key of ['Space', 'c', 'ArrowUp'] as const) {
        await page.keyboard.press(key);
        await page.waitForTimeout(500);
      }
      await cashout(session);
      const after = (await readBalance(session)) ?? before;
      const floor = before - minBet - 0.02;
      const ceiling = before + minBet * maxWin + 0.02;
      await expectPenChecks(
        testInfo,
        [
          penCheck(
            visible,
            visible ? 'The game canvas took focus for the shortcut keys' : 'The game canvas was not available for keyboard input',
            'canvas focused',
            visible,
          ),
          penCheck(
            after >= floor && after <= ceiling,
            `Space, c, and ArrowUp left the wallet at ${after} from ${before}`,
            `${floor} to ${ceiling}`,
            after,
          ),
        ],
        { before, after, visible },
      );
    } finally {
      session.client.close();
    }
  });
});
