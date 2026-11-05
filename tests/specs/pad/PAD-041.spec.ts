/**
 * PAD-041 — Repeatability: PAD-003 (10 spins) five times.
 * Expected: P95 frame-time spread ≤ 10% across sets; otherwise results are inconclusive.
 */

import { test, expect } from '../../fixtures/index.js';
import { annotate, attachWindows, measureSpin, pooled, startPad } from '../../support/pad-perf.js';
import type { PerfWindow } from '../../../src/perf/index.js';

const MANUAL_TEST_ID = 'PAD-041' as const;
const SETS = 5;
const SPINS = 10;
const MAX_SPREAD = 0.1;

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function spread(values: readonly number[]): number {
  const mid = median(values);
  return mid > 0 ? (Math.max(...values) - Math.min(...values)) / mid : Number.NaN;
}

test.describe('PAD — Performance & Asset Diagnostics', () => {
  test(`${MANUAL_TEST_ID} repeatability of 10-spin sets`, async ({ sgapSession, sgapDriver, page }, testInfo) => {
    test.setTimeout(45 * 60_000);
    const ctx = await startPad(sgapSession, sgapDriver, page, testInfo, MANUAL_TEST_ID);
    const windows: PerfWindow[] = [];
    const sets: { avgFps: number; low1Fps: number; p95Ms: number; hitches: number }[] = [];
    try {
      for (let set = 1; set <= SETS; set += 1) {
        const setWindows: PerfWindow[] = [];
        for (let i = 1; i <= SPINS; i += 1) {
          setWindows.push(await measureSpin(ctx, `set ${set} spin ${i}`));
        }
        windows.push(...setWindows);
        const p = pooled(setWindows);
        sets.push(p);
        annotate(testInfo, 'set', `set ${set}: avg ${p.avgFps} FPS, 1% low ${p.low1Fps}, worst P95 ${p.p95Ms} ms, hitches ${p.hitches}`);
      }
    } finally {
      await ctx.perf.stop();
      await attachWindows(testInfo, 'pad-041-repeatability', windows);
      await testInfo.attach('pad-041-sets.json', { body: JSON.stringify(sets, null, 2), contentType: 'application/json' });
    }

    const medianP95 = sets.map((_, i) => median(windows.slice(i * SPINS, (i + 1) * SPINS).map((w) => w.stats.p95Ms)));
    const p95Spread = spread(medianP95);
    const fpsSpread = spread(sets.map((s) => s.avgFps));
    annotate(
      testInfo,
      'noise',
      `median spin P95 per set ${medianP95.map((v) => v.toFixed(1)).join(' / ')} ms → spread ${(p95Spread * 100).toFixed(1)}%; avg FPS spread ${(fpsSpread * 100).toFixed(1)}%`,
    );
    expect(sets.length).toBe(SETS);
    expect.soft(p95Spread, 'P95 spread across sets (≤ 10% or the run is inconclusive)').toBeLessThanOrEqual(MAX_SPREAD);
  });
});
