/**
 * PAD-019 — 30-minute continuous session (2 runs): normal-speed autoplay batches for 30 min,
 * then 60 s idle. Expected: no downward FPS trend (median P95 of the last 3 batches within 10% of
 * the first 3); heap after GC ≤ +10% of the heap after batch 1 (first-use warm-up is reported, not
 * scored); the tab survives; idle FPS back to the opening idle FPS.
 */

import { test, expect } from '../../fixtures/index.js';
import { requireCapabilities } from '../../support/capabilities.js';
import { annotate, measureIdle, settle, withPad } from '../../support/pad-perf.js';
import { count, measureAutoplayBatch, median, p95s } from '../../support/pad-scenarios.js';
import type { PerfWindow } from '../../../src/perf/index.js';

const MANUAL_TEST_ID = 'PAD-019' as const;
const RUNS = count(2, 1);
const SESSION_MS = count(30 * 60_000, 3 * 60_000);
const FINAL_IDLE_MS = count(60_000, 20_000);
const GROUP = 3;

test.describe('PAD — Performance & Asset Diagnostics', () => {
  requireCapabilities('autoplay');

  test(`${MANUAL_TEST_ID} 30-minute continuous session`, async ({ sgapSession, sgapDriver, page }, testInfo) => {
    test.setTimeout(RUNS * (SESSION_MS + FINAL_IDLE_MS + 6 * 60_000));
    await withPad({ sgapSession, sgapDriver, page }, testInfo, MANUAL_TEST_ID, async (ctx, windows) => {
      for (let run = 1; run <= RUNS; run += 1) {
        await settle(ctx);
        const opening = await measureIdle(ctx, `run ${run} opening idle`, 15_000);
        windows.push(opening);
        const heapStart = await ctx.perf.heapAfterGcMb();
        const batches: PerfWindow[] = [];
        let heapWarm: number | undefined;
        const started = Date.now();
        while (Date.now() - started < SESSION_MS) {
          const { window } = await measureAutoplayBatch(ctx, `run ${run} batch ${batches.length + 1}`);
          batches.push(window);
          if (batches.length === 1) heapWarm = await ctx.perf.heapAfterGcMb();
          ctx.perf.setStatus(`run ${run} · ${Math.round((Date.now() - started) / 60_000)} of ${SESSION_MS / 60_000} min`);
        }
        windows.push(...batches);
        expect(page.isClosed(), 'tab still open').toBe(false);
        await expect(sgapDriver.gameCanvas(), 'game canvas still visible').toBeVisible();
        const heapEnd = await ctx.perf.heapAfterGcMb();
        await settle(ctx);
        const finalIdle = await measureIdle(ctx, `run ${run} final idle`, FINAL_IDLE_MS);
        windows.push(finalIdle);
        const first = median(p95s(batches.slice(0, GROUP)));
        const last = median(p95s(batches.slice(-GROUP)));
        annotate(testInfo, `run ${run}`, `${batches.length} batches; P95 ${first} → ${last} ms; heap ${heapStart ?? '?'} (after load) → ${heapWarm ?? '?'} (after batch 1) → ${heapEnd ?? '?'} MB; idle ${opening.stats.avgFps} → ${finalIdle.stats.avgFps} FPS`);
        expect.soft(last, `run ${run}: no downward trend`).toBeLessThanOrEqual(first * 1.1);
        if (heapWarm !== undefined && heapEnd !== undefined && batches.length > 1) {
          expect.soft(heapEnd, `run ${run}: heap growth after warm-up (${heapWarm} MB after batch 1)`).toBeLessThanOrEqual(heapWarm * 1.1);
        }
        expect.soft(finalIdle.stats.avgFps, `run ${run}: idle FPS back to opening idle`).toBeGreaterThanOrEqual(opening.stats.avgFps - 2);
      }
    });
  });
});
