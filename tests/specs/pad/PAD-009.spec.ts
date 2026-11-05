/**
 * PAD-009 — FPS on Normal → Bonus and Bonus → Normal transitions (5 each).
 * In: the first 6 s after the buy response. Out: the last 6 s before the base game is ready.
 * Expected: no freeze (no frame over 1 s); no hitch over 100 ms.
 */

import { test, expect } from '../../fixtures/index.js';
import { requireCapabilities } from '../../support/capabilities.js';
import { annotate, withPad } from '../../support/pad-perf.js';
import { count, playBoughtRound } from '../../support/pad-scenarios.js';

const MANUAL_TEST_ID = 'PAD-009' as const;
const ROUNDS = count(5, 1);
const FREEZE_MS = 1_000;

test.describe('PAD — Performance & Asset Diagnostics', () => {
  requireCapabilities('buyFeature');

  test(`${MANUAL_TEST_ID} FPS on bonus transitions`, async ({ sgapSession, sgapDriver, page }, testInfo) => {
    test.setTimeout(ROUNDS * 5 * 60_000);
    await withPad({ sgapSession, sgapDriver, page }, testInfo, MANUAL_TEST_ID, async (ctx, windows) => {
      for (let round = 1; round <= ROUNDS; round += 1) {
        const { transitionIn, transitionOut } = await playBoughtRound(ctx, `bonus ${round}/${ROUNDS}`);
        for (const w of [transitionIn, transitionOut]) {
          windows.push(w);
          annotate(testInfo, w.label, `avg ${w.stats.avgFps} FPS; max frame ${w.stats.maxMs} ms; hitches ${w.hitches.length}`);
          expect.soft(w.stats.maxMs, `${w.label}: freeze`).toBeLessThan(FREEZE_MS);
          expect.soft(w.hitches.length, `${w.label}: hitches over 100 ms`).toBe(0);
        }
      }
    });
  });
});
