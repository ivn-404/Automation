/**
 * BUSY-056 — load lane for PAD-056, not a test case. Parks on a blank page (no GPU use) and only
 * opens the game and spins while PAD-056 asks for load. Ends when PAD-056 marks the hand-off done.
 */

import { test } from '../../fixtures/index.js';
import { prepareCanvasSpin } from '../../support/canvas-bet-control.js';
import { spinForBet } from '../../support/canvas-bet-flow.js';
import { busyDone, busyHeartbeat, busyRequested } from '../../support/pad-busy-lane.js';
import { reopenGame } from '../../support/pad-perf.js';

const MAX_WAIT_MS = 12 * 60 * 60_000;

test.describe('PAD — busy lane', () => {
  test('BUSY-056 second-monitor load for PAD-056', async ({ sgapSession, sgapDriver, page }, testInfo) => {
    test.setTimeout(MAX_WAIT_MS + 5 * 60_000);
    testInfo.annotations.push({ type: 'category', description: 'PAD-LOAD' });
    const started = Date.now();
    const launcherUrl = page.url();
    await page.goto('about:blank');
    let open = false;
    while (!busyDone(started) && Date.now() - started < MAX_WAIT_MS) {
      if (busyRequested()) {
        if (!open) {
          await reopenGame(sgapSession, sgapDriver, page, launcherUrl);
          await prepareCanvasSpin(sgapSession, sgapDriver, page);
          open = true;
        }
        await spinForBet(sgapSession, sgapDriver, page).catch(() => undefined);
        busyHeartbeat();
      } else {
        if (open) {
          await page.goto('about:blank');
          open = false;
        }
        await page.waitForTimeout(2_000);
      }
    }
  });
});
