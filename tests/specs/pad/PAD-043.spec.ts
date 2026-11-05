/**
 * PAD-043 — Cold load (cache cleared, 3 loads): game iframe document start → initial assets in and
 * frames smooth (see `LoadTiming.gameLoadMs`). Spin-ready time including SGAP's splash tap and the
 * launcher steps are reported separately. Frame stability during
 * the load is its own window and is not mixed into gameplay results.
 * Expected: game load ≤ 8 s.
 */

import { test, expect } from '../../fixtures/index.js';
import { annotate, withPad } from '../../support/pad-perf.js';
import { count, measureLoad } from '../../support/pad-scenarios.js';

const MANUAL_TEST_ID = 'PAD-043' as const;
const LOADS = count(3, 1);
const LIMIT_MS = 8_000;

test.describe('PAD — Performance & Asset Diagnostics', () => {
  test(`${MANUAL_TEST_ID} cold load`, async ({ sgapSession, sgapDriver, page }, testInfo) => {
    test.setTimeout(LOADS * 3 * 60_000);
    await withPad({ sgapSession, sgapDriver, page }, testInfo, MANUAL_TEST_ID, async (ctx, windows) => {
      for (let load = 1; load <= LOADS; load += 1) {
        const t = await measureLoad(ctx, `cold ${load}`, true);
        windows.push(t.window);
        annotate(testInfo, `cold ${load}`, `game ${t.gameLoadMs} ms (spin ready incl. SGAP splash tap ${t.spinReadyMs} ms; total with launcher ${t.totalMs} ms); during load avg ${t.window.stats.avgFps} FPS, max frame ${t.window.stats.maxMs} ms`);
        expect.soft(t.gameLoadMs, `cold ${load}: game load`).toBeLessThanOrEqual(LIMIT_MS);
      }
    });
  });
});
