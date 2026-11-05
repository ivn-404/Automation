/**
 * PAD-034 — Reel drops and tumbles stay smooth (10 spins). Spins whose `/bet` holds tumbles are
 * scored. Hybrid: QA confirms reels drop in sync on the game window.
 * Expected: pass band in every tumbling spin.
 */

import { test, expect } from '../../fixtures/index.js';
import { annotate, bandOutcome, measureSpin, withPad } from '../../support/pad-perf.js';
import { betFeatures, count } from '../../support/pad-scenarios.js';
import type { PerfWindow } from '../../../src/perf/index.js';

const MANUAL_TEST_ID = 'PAD-034' as const;
const SPINS = count(10, 3);

test.describe('PAD — Performance & Asset Diagnostics', () => {
  test(`${MANUAL_TEST_ID} reel drops and tumbles stay smooth`, async ({ sgapSession, sgapDriver, page }, testInfo) => {
    test.setTimeout(SPINS * 60_000);
    const tumbling: PerfWindow[] = [];
    await withPad({ sgapSession, sgapDriver, page }, testInfo, MANUAL_TEST_ID, async (ctx, windows) => {
      for (let i = 1; i <= SPINS; i += 1) {
        const w = await measureSpin(ctx, `spin ${i}/${SPINS}`);
        windows.push(w);
        const { tumbles } = betFeatures(ctx, ctx.state.betBody);
        const outcome = bandOutcome(w.stats.avgFps, w.stats.low1Fps);
        if (tumbles > 0) tumbling.push(w);
        annotate(testInfo, w.label, `${tumbles} tumble(s); ${outcome.text}`);
        expect.soft(outcome.verdict, `${w.label}: ${outcome.text}`).not.toBe('fail');
      }
    });
    annotate(testInfo, 'qa-check', 'Reels drop and tumble in sync: confirm on the game window');
    annotate(testInfo, 'tumbling spins', `${tumbling.length}/${SPINS}`);
  });
});
