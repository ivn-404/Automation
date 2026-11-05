/**
 * PAD-055 — Resume an unfinished bonus after reload (3 runs): buy the feature, reload 4 s into
 * the free spins, then play the resumed round to base game. The window runs from the reloaded
 * game's canvas to the base game being ready (resume dialog and replayed spins included).
 * Expected: pass band; no hitch over 100 ms.
 */

import { test, expect } from '../../fixtures/index.js';
import { requireCapabilities } from '../../support/capabilities.js';
import { annotate, bandOutcome, reloadGame, settle, withPad } from '../../support/pad-perf.js';
import { buyFeatureForBet } from '../../support/canvas-bet-flow.js';
import { drainFreeSpins } from '../../support/free-spin-flow.js';
import { count } from '../../support/pad-scenarios.js';

const MANUAL_TEST_ID = 'PAD-055' as const;
const RUNS = count(3, 1);
const RELOAD_AFTER_MS = 4_000;

test.describe('PAD — Performance & Asset Diagnostics', () => {
  requireCapabilities('buyFeature');

  test(`${MANUAL_TEST_ID} resume an unfinished bonus after reload`, async ({ sgapSession, sgapDriver, page }, testInfo) => {
    test.setTimeout(RUNS * 6 * 60_000);
    await withPad({ sgapSession, sgapDriver, page }, testInfo, MANUAL_TEST_ID, async (ctx, windows) => {
      for (let run = 1; run <= RUNS; run += 1) {
        await settle(ctx);
        const buy = await buyFeatureForBet(sgapSession, sgapDriver, page, { settleAfter: false });
        await page.waitForTimeout(RELOAD_AFTER_MS);
        await reloadGame(ctx);
        const token = ctx.perf.begin(`resume ${run}/${RUNS}`);
        await drainFreeSpins(sgapSession, sgapDriver, page, buy.raw);
        const w = await ctx.perf.end(token, { kind: 'resume' });
        windows.push(w);
        const completed = w.events.some((e) => e.kind === 'round-complete');
        const outcome = bandOutcome(w.stats.avgFps, w.stats.low1Fps);
        annotate(testInfo, w.label, `${outcome.text}; hitches ${w.hitches.length}; round completed in window: ${completed}`);
        expect.soft(outcome.verdict, `${w.label}: ${outcome.text}`).not.toBe('fail');
        expect.soft(w.hitches.length, `${w.label}: hitches over 100 ms`).toBe(0);
      }
    });
  });
});
