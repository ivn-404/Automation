/**
 * PAD-039 — Current build vs previous build. Runs the compact profile (20 s idle, 5 spins, one
 * bought bonus) and stores it per build in `perf-baselines/<gameId>.json`. The build label is
 * `SGAP_GAME_BUILD`, else a version field from `/initialize`, else Phaser's game config.
 * Expected: no metric worse than the latest different build (same browser) by more than 10%
 * (the run-to-run noise PAD-041 measures). The first build seen only records its baseline.
 */

import { test, expect } from '../../fixtures/index.js';
import { annotate, withPad } from '../../support/pad-perf.js';
import { browserLabel, compareLines, gameBuild, measureProfile, regressions } from '../../support/pad-scenarios.js';
import { appendBaseline, latestBaseline } from '../../../src/perf/index.js';

const MANUAL_TEST_ID = 'PAD-039' as const;

test.describe('PAD — Performance & Asset Diagnostics', () => {
  test(`${MANUAL_TEST_ID} current build vs previous build`, async ({ sgapSession, sgapDriver, page }, testInfo) => {
    test.setTimeout(15 * 60_000);
    await withPad({ sgapSession, sgapDriver, page }, testInfo, MANUAL_TEST_ID, async (ctx, windows) => {
      const build = await gameBuild(ctx);
      const browser = await browserLabel(ctx);
      const gameId = sgapSession.manifest.gameId;
      const { metrics, windows: profile } = await measureProfile(ctx, `build ${build}`);
      windows.push(...profile);
      const previous = latestBaseline(gameId, MANUAL_TEST_ID, (e) => e.build !== build && e.browser === browser);
      appendBaseline(gameId, { caseId: MANUAL_TEST_ID, build, browser, metrics });
      if (build === 'unknown') {
        annotate(testInfo, 'build', 'Build label unknown: set SGAP_GAME_BUILD so builds can be told apart');
      }
      if (previous === undefined) {
        annotate(testInfo, 'baseline', `No earlier build on ${browser}; recorded build ${build}: ${compareLines(metrics, {})}`);
        return;
      }
      const worse = regressions(metrics, previous.metrics);
      annotate(testInfo, 'compare', `build ${previous.build} (${previous.at}) → ${build}: ${compareLines(metrics, previous.metrics)}`);
      expect.soft(worse, `metrics worse than build ${previous.build} by more than 10%`).toEqual([]);
    });
  });
});
