/**
 * PAD-052 — Scratch card: open → buy card → scratch all → close (3 runs).
 * Hybrid: QA confirms the scratch reveal looks right. Expected: pass band; no hitch over 100 ms.
 */

import { test, expect } from '../../fixtures/index.js';
import { requireCapabilities } from '../../support/capabilities.js';
import { annotate, bandOutcome, withPad } from '../../support/pad-perf.js';
import { count } from '../../support/pad-scenarios.js';
import { buyAndScratchAll, enterScratchHud } from '../../support/scratch-flow.js';

const MANUAL_TEST_ID = 'PAD-052' as const;
const RUNS = count(3, 1);

test.describe('PAD — Performance & Asset Diagnostics', () => {
  requireCapabilities('scratchCard');

  test(`${MANUAL_TEST_ID} scratch card`, async ({ sgapSession, sgapDriver, page }, testInfo) => {
    test.setTimeout(RUNS * 3 * 60_000);
    const scratch = sgapSession.scratchCard;
    test.skip(!(await scratch.isAvailable()), `${sgapSession.manifest.gameId} has no scratchCard config`);
    await withPad({ sgapSession, sgapDriver, page }, testInfo, MANUAL_TEST_ID, async (ctx, windows) => {
      await enterScratchHud(page, sgapDriver);
      for (let run = 1; run <= RUNS; run += 1) {
        const token = ctx.perf.begin(`scratch ${run}/${RUNS}`);
        ctx.perf.mark('scratch', 'open');
        await scratch.open();
        const { settled } = await buyAndScratchAll(scratch);
        ctx.perf.mark('scratch', 'close');
        await scratch.close();
        await page.waitForTimeout(1_500);
        const w = await ctx.perf.end(token, { kind: 'scratch', message: settled.message });
        windows.push(w);
        const outcome = bandOutcome(w.stats.avgFps, w.stats.low1Fps);
        annotate(testInfo, w.label, `${outcome.text}; hitches ${w.hitches.length}; round "${settled.message}"`);
        expect.soft(outcome.verdict, `${w.label}: ${outcome.text}`).not.toBe('fail');
        expect.soft(w.hitches.length, `${w.label}: hitches over 100 ms`).toBe(0);
      }
      annotate(testInfo, 'qa-check', 'Scratch reveal animation looks right: confirm on the game window');
    });
  });
});
