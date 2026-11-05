/**
 * PAD-023 — Same file downloaded more than once in a session (not served from cache).
 * Scenario as PAD-022 (cold). Expected: repeated downloads listed; none expected.
 */

import { test, expect } from '../../fixtures/index.js';
import { annotate, withPad } from '../../support/pad-perf.js';
import { attachAssetReport, coldAssetSession, count, kb, startAssetAudit } from '../../support/pad-scenarios.js';

const MANUAL_TEST_ID = 'PAD-023' as const;
const SPINS = count(20, 3);

test.describe('PAD — Performance & Asset Diagnostics', () => {
  test(`${MANUAL_TEST_ID} same file downloaded more than once`, async ({ sgapSession, sgapDriver, page }, testInfo) => {
    test.setTimeout(SPINS * 60_000 + 15 * 60_000);
    await withPad({ sgapSession, sgapDriver, page }, testInfo, MANUAL_TEST_ID, async (ctx, windows) => {
      const audit = startAssetAudit(ctx);
      try {
        const cold = await coldAssetSession(ctx, audit, SPINS);
        windows.push(...cold.windows);
        await attachAssetReport(testInfo, 'pad-023-assets', cold.report);
        const repeats = (await audit.report((r) => r.origin !== 'launcher')).repeats;
        const launcherRepeats = (await audit.report((r) => r.origin === 'launcher')).repeats;
        annotate(testInfo, 'repeats', repeats.length === 0 ? 'No game file downloaded twice' : repeats.map((r) => `${r.downloads}× ${kb(r.bytes)} ${r.url}`).join('; '));
        if (launcherRepeats.length > 0) {
          annotate(testInfo, 'launcher repeats (not scored)', launcherRepeats.map((r) => `${r.downloads}× ${kb(r.bytes)} ${r.url}`).join('; '));
        }
        expect(cold.report.total, 'responses recorded').toBeGreaterThan(0);
        expect.soft(repeats.length, 'game files downloaded more than once from the network').toBe(0);
      } finally {
        await audit.stop();
      }
    });
  });
});
