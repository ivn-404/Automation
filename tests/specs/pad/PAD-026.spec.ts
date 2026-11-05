/**
 * PAD-026 — Asset loading during the first spin of a fresh session (3 sessions). Every slow
 * frame (> 33.3 ms) of the first spin is checked against game downloads that arrived within it.
 * Image decode is not observable from the page, so only downloads are checked.
 * Expected: no download inside a slow frame of the first spin.
 */

import { test, expect } from '../../fixtures/index.js';
import { annotate, measureSpin, reloadGame, withPad } from '../../support/pad-perf.js';
import { count, downloadsInSlowFrames, startAssetAudit } from '../../support/pad-scenarios.js';

const MANUAL_TEST_ID = 'PAD-026' as const;
const SESSIONS = count(3, 1);

test.describe('PAD — Performance & Asset Diagnostics', () => {
  test(`${MANUAL_TEST_ID} asset loading during the first spin`, async ({ sgapSession, sgapDriver, page }, testInfo) => {
    test.setTimeout(SESSIONS * 4 * 60_000);
    await withPad({ sgapSession, sgapDriver, page }, testInfo, MANUAL_TEST_ID, async (ctx, windows) => {
      const audit = startAssetAudit(ctx);
      try {
        for (let session = 1; session <= SESSIONS; session += 1) {
          await reloadGame(ctx);
          audit.reset();
          const w = await measureSpin(ctx, `session ${session} first spin`);
          windows.push(w);
          const report = await audit.report((r) => r.at >= w.startedAt && r.at <= w.endedAt);
          const hits = downloadsInSlowFrames(w, report.records);
          annotate(testInfo, w.label, `${report.total} game downloads during the spin; ${w.slowFrames.length} slow frames; ${hits.length} overlap${hits.length > 0 ? `: ${hits.join('; ')}` : ''}`);
          expect.soft(hits, `${w.label}: downloads inside slow frames`).toEqual([]);
        }
      } finally {
        await audit.stop();
      }
    });
  });
});
