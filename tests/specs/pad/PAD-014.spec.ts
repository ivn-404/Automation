/**
 * PAD-014 — CPU use during consecutive spins (20 spins, 3 runs). Busy % is sampled once a second
 * inside each spin window. Expected: never 3 s in a row above 80% busy; no long task over 200 ms.
 */

import { test, expect } from '../../fixtures/index.js';
import { annotate, measureSpin, withPad } from '../../support/pad-perf.js';
import { count } from '../../support/pad-scenarios.js';

const MANUAL_TEST_ID = 'PAD-014' as const;
const RUNS = count(3, 1);
const SPINS = count(20, 5);
const BUSY_LIMIT = 80;
const SUSTAINED_SAMPLES = 3;
const LONG_TASK_LIMIT_MS = 200;

test.describe('PAD — Performance & Asset Diagnostics', () => {
  test(`${MANUAL_TEST_ID} CPU use during consecutive spins`, async ({ sgapSession, sgapDriver, page }, testInfo) => {
    test.setTimeout(RUNS * SPINS * 60_000);
    await withPad({ sgapSession, sgapDriver, page }, testInfo, MANUAL_TEST_ID, async (ctx, windows) => {
      expect(await ctx.perf.enableCpu(), 'CDP Performance metrics on the game frame').toBe(true);
      for (let run = 1; run <= RUNS; run += 1) {
        let worstStreak = 0;
        let peak = 0;
        let maxTask = 0;
        for (let i = 1; i <= SPINS; i += 1) {
          const w = await measureSpin(ctx, `run ${run} spin ${i}/${SPINS}`);
          windows.push(w);
          let streak = 0;
          for (const sample of ctx.perf.cpuSeries(w.startedAt, w.endedAt)) {
            peak = Math.max(peak, sample.busyPct);
            streak = sample.busyPct > BUSY_LIMIT ? streak + 1 : 0;
            worstStreak = Math.max(worstStreak, streak);
          }
          maxTask = Math.max(maxTask, w.longTasks.maxMs);
        }
        const runWindows = windows.slice(-SPINS);
        const meanBusy = runWindows.reduce((n, w) => n + (w.cpuBusyPct ?? 0), 0) / runWindows.length;
        annotate(testInfo, `run ${run}`, `mean busy ${meanBusy.toFixed(1)}%, peak 1 s ${peak}%, longest run over ${BUSY_LIMIT}% ${worstStreak} s, longest task ${maxTask} ms`);
        expect.soft(worstStreak, `run ${run}: seconds in a row above ${BUSY_LIMIT}% busy`).toBeLessThan(SUSTAINED_SAMPLES);
        expect.soft(maxTask, `run ${run}: longest main-thread task`).toBeLessThanOrEqual(LONG_TASK_LIMIT_MS);
      }
    });
  });
});
