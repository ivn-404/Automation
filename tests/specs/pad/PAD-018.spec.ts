/**
 * PAD-018 — Resources after repeated reloads (5 reloads in the same tab, 3 runs). After each
 * reload: base game ready, 3 s settle, heap after forced GC and texture count.
 * Expected: after reload 5 ≤ after reload 1 + 5%.
 */

import { test, expect } from '../../fixtures/index.js';
import { annotate, reloadGame, settle, withPad } from '../../support/pad-perf.js';
import { count, textureCount } from '../../support/pad-scenarios.js';

const MANUAL_TEST_ID = 'PAD-018' as const;
const RUNS = count(3, 1);
const RELOADS = count(5, 3);

test.describe('PAD — Performance & Asset Diagnostics', () => {
  test(`${MANUAL_TEST_ID} resources after repeated reloads`, async ({ sgapSession, sgapDriver, page }, testInfo) => {
    test.setTimeout(RUNS * RELOADS * 3 * 60_000);
    await withPad({ sgapSession, sgapDriver, page }, testInfo, MANUAL_TEST_ID, async (ctx) => {
      for (let run = 1; run <= RUNS; run += 1) {
        const readings: { heap?: number; textures?: number }[] = [];
        for (let reload = 1; reload <= RELOADS; reload += 1) {
          const loadMs = await reloadGame(ctx);
          await settle(ctx);
          await page.waitForTimeout(3_000);
          const heap = await ctx.perf.heapAfterGcMb();
          const textures = await textureCount(ctx);
          readings.push({ heap, textures });
          annotate(testInfo, `run ${run} reload ${reload}`, `load ${loadMs} ms; heap ${heap ?? '?'} MB; textures ${textures ?? '?'}`);
        }
        const first = readings[0]!;
        const last = readings[readings.length - 1]!;
        expect(first.heap, 'heap after GC (CDP)').toBeDefined();
        expect.soft(last.heap!, `run ${run}: heap after reload ${RELOADS} vs reload 1 (${first.heap} MB)`).toBeLessThanOrEqual(first.heap! * 1.05);
        if (first.textures !== undefined && last.textures !== undefined) {
          expect.soft(last.textures, `run ${run}: textures after reload ${RELOADS} vs reload 1`).toBeLessThanOrEqual(Math.ceil(first.textures * 1.05));
        }
      }
    });
  });
});
