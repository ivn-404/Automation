/**
 * PAD-035 — Several effects at once: spins whose `/bet` shows a win, a tumble and a multiplier
 * above 1 together (up to 5). Hybrid: QA confirms on screen.
 * Expected: no freeze (no frame over 1 s); no hitch over 100 ms.
 */

import { test, expect } from '../../fixtures/index.js';
import { annotate, measureSpin, withPad } from '../../support/pad-perf.js';
import { betFeatures, count } from '../../support/pad-scenarios.js';
import type { PerfWindow } from '../../../src/perf/index.js';

const MANUAL_TEST_ID = 'PAD-035' as const;
const WANTED = count(5, 1);
const MAX_SPINS = count(60, 15);
const FREEZE_MS = 1_000;

test.describe('PAD — Performance & Asset Diagnostics', () => {
  test(`${MANUAL_TEST_ID} several effects at once`, async ({ sgapSession, sgapDriver, page }, testInfo) => {
    test.setTimeout(MAX_SPINS * 60_000);
    const qualifying: PerfWindow[] = [];
    await withPad({ sgapSession, sgapDriver, page }, testInfo, MANUAL_TEST_ID, async (ctx, windows) => {
      for (let i = 1; i <= MAX_SPINS && qualifying.length < WANTED; i += 1) {
        const w = await measureSpin(ctx, `spin ${i}`, { maxMs: 40_000 });
        const f = betFeatures(ctx, ctx.state.betBody);
        if (f.win > 0 && f.tumbles > 0 && f.maxMultiplier > 1) {
          qualifying.push(w);
          windows.push(w);
          annotate(testInfo, `qualifying ${qualifying.length}`, `${w.label}: win ${f.win}, ${f.tumbles} tumbles, ×${f.maxMultiplier}; max frame ${w.stats.maxMs} ms; hitches ${w.hitches.length}`);
        }
      }
    });
    test.skip(qualifying.length === 0, `No spin with win + tumble + multiplier in ${MAX_SPINS} spins`);
    annotate(testInfo, 'qa-check', 'Combined win, multiplier and tumble effects look right: confirm on the game window');
    for (const w of qualifying) {
      expect.soft(w.stats.maxMs, `${w.label}: freeze`).toBeLessThan(FREEZE_MS);
      expect.soft(w.hitches.length, `${w.label}: hitches over 100 ms`).toBe(0);
    }
  });
});
