/**
 * PAD-032 — Several Spine animations at once. A spin qualifies when at least 3 more Spine objects
 * are animating at its peak than at idle just before it. Hybrid: QA confirms on screen.
 * Expected: pass band in each qualifying window.
 */

import { test, expect } from '../../fixtures/index.js';
import { annotate, bandOutcome, measureSpin, settle, withPad } from '../../support/pad-perf.js';
import { count } from '../../support/pad-scenarios.js';
import type { PerfWindow } from '../../../src/perf/index.js';

const MANUAL_TEST_ID = 'PAD-032' as const;
const WANTED = count(5, 1);
const MAX_SPINS = count(40, 10);
const EXTRA_SPINES = 3;

test.describe('PAD — Performance & Asset Diagnostics', () => {
  test(`${MANUAL_TEST_ID} several spine animations at once`, async ({ sgapSession, sgapDriver, page }, testInfo) => {
    test.setTimeout(MAX_SPINS * 60_000);
    const qualifying: PerfWindow[] = [];
    let spineSeen = false;
    await withPad({ sgapSession, sgapDriver, page }, testInfo, MANUAL_TEST_ID, async (ctx, windows) => {
      for (let i = 1; i <= MAX_SPINS && qualifying.length < WANTED; i += 1) {
        await settle(ctx);
        const idleSpines = (await ctx.perf.currentActivity())?.spines ?? 0;
        const w = await measureSpin(ctx, `spin ${i}`, { maxMs: 40_000 });
        const peak = w.activityPeak?.spines ?? 0;
        spineSeen ||= peak > 0 || idleSpines > 0;
        if (peak - idleSpines >= EXTRA_SPINES) {
          qualifying.push(w);
          windows.push(w);
          annotate(testInfo, `qualifying ${qualifying.length}`, `${w.label}: ${idleSpines} → ${peak} animating Spine objects; ${bandOutcome(w.stats.avgFps, w.stats.low1Fps).text}`);
        }
      }
    });
    test.skip(!spineSeen, 'No animating Spine objects found in the scene (no Spine runtime or not readable)');
    test.skip(qualifying.length === 0, `No spin with ≥ ${EXTRA_SPINES} extra Spine animations in ${MAX_SPINS} spins`);
    annotate(testInfo, 'qa-check', 'Simultaneous win animations play smoothly: confirm on the game window');
    for (const w of qualifying) {
      const outcome = bandOutcome(w.stats.avgFps, w.stats.low1Fps);
      expect.soft(outcome.verdict, `${w.label}: ${outcome.text}`).not.toBe('fail');
    }
  });
});
