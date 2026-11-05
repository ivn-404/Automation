/**
 * PAD-003 — FPS during normal reel spins (10 spins, click → round complete).
 * Expected: pass band on the pooled average and on every spin's 1% low.
 */

import { test, expect } from '../../fixtures/index.js';
import {
  annotate,
  attachWindows,
  bandOutcome,
  measureSpin,
  pooled,
  startPad,
} from '../../support/pad-perf.js';
import type { PerfWindow } from '../../../src/perf/index.js';

const MANUAL_TEST_ID = 'PAD-003' as const;
const SPINS = 10;

test.describe('PAD — Performance & Asset Diagnostics', () => {
  test(`${MANUAL_TEST_ID} FPS during normal reel spins`, async ({ sgapSession, sgapDriver, page }, testInfo) => {
    test.setTimeout(15 * 60_000);
    const ctx = await startPad(sgapSession, sgapDriver, page, testInfo, MANUAL_TEST_ID);
    const windows: PerfWindow[] = [];
    try {
      for (let i = 1; i <= SPINS; i += 1) {
        windows.push(await measureSpin(ctx, `spin ${i}/${SPINS}`));
      }
    } finally {
      await ctx.perf.stop();
      await attachWindows(testInfo, 'pad-003-spins', windows);
    }

    const all = pooled(windows);
    const outcome = bandOutcome(all.avgFps, all.low1Fps);
    annotate(testInfo, 'spins', `${SPINS} spins: ${outcome.text}; worst P95 ${all.p95Ms} ms; hitches ${all.hitches}`);
    expect(windows.length).toBe(SPINS);
    expect.soft(outcome.verdict, `pooled spins: ${outcome.text}`).not.toBe('fail');
    for (const w of windows) {
      const one = bandOutcome(w.stats.avgFps, w.stats.low1Fps);
      expect.soft(one.verdict, `${w.label}: ${one.text}`).not.toBe('fail');
    }
  });
});
