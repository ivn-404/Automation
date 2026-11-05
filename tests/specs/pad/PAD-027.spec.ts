/**
 * PAD-027 — Asset loading on entering the bonus (5 bought rounds). Hitches (> 100 ms) in the
 * Normal → Bonus transition (first 6 s after the buy response) are checked against game
 * downloads that arrived within them. Expected: no download inside a hitch.
 */

import { test, expect } from '../../fixtures/index.js';
import { requireCapabilities } from '../../support/capabilities.js';
import { annotate, withPad } from '../../support/pad-perf.js';
import { count, downloadsInSlowFrames, playBoughtRound, startAssetAudit } from '../../support/pad-scenarios.js';
import { HITCH_MS } from '../../../src/perf/index.js';

const MANUAL_TEST_ID = 'PAD-027' as const;
const ROUNDS = count(5, 1);

test.describe('PAD — Performance & Asset Diagnostics', () => {
  requireCapabilities('buyFeature');

  test(`${MANUAL_TEST_ID} asset loading on entering the bonus`, async ({ sgapSession, sgapDriver, page }, testInfo) => {
    test.setTimeout(ROUNDS * 5 * 60_000);
    await withPad({ sgapSession, sgapDriver, page }, testInfo, MANUAL_TEST_ID, async (ctx, windows) => {
      const audit = startAssetAudit(ctx);
      try {
        for (let round = 1; round <= ROUNDS; round += 1) {
          audit.reset();
          const { transitionIn } = await playBoughtRound(ctx, `bonus ${round}/${ROUNDS}`);
          windows.push(transitionIn);
          const report = await audit.report((r) => r.at >= transitionIn.startedAt && r.at <= transitionIn.endedAt);
          const hits = downloadsInSlowFrames(transitionIn, report.records, HITCH_MS);
          annotate(testInfo, transitionIn.label, `${report.total} downloads entering the bonus (${report.cache.misses} from network); ${transitionIn.hitches.length} hitches; ${hits.length} overlap${hits.length > 0 ? `: ${hits.join('; ')}` : ''}`);
          expect.soft(hits, `${transitionIn.label}: downloads inside hitches`).toEqual([]);
        }
      } finally {
        await audit.stop();
      }
    });
  });
});
