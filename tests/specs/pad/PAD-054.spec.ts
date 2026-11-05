/**
 * PAD-054 — FPS counter accuracy: the on-screen badge vs the recorded window average,
 * during idle (3 × 20 s) and during spins (3).
 * Expected: mean badge reading within ±2 FPS of the recorded average.
 */

import { test, expect } from '../../fixtures/index.js';
import { annotate, measureSpin, settle, startPad } from '../../support/pad-perf.js';
import { readFpsCounter } from '../../../src/perf/index.js';

const MANUAL_TEST_ID = 'PAD-054' as const;
const RUNS = 3;
const IDLE_MS = 20_000;
const TOLERANCE_FPS = 2;

test.describe('PAD — Performance & Asset Diagnostics', () => {
  test(`${MANUAL_TEST_ID} FPS counter accuracy`, async ({ sgapSession, sgapDriver, page }, testInfo) => {
    test.setTimeout(12 * 60_000);
    const ctx = await startPad(sgapSession, sgapDriver, page, testInfo, MANUAL_TEST_ID);
    const rows: { label: string; badgeMean: number; badgeSamples: number; recordedAvg: number; diff: number }[] = [];

    const watchBadge = (stop: { done: boolean }): Promise<number[]> =>
      (async () => {
        const values: number[] = [];
        await page.waitForTimeout(1_500);
        while (!stop.done) {
          const value = await readFpsCounter(page);
          if (value !== undefined) values.push(value);
          await page.waitForTimeout(1_000);
        }
        return values;
      })();

    try {
      await settle(ctx);
      for (let run = 1; run <= RUNS; run += 1) {
        const label = `idle ${run}/${RUNS}`;
        ctx.perf.setStatus(`${MANUAL_TEST_ID} ${label}`);
        const token = ctx.perf.begin(label);
        const stop = { done: false };
        const badge = watchBadge(stop);
        await page.waitForTimeout(IDLE_MS);
        stop.done = true;
        const values = await badge;
        const w = await ctx.perf.end(token);
        const badgeMean = values.reduce((a, b) => a + b, 0) / Math.max(1, values.length);
        rows.push({ label, badgeMean, badgeSamples: values.length, recordedAvg: w.stats.avgFps, diff: badgeMean - w.stats.avgFps });
      }
      for (let run = 1; run <= RUNS; run += 1) {
        const label = `spin ${run}/${RUNS}`;
        const stop = { done: false };
        const badge = watchBadge(stop);
        const w = await measureSpin(ctx, label);
        stop.done = true;
        const values = await badge;
        const badgeMean = values.reduce((a, b) => a + b, 0) / Math.max(1, values.length);
        rows.push({ label, badgeMean, badgeSamples: values.length, recordedAvg: w.stats.avgFps, diff: badgeMean - w.stats.avgFps });
      }
    } finally {
      await ctx.perf.stop();
      await testInfo.attach('pad-054-counter.json', { body: JSON.stringify(rows, null, 2), contentType: 'application/json' });
    }

    for (const row of rows) {
      annotate(
        testInfo,
        'counter',
        `${row.label}: badge ${row.badgeMean.toFixed(1)} (${row.badgeSamples} reads) vs recorded ${row.recordedAvg} → ${row.diff >= 0 ? '+' : ''}${row.diff.toFixed(1)} FPS`,
      );
      expect.soft(row.badgeSamples, `${row.label}: badge readable`).toBeGreaterThan(0);
      expect.soft(Math.abs(row.diff), `${row.label}: badge vs recorded`).toBeLessThanOrEqual(TOLERANCE_FPS);
    }
  });
});
