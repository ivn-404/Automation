/**
 * PAD-001 — FPS while the game is idle for 60 s (3 runs).
 * Expected: pass band (≥ 40 avg and 1% low), no hitches. Becomes the idle baseline.
 */

import { test, expect } from '../../fixtures/index.js';
import {
  annotate,
  attachWindows,
  bandOutcome,
  measureIdle,
  settle,
  startPad,
} from '../../support/pad-perf.js';
import type { PerfWindow } from '../../../src/perf/index.js';

const MANUAL_TEST_ID = 'PAD-001' as const;
const RUNS = 3;
const IDLE_MS = 60_000;

test.describe('PAD — Performance & Asset Diagnostics', () => {
  test(`${MANUAL_TEST_ID} idle FPS for 60 s`, async ({ sgapSession, sgapDriver, page }, testInfo) => {
    test.setTimeout(10 * 60_000);
    const ctx = await startPad(sgapSession, sgapDriver, page, testInfo, MANUAL_TEST_ID);
    const windows: PerfWindow[] = [];
    try {
      await settle(ctx);
      await page.waitForTimeout(2_000);
      for (let run = 1; run <= RUNS; run += 1) {
        windows.push(await measureIdle(ctx, `${MANUAL_TEST_ID} idle ${run}/${RUNS}`, IDLE_MS));
      }
    } finally {
      await ctx.perf.stop();
      await attachWindows(testInfo, 'pad-001-idle', windows);
    }

    for (const w of windows) {
      const outcome = bandOutcome(w.stats.avgFps, w.stats.low1Fps);
      annotate(testInfo, outcome.verdict === 'pass' ? 'band' : `band-${outcome.verdict}`, `${w.label}: ${outcome.text}`);
      expect.soft(outcome.verdict, `${w.label}: ${outcome.text}`).not.toBe('fail');
      expect.soft(w.hitches.length, `${w.label}: hitches (> 100 ms) while idle`).toBe(0);
    }
  });
});
