/**
 * PAD-044 — Warm load (cache kept, 3 loads) after one cold load in the same test.
 * Expected: every warm load faster than the cold load; the warm mean within 10% of the stored
 * warm baseline for this build and browser (the first run records it).
 */

import { test, expect } from '../../fixtures/index.js';
import { annotate, withPad } from '../../support/pad-perf.js';
import { browserLabel, count, gameBuild, mean, measureLoad } from '../../support/pad-scenarios.js';
import { appendBaseline, latestBaseline } from '../../../src/perf/index.js';

const MANUAL_TEST_ID = 'PAD-044' as const;
const LOADS = count(3, 1);

test.describe('PAD — Performance & Asset Diagnostics', () => {
  test(`${MANUAL_TEST_ID} warm load`, async ({ sgapSession, sgapDriver, page }, testInfo) => {
    test.setTimeout((LOADS + 1) * 3 * 60_000);
    await withPad({ sgapSession, sgapDriver, page }, testInfo, MANUAL_TEST_ID, async (ctx, windows) => {
      const cold = await measureLoad(ctx, 'cold reference', true);
      windows.push(cold.window);
      annotate(testInfo, 'cold reference', `game ${cold.gameLoadMs} ms (spin ready ${cold.spinReadyMs} ms; total ${cold.totalMs} ms)`);
      const warm: number[] = [];
      for (let load = 1; load <= LOADS; load += 1) {
        const t = await measureLoad(ctx, `warm ${load}`, false);
        windows.push(t.window);
        warm.push(t.gameLoadMs);
        annotate(testInfo, `warm ${load}`, `game ${t.gameLoadMs} ms (spin ready ${t.spinReadyMs} ms; total ${t.totalMs} ms)`);
        expect.soft(t.gameLoadMs, `warm ${load} faster than cold (${cold.gameLoadMs} ms)`).toBeLessThan(cold.gameLoadMs);
      }
      const warmMean = Math.round(mean(warm));
      const gameId = sgapSession.manifest.gameId;
      const build = await gameBuild(ctx);
      const browser = await browserLabel(ctx);
      const baseline = latestBaseline(gameId, MANUAL_TEST_ID, (e) => e.build === build && e.browser === browser);
      appendBaseline(gameId, { caseId: MANUAL_TEST_ID, build, browser, metrics: { warmLoadMs: warmMean, coldLoadMs: cold.gameLoadMs } });
      if (baseline === undefined) {
        annotate(testInfo, 'baseline', `First warm-load record for build ${build} on ${browser}: ${warmMean} ms`);
        return;
      }
      const ref = baseline.metrics.warmLoadMs ?? Number.NaN;
      annotate(testInfo, 'vs baseline', `warm mean ${warmMean} ms vs ${ref} ms (${baseline.at})`);
      expect.soft(warmMean, 'warm load vs warm baseline + 10%').toBeLessThanOrEqual(ref * 1.1);
    });
  });
});
