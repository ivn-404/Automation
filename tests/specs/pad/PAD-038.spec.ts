/**
 * PAD-038 — Tab hidden then shown again (3 runs). The browser window is minimised for 30 s (the
 * page is hidden and stops drawing), restored, then 3 spins are played.
 * Expected: frames resume; FPS back to the idle baseline within 2 s; spins in pass band and each
 * one returns to idle (no stuck animation).
 */

import { test, expect } from '../../fixtures/index.js';
import { annotate, bandOutcome, measureIdle, measureSpin, settle, withPad } from '../../support/pad-perf.js';
import { count, hideWindow, timeToBaselineMs } from '../../support/pad-scenarios.js';

const MANUAL_TEST_ID = 'PAD-038' as const;
const RUNS = count(3, 1);
const HIDDEN_MS = count(30_000, 8_000);
const RECOVERY_LIMIT_MS = 2_000;

test.describe('PAD — Performance & Asset Diagnostics', () => {
  test(`${MANUAL_TEST_ID} tab hidden then shown again`, async ({ sgapSession, sgapDriver, page }, testInfo) => {
    test.setTimeout(RUNS * 5 * 60_000);
    await withPad({ sgapSession, sgapDriver, page }, testInfo, MANUAL_TEST_ID, async (ctx, windows) => {
      await settle(ctx);
      const baseline = await measureIdle(ctx, 'idle baseline', 10_000);
      windows.push(baseline);
      for (let run = 1; run <= RUNS; run += 1) {
        const { shownAt, wasHidden } = await hideWindow(ctx, HIDDEN_MS);
        await page.waitForTimeout(5_000);
        await ctx.perf.pull();
        const after = ctx.perf.windowBetween(`run ${run} after show`, shownAt, Date.now());
        windows.push(after);
        const recovery = timeToBaselineMs(ctx, shownAt, after.endedAt, baseline.stats.avgFps);
        annotate(testInfo, `run ${run}`, `page hidden while minimised: ${wasHidden}; ${after.stats.frames} frames in 5 s after restore; FPS back to ${baseline.stats.avgFps} after ${recovery ?? 'never'} ms`);
        expect.soft(after.stats.frames, `run ${run}: frames resume after restore`).toBeGreaterThan(0);
        expect.soft(recovery ?? Number.POSITIVE_INFINITY, `run ${run}: recovery`).toBeLessThanOrEqual(RECOVERY_LIMIT_MS);
        for (let i = 1; i <= 3; i += 1) {
          const w = await measureSpin(ctx, `run ${run} spin ${i}`);
          windows.push(w);
          const outcome = bandOutcome(w.stats.avgFps, w.stats.low1Fps);
          expect.soft(outcome.verdict, `${w.label}: ${outcome.text}`).not.toBe('fail');
          expect.soft(w.meta?.endReason, `${w.label}: animation returned to idle`).toBe('quiet');
        }
      }
    });
  });
});
