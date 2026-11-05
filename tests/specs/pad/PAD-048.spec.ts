/**
 * PAD-048 — Recovery after a complex sequence (5 runs): a bought bonus, then 10 s idle.
 * Same check as PAD-021 with a 10 s window; kept for traceability.
 * Expected: FPS within 3 of the idle baseline within 5 s.
 */

import { test, expect } from '../../fixtures/index.js';
import { requireCapabilities } from '../../support/capabilities.js';
import { annotate, measureIdle, settle, withPad } from '../../support/pad-perf.js';
import { count, playBoughtRound, timeToBaselineMs } from '../../support/pad-scenarios.js';

const MANUAL_TEST_ID = 'PAD-048' as const;
const RUNS = count(5, 1);
const RECOVERY_LIMIT_MS = 5_000;

test.describe('PAD — Performance & Asset Diagnostics', () => {
  requireCapabilities('buyFeature');

  test(`${MANUAL_TEST_ID} recovery after a complex sequence`, async ({ sgapSession, sgapDriver, page }, testInfo) => {
    test.setTimeout(RUNS * 5 * 60_000);
    await withPad({ sgapSession, sgapDriver, page }, testInfo, MANUAL_TEST_ID, async (ctx, windows) => {
      await settle(ctx);
      const baseline = await measureIdle(ctx, 'idle baseline', 10_000);
      windows.push(baseline);
      for (let run = 1; run <= RUNS; run += 1) {
        windows.push((await playBoughtRound(ctx, `bonus ${run}/${RUNS}`)).window);
        const idle = await measureIdle(ctx, `after bonus ${run}`, 10_000);
        windows.push(idle);
        const back = timeToBaselineMs(ctx, idle.startedAt, idle.endedAt, baseline.stats.avgFps);
        annotate(testInfo, `run ${run}`, `FPS back to ${baseline.stats.avgFps} after ${back ?? 'never'} ms`);
        expect.soft(back ?? Number.POSITIVE_INFINITY, `run ${run}: recovery`).toBeLessThanOrEqual(RECOVERY_LIMIT_MS);
      }
    });
  });
});
