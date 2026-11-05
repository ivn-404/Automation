/**
 * PAD-008 — FPS during Free Spins: 5 bought rounds, buy click → base game ready.
 * Expected: pass band per round. SGAP's own screen checks during the round are excluded.
 */

import { test, expect } from '../../fixtures/index.js';
import { requireCapabilities } from '../../support/capabilities.js';
import { annotate, bandOutcome, withPad } from '../../support/pad-perf.js';
import { count, playBoughtRound } from '../../support/pad-scenarios.js';

const MANUAL_TEST_ID = 'PAD-008' as const;
const ROUNDS = count(5, 1);

test.describe('PAD — Performance & Asset Diagnostics', () => {
  requireCapabilities('buyFeature');

  test(`${MANUAL_TEST_ID} FPS during free spins`, async ({ sgapSession, sgapDriver, page }, testInfo) => {
    test.setTimeout(ROUNDS * 5 * 60_000);
    await withPad({ sgapSession, sgapDriver, page }, testInfo, MANUAL_TEST_ID, async (ctx, windows) => {
      for (let round = 1; round <= ROUNDS; round += 1) {
        const { window } = await playBoughtRound(ctx, `bonus ${round}/${ROUNDS}`);
        windows.push(window);
        const outcome = bandOutcome(window.stats.avgFps, window.stats.low1Fps);
        annotate(testInfo, window.label, `${outcome.text}; ${(window.stats.durationMs / 1000).toFixed(1)} s measured; hitches ${window.hitches.length}`);
        expect.soft(outcome.verdict, `${window.label}: ${outcome.text}`).not.toBe('fail');
      }
    });
  });
});
