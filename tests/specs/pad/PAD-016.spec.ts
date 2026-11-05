/**
 * PAD-016 — JS heap during continuous gameplay (100 spins, 3 runs) via normal-speed autoplay
 * batches. Heap is read after a forced GC (CDP) at spin 20 and at spin 100.
 * Expected: heap at spin 100 ≤ heap at spin 20 + 10%.
 */

import { test, expect } from '../../fixtures/index.js';
import { requireCapabilities } from '../../support/capabilities.js';
import { annotate, withPad } from '../../support/pad-perf.js';
import { count, measureAutoplayBatch } from '../../support/pad-scenarios.js';

const MANUAL_TEST_ID = 'PAD-016' as const;
const RUNS = count(3, 1);
const EARLY_SPINS = count(20, 10);
const TOTAL_SPINS = count(100, 30);

test.describe('PAD — Performance & Asset Diagnostics', () => {
  requireCapabilities('autoplay');

  test(`${MANUAL_TEST_ID} JS heap during continuous gameplay`, async ({ sgapSession, sgapDriver, page }, testInfo) => {
    test.setTimeout(RUNS * TOTAL_SPINS * 20_000 + 10 * 60_000);
    await withPad({ sgapSession, sgapDriver, page }, testInfo, MANUAL_TEST_ID, async (ctx, windows) => {
      for (let run = 1; run <= RUNS; run += 1) {
        let spins = 0;
        let early: number | undefined;
        let late: number | undefined;
        let batch = 0;
        while (spins < TOTAL_SPINS) {
          batch += 1;
          const { window, betTimes } = await measureAutoplayBatch(ctx, `run ${run} batch ${batch}`);
          windows.push(window);
          if (betTimes.length === 0) throw new Error(`run ${run} batch ${batch}: autoplay produced no /bet`);
          spins += betTimes.length;
          if (early === undefined && spins >= EARLY_SPINS) early = await ctx.perf.heapAfterGcMb();
        }
        late = await ctx.perf.heapAfterGcMb();
        annotate(testInfo, `run ${run}`, `heap after GC: ${early ?? 'n/a'} MB at spin ${EARLY_SPINS} → ${late ?? 'n/a'} MB at spin ${spins}`);
        expect(early, 'heap after GC (CDP)').toBeDefined();
        expect.soft(late!, `run ${run}: heap growth from spin ${EARLY_SPINS}`).toBeLessThanOrEqual(early! * 1.1);
      }
    });
  });
});
