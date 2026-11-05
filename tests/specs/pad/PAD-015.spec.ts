/**
 * PAD-015 — GPU load during complex animations (bought bonus rounds). Chrome gives no GPU
 * utilisation %, so each slow frame (> 33.3 ms) is classified by what overlapped it: a long task
 * on the game's main thread means CPU-bound; none means GPU / compositor-bound. Texture memory
 * (RGBA estimate) is reported, and the first 8 s of one extra unscored bonus entry are captured as
 * a Chrome trace for QA.
 * Expected: no hitch (> 100 ms) without a main-thread cause.
 */

import { test, expect } from '../../fixtures/index.js';
import { requireCapabilities } from '../../support/capabilities.js';
import { buyFeatureForBet } from '../../support/canvas-bet-flow.js';
import { drainFreeSpins } from '../../support/free-spin-flow.js';
import { annotate, settle, withPad } from '../../support/pad-perf.js';
import { count, playBoughtRound, renderInfo } from '../../support/pad-scenarios.js';
import type { PerfWindow } from '../../../src/perf/index.js';

const MANUAL_TEST_ID = 'PAD-015' as const;
const ROUNDS = count(5, 1);
/** A whole bonus round traced exceeds what Playwright can return; the entry is the busiest part. */
const TRACE_MS = 8_000;
const TRACE_CATEGORIES = ['gpu', 'viz', 'cc', 'devtools.timeline'];

function classify(w: PerfWindow): { gpu: number; cpu: number; gpuHitches: number } {
  let gpu = 0;
  let cpu = 0;
  let gpuHitches = 0;
  for (const frame of w.slowFrames) {
    const start = frame.offsetMs;
    const end = frame.offsetMs + frame.ms;
    const mainThread = w.longTaskList.some((task) => task.offsetMs < end && task.offsetMs + task.ms > start);
    if (mainThread) cpu += 1;
    else {
      gpu += 1;
      if (frame.ms > 100) gpuHitches += 1;
    }
  }
  return { gpu, cpu, gpuHitches };
}

test.describe('PAD — Performance & Asset Diagnostics', () => {
  requireCapabilities('buyFeature');

  test(`${MANUAL_TEST_ID} GPU load during complex animations`, async ({ sgapSession, sgapDriver, page }, testInfo) => {
    test.setTimeout((ROUNDS + 1) * 5 * 60_000);
    await withPad({ sgapSession, sgapDriver, page }, testInfo, MANUAL_TEST_ID, async (ctx, windows) => {
      const info = await renderInfo(ctx);
      const textureMb = (info?.textures ?? []).reduce((n, t) => n + t.width * t.height * 4, 0) / (1024 * 1024);
      annotate(testInfo, 'textures', `${info?.textures.length ?? 0} textures, ~${textureMb.toFixed(1)} MB as RGBA (${info?.renderer ?? 'unknown'} renderer)`);
      for (let round = 1; round <= ROUNDS; round += 1) {
        const { window } = await playBoughtRound(ctx, `bonus ${round}/${ROUNDS}`);
        windows.push(window);
        const c = classify(window);
        annotate(testInfo, window.label, `slow frames: ${c.cpu} with a main-thread long task, ${c.gpu} without (GPU/compositor); GPU-side hitches ${c.gpuHitches}`);
        expect.soft(c.gpuHitches, `${window.label}: hitches with no main-thread cause`).toBe(0);
      }

      const browser = page.context().browser();
      if (browser !== null) {
        await settle(ctx);
        await browser.startTracing(page, { categories: TRACE_CATEGORIES });
        let tracing = true;
        const stop = async (): Promise<void> => {
          if (!tracing) return;
          tracing = false;
          const trace = await browser.stopTracing().catch((error: unknown) => {
            annotate(testInfo, 'trace', `Chrome trace not saved: ${error instanceof Error ? error.message : String(error)}`);
            return undefined;
          });
          if (trace !== undefined) {
            await testInfo.attach('pad-015-trace.json', { body: trace, contentType: 'application/json' });
            annotate(testInfo, 'qa-check', 'Open pad-015-trace.json in Perfetto / DevTools Performance to inspect GPU tasks in the slow frames');
          }
        };
        try {
          const buy = await buyFeatureForBet(sgapSession, sgapDriver, page, { settleAfter: false });
          await page.waitForTimeout(TRACE_MS);
          await stop();
          await drainFreeSpins(sgapSession, sgapDriver, page, buy.raw);
        } finally {
          await stop();
        }
      }
    });
  });
});
