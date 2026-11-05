/**
 * PAD-020 — Resources after repeated Menu / Help use (20 open/close cycles, 3 runs). After each
 * cycle: heap after forced GC and the scene's lowest display-object count over the 2 s after close
 * (idle effects add short-lived objects, so a leak shows as a rising floor).
 * Expected: no growth per cycle — mean of the last 5 within 5% of the first 5 (heap) and the
 * floor of the last cycles no higher than the first cycles' highest.
 */

import { test, expect } from '../../fixtures/index.js';
import { requireCapabilities } from '../../support/capabilities.js';
import { annotate, settle, withPad } from '../../support/pad-perf.js';
import { count, mean } from '../../support/pad-scenarios.js';

const MANUAL_TEST_ID = 'PAD-020' as const;
const RUNS = count(3, 1);
const CYCLES = count(20, 6);
const GROUP = count(5, 2);

test.describe('PAD — Performance & Asset Diagnostics', () => {
  requireCapabilities('menu');

  test(`${MANUAL_TEST_ID} resources after repeated menu use`, async ({ sgapSession, sgapDriver, page }, testInfo) => {
    test.setTimeout(RUNS * CYCLES * 90_000);
    await withPad({ sgapSession, sgapDriver, page }, testInfo, MANUAL_TEST_ID, async (ctx) => {
      for (let run = 1; run <= RUNS; run += 1) {
        await settle(ctx);
        const heap: number[] = [];
        const objects: number[] = [];
        for (let cycle = 1; cycle <= CYCLES; cycle += 1) {
          ctx.perf.setStatus(`run ${run} · menu cycle ${cycle}/${CYCLES}`);
          await sgapSession.menu.open({ timeoutMs: 15_000 });
          await page.waitForTimeout(800);
          await sgapSession.menu.close({ timeoutMs: 15_000 });
          const closedAt = Date.now();
          await page.waitForTimeout(2_000);
          await ctx.perf.currentActivity();
          const samples = ctx.perf.activityIn(closedAt, Date.now()).map((s) => s.value.objects);
          objects.push(samples.length > 0 ? Math.min(...samples) : Number.NaN);
          heap.push((await ctx.perf.heapAfterGcMb()) ?? Number.NaN);
        }
        const heapFirst = mean(heap.slice(0, GROUP));
        const heapLast = mean(heap.slice(-GROUP));
        const objFirst = Math.max(...objects.slice(0, GROUP));
        const objLast = Math.min(...objects.slice(-GROUP));
        annotate(testInfo, `run ${run}`, `heap ${heapFirst.toFixed(1)} → ${heapLast.toFixed(1)} MB; display objects ${objFirst} → ${objLast} over ${CYCLES} cycles (per cycle: ${objects.join(', ')})`);
        expect(Number.isFinite(heapFirst), 'heap after GC (CDP)').toBe(true);
        expect.soft(heapLast, `run ${run}: heap per cycle`).toBeLessThanOrEqual(heapFirst * 1.05);
        expect.soft(objLast, `run ${run}: display objects per cycle`).toBeLessThanOrEqual(objFirst);
      }
    });
  });
});
