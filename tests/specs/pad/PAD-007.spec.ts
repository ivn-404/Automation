/**
 * PAD-007 — FPS during Big Win / coin animations. Base spins until 5 wins of at least the big-win
 * multiple (manifest `metadata.bigWinMultiplier`, default 10× stake) or the spin budget runs out.
 * Hybrid: QA confirms the celebration looks right on the game window.
 * Expected: pass band; no hitch over 100 ms in a qualifying window.
 */

import { test, expect } from '../../fixtures/index.js';
import { annotate, bandOutcome, measureSpin, withPad } from '../../support/pad-perf.js';
import { betFeatures, bigWinThreshold, count } from '../../support/pad-scenarios.js';
import type { PerfWindow } from '../../../src/perf/index.js';

const MANUAL_TEST_ID = 'PAD-007' as const;
const WANTED = count(5, 1);
const MAX_SPINS = count(80, 15);

test.describe('PAD — Performance & Asset Diagnostics', () => {
  test(`${MANUAL_TEST_ID} FPS during big win animations`, async ({ sgapSession, sgapDriver, page }, testInfo) => {
    test.setTimeout(MAX_SPINS * 60_000);
    const qualifying: PerfWindow[] = [];
    let threshold = 10;
    await withPad({ sgapSession, sgapDriver, page }, testInfo, MANUAL_TEST_ID, async (ctx, windows) => {
      threshold = bigWinThreshold(ctx);
      for (let i = 1; i <= MAX_SPINS && qualifying.length < WANTED; i += 1) {
        const w = await measureSpin(ctx, `spin ${i}`, { maxMs: 45_000 });
        const features = betFeatures(ctx, ctx.state.betBody);
        if (features.winX >= threshold) {
          qualifying.push(w);
          windows.push(w);
          annotate(testInfo, `big win ${qualifying.length}`, `${w.label}: ${features.winX}× stake; ${bandOutcome(w.stats.avgFps, w.stats.low1Fps).text}; max frame ${w.stats.maxMs} ms`);
        }
      }
    });
    test.skip(qualifying.length === 0, `No win ≥ ${threshold}× stake in ${MAX_SPINS} spins`);
    annotate(testInfo, 'qa-check', 'Big-win and coin animations play cleanly: confirm on the game window');
    if (qualifying.length < WANTED) annotate(testInfo, 'partial', `${qualifying.length}/${WANTED} qualifying wins found`);
    for (const w of qualifying) {
      const outcome = bandOutcome(w.stats.avgFps, w.stats.low1Fps);
      expect.soft(outcome.verdict, `${w.label}: ${outcome.text}`).not.toBe('fail');
      expect.soft(w.hitches.length, `${w.label}: hitches over 100 ms`).toBe(0);
    }
  });
});
