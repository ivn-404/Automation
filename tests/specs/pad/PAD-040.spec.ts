/**
 * PAD-040 — Chrome vs Edge. Run once per browser (PAD Tester "Browser" option; Edge uses the
 * installed msedge channel). Each run stores its profile per browser and build; it is compared
 * with the same browser's previous run (≤ 10% worse), and the difference to the other browser's
 * latest run on the same build is documented.
 */

import { test, expect } from '../../fixtures/index.js';
import { annotate, withPad } from '../../support/pad-perf.js';
import { browserLabel, compareLines, gameBuild, measureProfile, regressions } from '../../support/pad-scenarios.js';
import { appendBaseline, latestBaseline } from '../../../src/perf/index.js';

const MANUAL_TEST_ID = 'PAD-040' as const;

test.describe('PAD — Performance & Asset Diagnostics', () => {
  test(`${MANUAL_TEST_ID} chrome vs edge`, async ({ sgapSession, sgapDriver, page }, testInfo) => {
    test.setTimeout(15 * 60_000);
    await withPad({ sgapSession, sgapDriver, page }, testInfo, MANUAL_TEST_ID, async (ctx, windows) => {
      const build = await gameBuild(ctx);
      const browser = await browserLabel(ctx);
      const family = browser.split(' ')[0]!;
      const gameId = sgapSession.manifest.gameId;
      const { metrics, windows: profile } = await measureProfile(ctx, browser);
      windows.push(...profile);
      const own = latestBaseline(gameId, MANUAL_TEST_ID, (e) => e.browser.split(' ')[0] === family);
      const other = latestBaseline(gameId, MANUAL_TEST_ID, (e) => e.browser.split(' ')[0] !== family && e.build === build);
      appendBaseline(gameId, { caseId: MANUAL_TEST_ID, build, browser, metrics });
      annotate(testInfo, 'browser', `${browser}, build ${build}`);
      if (other !== undefined) {
        annotate(testInfo, 'vs other browser', `${other.browser} (${other.at}) → ${browser}: ${compareLines(metrics, other.metrics)}`);
      } else {
        annotate(testInfo, 'vs other browser', 'No run of the other browser on this build yet: run PAD-040 again with the other browser selected');
      }
      if (own === undefined) {
        annotate(testInfo, 'baseline', `First ${family} run: recorded as its baseline`);
        return;
      }
      annotate(testInfo, 'vs own baseline', `${own.browser} (${own.at}): ${compareLines(metrics, own.metrics)}`);
      expect.soft(regressions(metrics, own.metrics), `worse than the previous ${family} run by more than 10%`).toEqual([]);
    });
  });
});
