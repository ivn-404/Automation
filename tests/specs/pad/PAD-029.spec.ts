/**
 * PAD-029 — Browser caching of reusable assets. One cold load (cache cleared), then 3 warm
 * reloads. Only files the game frame loads count (launcher files are reported, not scored).
 * Expected: ≥ 95% of game asset bytes served from cache on each warm load.
 */

import { test, expect } from '../../fixtures/index.js';
import { annotate, reloadGame, withPad } from '../../support/pad-perf.js';
import { attachAssetReport, clearHttpCache, count, kb, startAssetAudit } from '../../support/pad-scenarios.js';

const MANUAL_TEST_ID = 'PAD-029' as const;
const WARM_LOADS = count(3, 1);
const MIN_CACHED = 0.95;

test.describe('PAD — Performance & Asset Diagnostics', () => {
  test(`${MANUAL_TEST_ID} browser caching of reusable assets`, async ({ sgapSession, sgapDriver, page }, testInfo) => {
    test.setTimeout((WARM_LOADS + 1) * 4 * 60_000);
    await withPad({ sgapSession, sgapDriver, page }, testInfo, MANUAL_TEST_ID, async (ctx) => {
      const audit = startAssetAudit(ctx);
      try {
        await clearHttpCache(page);
        audit.reset();
        await reloadGame(ctx);
        await page.waitForTimeout(5_000);
        const cold = await audit.report((r) => r.origin !== 'launcher');
        annotate(testInfo, 'cold', `${cold.total} game files, ${kb(cold.totalBytes)}`);
        for (let load = 1; load <= WARM_LOADS; load += 1) {
          audit.reset();
          await reloadGame(ctx);
          await page.waitForTimeout(5_000);
          const warm = await audit.report((r) => r.origin !== 'launcher');
          await attachAssetReport(testInfo, `pad-029-warm-${load}`, warm);
          const ratio = warm.cache.byteRatio;
          const misses = warm.records.filter((r) => !r.fromCache).sort((a, b) => b.bytes - a.bytes);
          annotate(testInfo, `warm ${load}`, `${(ratio * 100).toFixed(1)}% of ${kb(warm.totalBytes)} from cache; not cached: ${misses.slice(0, 8).map((r) => `${kb(r.bytes)} ${r.url}`).join('; ') || 'none'}`);
          expect.soft(ratio, `warm ${load}: share of game asset bytes from cache`).toBeGreaterThanOrEqual(MIN_CACHED);
        }
      } finally {
        await audit.stop();
      }
    });
  });
});
