/**
 * PAD-021 — Recovery to idle after animations: a bought bonus round, then 30 s idle (5 runs).
 * Baselines come from a 15 s idle window at the start of the test (FPS and CPU busy %).
 * Expected: FPS within 3 of the idle baseline and CPU within 5 points of it, both within 5 s.
 */

import { test, expect } from '../../fixtures/index.js';
import { requireCapabilities } from '../../support/capabilities.js';
import { annotate, measureIdle, settle, withPad } from '../../support/pad-perf.js';
import { count, playBoughtRound, timeToBaselineMs } from '../../support/pad-scenarios.js';

const MANUAL_TEST_ID = 'PAD-021' as const;
const RUNS = count(5, 1);
const IDLE_AFTER_MS = 30_000;
const RECOVERY_LIMIT_MS = 5_000;

test.describe('PAD — Performance & Asset Diagnostics', () => {
  requireCapabilities('buyFeature');

  test(`${MANUAL_TEST_ID} recovery to idle after animations`, async ({ sgapSession, sgapDriver, page }, testInfo) => {
    test.setTimeout(RUNS * 6 * 60_000);
    await withPad({ sgapSession, sgapDriver, page }, testInfo, MANUAL_TEST_ID, async (ctx, windows) => {
      expect(await ctx.perf.enableCpu(), 'CDP Performance metrics on the game frame').toBe(true);
      await settle(ctx);
      const baseline = await measureIdle(ctx, 'idle baseline', 15_000);
      windows.push(baseline);
      const baseBusy = baseline.cpuBusyPct ?? Number.NaN;
      for (let run = 1; run <= RUNS; run += 1) {
        const round = await playBoughtRound(ctx, `bonus ${run}/${RUNS}`);
        windows.push(round.window);
        const idle = await measureIdle(ctx, `after bonus ${run}`, IDLE_AFTER_MS);
        windows.push(idle);
        const fpsBack = timeToBaselineMs(ctx, idle.startedAt, idle.endedAt, baseline.stats.avgFps);
        const cpuBack = ctx.perf.cpuSeries(idle.startedAt, idle.endedAt).find((s) => s.busyPct <= baseBusy + 5);
        const cpuMs = cpuBack === undefined ? undefined : cpuBack.at - idle.startedAt;
        annotate(testInfo, `run ${run}`, `FPS back to ${baseline.stats.avgFps} after ${fpsBack ?? 'never'} ms; CPU back to ${baseBusy}% (+5) after ${cpuMs ?? 'never'} ms`);
        expect.soft(fpsBack ?? Number.POSITIVE_INFINITY, `run ${run}: FPS recovery`).toBeLessThanOrEqual(RECOVERY_LIMIT_MS);
        expect.soft(cpuMs ?? Number.POSITIVE_INFINITY, `run ${run}: CPU recovery`).toBeLessThanOrEqual(RECOVERY_LIMIT_MS);
      }
    });
  });
});
