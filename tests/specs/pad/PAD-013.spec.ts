/**
 * PAD-013 — CPU use while idle (3 × 60 s). Main-thread busy % is CDP TaskDuration of the game
 * frame's renderer over wall time. The first run on a game/browser records the baseline in
 * `perf-baselines/<gameId>.json`; later runs must stay within baseline + 5 points.
 */

import { test, expect } from '../../fixtures/index.js';
import { annotate, measureIdle, settle, withPad } from '../../support/pad-perf.js';
import { browserLabel, count, gameBuild, median } from '../../support/pad-scenarios.js';
import { appendBaseline, latestBaseline } from '../../../src/perf/index.js';

const MANUAL_TEST_ID = 'PAD-013' as const;
const RUNS = count(3, 1);
const IDLE_MS = count(60_000, 15_000);
const ALLOWED_POINTS = 5;

test.describe('PAD — Performance & Asset Diagnostics', () => {
  test(`${MANUAL_TEST_ID} CPU use while idle`, async ({ sgapSession, sgapDriver, page }, testInfo) => {
    test.setTimeout(RUNS * (IDLE_MS + 90_000) + 120_000);
    await withPad({ sgapSession, sgapDriver, page }, testInfo, MANUAL_TEST_ID, async (ctx, windows) => {
      expect(await ctx.perf.enableCpu(), 'CDP Performance metrics on the game frame').toBe(true);
      const busy: number[] = [];
      for (let run = 1; run <= RUNS; run += 1) {
        await settle(ctx);
        const w = await measureIdle(ctx, `idle ${run}/${RUNS}`, IDLE_MS);
        windows.push(w);
        if (w.cpuBusyPct !== undefined) busy.push(w.cpuBusyPct);
        annotate(testInfo, w.label, `main thread busy ${w.cpuBusyPct ?? 'n/a'}%; avg ${w.stats.avgFps} FPS`);
      }
      expect(busy.length, 'CPU samples in every idle window').toBe(RUNS);
      const current = median(busy);
      const browser = await browserLabel(ctx);
      const build = await gameBuild(ctx);
      const gameId = sgapSession.manifest.gameId;
      const baseline = latestBaseline(gameId, MANUAL_TEST_ID, (entry) => entry.browser === browser);
      if (baseline === undefined) {
        appendBaseline(gameId, { caseId: MANUAL_TEST_ID, build, browser, metrics: { idleBusyPct: current } });
        annotate(testInfo, 'baseline', `No idle CPU baseline for ${browser}: recorded ${current}% (build ${build})`);
        return;
      }
      const limit = (baseline.metrics.idleBusyPct ?? Number.NaN) + ALLOWED_POINTS;
      annotate(testInfo, 'compare', `idle busy ${current}% vs baseline ${baseline.metrics.idleBusyPct}% (${baseline.at}, build ${baseline.build}); limit ${limit}%`);
      expect.soft(current, 'idle main-thread busy % vs baseline + 5').toBeLessThanOrEqual(limit);
    });
  });
});
