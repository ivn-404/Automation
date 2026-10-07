/**
 * PROBE-003 — HUD balance sync after a failed /bet.
 *
 * Not a QA catalog ID. Diagnostic for AT-003: one real spin, one /bet answered
 * with HTTP 500 by the test, the error dialog closed with its own OK button only
 * (no blind overlay taps), then several real spins. After each spin the HUD is
 * compared with the server balance, so a stale HUD can be told apart from one
 * that lags by a round or recovers on its own. Results are informational.
 */

import { test, expect } from '../../fixtures/index.js';
import { getLauncherMode } from '../../fixtures/local-launcher-html.js';
import { settleCanvasToBaseGame } from '../../../src/platform/index.js';
import { INJECTED_HEADER, observationFor } from '../../../src/observability/index.js';
import { spinForBet } from '../../support/canvas-bet-flow.js';
import { waitForIdleHud } from '../../support/canvas-healing.js';
import { slotHudBalance } from '../../support/scratch-flow.js';
import { dismissErrorDialog, ensureBaseHud } from '../../support/session-guard.js';

const MANUAL_TEST_ID = 'PROBE-003' as const;
const SETTLE_MS = 12_000;
const SPINS_AFTER_FAILURE = Number(process.env.SGAP_PROBE_SPINS ?? '3');

test.describe('PROBE — failed bet HUD sync', () => {
  test(`${MANUAL_TEST_ID} does the HUD follow the server after a failed bet?`, async ({
    sgapSession,
    sgapDriver,
    page,
  }, testInfo) => {
    test.setTimeout(420_000);
    test.skip(getLauncherMode() !== 'staging', 'Needs a real /bet');
    testInfo.annotations.push(
      { type: 'manualTestId', description: MANUAL_TEST_ID },
      { type: 'category', description: 'PROBE' },
      { type: 'gameId', description: sgapSession.manifest.gameId },
    );
    const observe = observationFor(page);
    const rows: string[] = [];

    const settledHud = async (target: number): Promise<number | undefined> => {
      let hud: number | undefined;
      const by = Date.now() + SETTLE_MS;
      while (Date.now() < by) {
        hud = await slotHudBalance(page, sgapDriver.iframeSelector);
        if (hud !== undefined && Math.abs(hud - target) < 0.005) {
          return hud;
        }
        await page.waitForTimeout(500);
      }
      return hud;
    };
    const realSpin = async (label: string): Promise<void> => {
      observe?.event('probe-spin', label);
      const result = await spinForBet(sgapSession, sgapDriver, page);
      const server = Number(result.balance!.amount);
      const hud = await settledHud(server);
      const diff = hud === undefined ? 'n/a' : (Math.round((hud - server) * 100) / 100).toString();
      rows.push(`${label.padEnd(26)} stake=${result.bet?.amount ?? '?'} win=${result.win?.amount ?? '?'} server=${server} hud=${hud} diff=${diff}`);
      await observe?.sampleBalance(`after ${label}`);
    };

    await expect(sgapDriver.isAttached()).resolves.toBe(true);
    await sgapDriver.gameCanvas().waitFor({ state: 'visible' });
    await ensureBaseHud(sgapSession, sgapDriver, page);
    await settleCanvasToBaseGame(page, sgapDriver, sgapSession.manifest, sgapSession.platform.getInitializeBody());

    await realSpin('warm spin');

    const betPattern = `${sgapSession.manifest.network!.betUrlPattern}**`;
    let failed = 0;
    await page.route(betPattern, async (route) => {
      failed += 1;
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        headers: { [INJECTED_HEADER]: MANUAL_TEST_ID },
        body: JSON.stringify({ statusCode: 500, message: 'Internal server error' }),
      });
    });
    observe?.event('fault-injection-armed', 'one /bet answered with HTTP 500 by the test', { severity: 'warn' });
    await waitForIdleHud(page, sgapDriver, sgapSession.manifest, 12_000);
    for (let attempt = 0; attempt < 3 && failed === 0; attempt += 1) {
      await sgapSession.spin.clickSpin({ timeoutMs: 20_000, singleInput: true, useHealedRatio: attempt > 0 });
      await page.waitForTimeout(1_500);
    }
    await page.waitForTimeout(3_000);
    const hudAfterFailure = await slotHudBalance(page, sgapDriver.iframeSelector);
    await page.unroute(betPattern);
    observe?.event('fault-injection-removed', `${failed} request(s) failed by the test`);
    const dismissed = await dismissErrorDialog(page, sgapDriver);
    observe?.event('error-dialog-dismissed', dismissed ? 'closed with OK only' : 'would not close');
    rows.push(`failed bet (x${failed})            hud after refund=${hudAfterFailure} dialog closed=${dismissed}`);

    for (let index = 1; index <= SPINS_AFTER_FAILURE; index += 1) {
      await realSpin(`spin ${index} after failure`);
    }

    const report = rows.join('\n');
    console.log(`\n[${MANUAL_TEST_ID}] ${sgapSession.manifest.gameId}\n${report}\n`);
    await testInfo.attach('probe-003.txt', { body: report, contentType: 'text/plain' });
    expect(failed, 'the injected /bet failure was exercised').toBeGreaterThan(0);
  });
});
