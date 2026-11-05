/**
 * PAD-004 — FPS across 20 consecutive spins (3 runs).
 * Expected: no downward trend — median P95 of spins 16–20 within 10% of spins 1–5; pass band.
 */

import { test, expect } from '../../fixtures/index.js';
import { annotate, bandOutcome, measureSpin, pooled, withPad } from '../../support/pad-perf.js';
import { count, median, p95s } from '../../support/pad-scenarios.js';

const MANUAL_TEST_ID = 'PAD-004' as const;
const RUNS = count(3, 1);
const SPINS = count(20, 6);
const GROUP = count(5, 2);
const TREND_LIMIT = 1.1;

test.describe('PAD — Performance & Asset Diagnostics', () => {
  test(`${MANUAL_TEST_ID} FPS across consecutive spins`, async ({ sgapSession, sgapDriver, page }, testInfo) => {
    test.setTimeout(RUNS * SPINS * 60_000);
    await withPad({ sgapSession, sgapDriver, page }, testInfo, MANUAL_TEST_ID, async (ctx, windows) => {
      for (let run = 1; run <= RUNS; run += 1) {
        const runWindows = [];
        for (let i = 1; i <= SPINS; i += 1) {
          runWindows.push(await measureSpin(ctx, `run ${run} spin ${i}/${SPINS}`));
        }
        windows.push(...runWindows);
        const first = median(p95s(runWindows.slice(0, GROUP)));
        const last = median(p95s(runWindows.slice(-GROUP)));
        const all = pooled(runWindows);
        const outcome = bandOutcome(all.avgFps, all.low1Fps);
        annotate(
          testInfo,
          `run ${run}`,
          `${outcome.text}; P95 first ${GROUP} spins ${first} ms → last ${GROUP} spins ${last} ms (${((last / first - 1) * 100).toFixed(1)}%)`,
        );
        expect.soft(outcome.verdict, `run ${run}: ${outcome.text}`).not.toBe('fail');
        expect.soft(last, `run ${run}: last-spins P95 within 10% of first-spins P95 (${first} ms)`).toBeLessThanOrEqual(
          first * TREND_LIMIT,
        );
      }
    });
  });
});
