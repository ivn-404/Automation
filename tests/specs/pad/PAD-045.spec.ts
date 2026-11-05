/**
 * PAD-045 — Browser loses focus or is covered during a spin (3 runs): the window is minimised for
 * 2 s right after the spin click. Expected: the throttled period is flagged and excluded, so the
 * spin's result reflects only the time the game was visible.
 */

import { test, expect } from '../../fixtures/index.js';
import { annotate, bandOutcome, measureSpin, withPad } from '../../support/pad-perf.js';
import { count, hideWindow } from '../../support/pad-scenarios.js';
import { frameStats, round1 } from '../../../src/perf/index.js';

const MANUAL_TEST_ID = 'PAD-045' as const;
const RUNS = count(3, 1);
const HIDDEN_MS = 2_000;
/** A frame this long during the hidden period is the browser throttling, not the game. */
const THROTTLED_MS = 250;

test.describe('PAD — Performance & Asset Diagnostics', () => {
  test(`${MANUAL_TEST_ID} focus lost during a spin`, async ({ sgapSession, sgapDriver, page }, testInfo) => {
    test.setTimeout(RUNS * 2 * 60_000);
    await withPad({ sgapSession, sgapDriver, page }, testInfo, MANUAL_TEST_ID, async (ctx, windows) => {
      for (let run = 1; run <= RUNS; run += 1) {
        const w = await measureSpin(ctx, `run ${run} spin (window hidden 2 s)`, {
          during: () => hideWindow(ctx, HIDDEN_MS),
        });
        windows.push(w);
        const raw = frameStats(ctx.perf.framesIn(w.startedAt, w.endedAt));
        const reasons = [...new Set(w.excludedSpans.map((s) => s.reason))];
        const outcome = bandOutcome(w.stats.avgFps, w.stats.low1Fps);
        annotate(testInfo, w.label, `flagged ${(w.excludedMs / 1000).toFixed(1)} s (${reasons.join(', ') || 'none'}); raw max frame ${round1(raw.maxMs)} ms → counted max ${w.stats.maxMs} ms; ${outcome.text}`);
        expect.soft(reasons.some((r) => r === 'tab-hidden' || r === 'window-minimised'), `${w.label}: hidden period flagged`).toBe(true);
        expect.soft(w.excludedMs, `${w.label}: hidden period excluded`).toBeGreaterThanOrEqual(HIDDEN_MS * 0.8);
        if (raw.maxMs > THROTTLED_MS) {
          expect.soft(w.stats.maxMs, `${w.label}: no throttled frame left in the result`).toBeLessThan(THROTTLED_MS);
        }
      }
    });
  });
});
