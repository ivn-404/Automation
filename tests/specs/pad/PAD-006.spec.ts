/**
 * PAD-006 — FPS during continuous Autoplay (50 spins, 3 runs), normal speed.
 * Autoplay runs in batches of the manifest's selected spin count. Each spin is the segment
 * between two `/bet` responses. Expected: pass band per batch; no downward trend (median P95 of
 * the last 5 spins within 10% of the first 5).
 */

import { test, expect } from '../../fixtures/index.js';
import { requireCapabilities } from '../../support/capabilities.js';
import { annotate, bandOutcome, withPad } from '../../support/pad-perf.js';
import { count, measureAutoplayBatch, median } from '../../support/pad-scenarios.js';

const MANUAL_TEST_ID = 'PAD-006' as const;
const RUNS = count(3, 1);
const TARGET_SPINS = count(50, 10);
const GROUP = 5;

test.describe('PAD — Performance & Asset Diagnostics', () => {
  requireCapabilities('autoplay');

  test(`${MANUAL_TEST_ID} FPS during continuous autoplay`, async ({ sgapSession, sgapDriver, page }, testInfo) => {
    test.setTimeout(RUNS * TARGET_SPINS * 25_000 + 10 * 60_000);
    await withPad({ sgapSession, sgapDriver, page }, testInfo, MANUAL_TEST_ID, async (ctx, windows) => {
      for (let run = 1; run <= RUNS; run += 1) {
        const segmentP95: number[] = [];
        let spins = 0;
        let batch = 0;
        while (spins < TARGET_SPINS) {
          batch += 1;
          const { window, betTimes } = await measureAutoplayBatch(ctx, `run ${run} batch ${batch}`);
          windows.push(window);
          if (betTimes.length === 0) throw new Error(`run ${run} batch ${batch}: autoplay produced no /bet`);
          spins += betTimes.length;
          const edges = [...betTimes, window.endedAt];
          for (let i = 0; i + 1 < edges.length; i += 1) {
            segmentP95.push(ctx.perf.windowBetween('segment', edges[i]!, edges[i + 1]!).stats.p95Ms);
          }
          const outcome = bandOutcome(window.stats.avgFps, window.stats.low1Fps);
          expect.soft(outcome.verdict, `${window.label}: ${outcome.text}`).not.toBe('fail');
        }
        const first = median(segmentP95.slice(0, GROUP));
        const last = median(segmentP95.slice(-GROUP));
        annotate(testInfo, `run ${run}`, `${spins} autoplay spins; P95 first ${GROUP} ${first} ms → last ${GROUP} ${last} ms`);
        expect.soft(last, `run ${run}: no downward trend (first ${first} ms)`).toBeLessThanOrEqual(first * 1.1);
      }
    });
  });
});
