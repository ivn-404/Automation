/**
 * PAD-012 — FPS during Scatter, Wild and multiplier animations. Qualifying spins are the ones
 * whose `/bet` board holds a scatter or wild (manifest symbol kinds) or a multiplier above 1
 * (manifest `metadata.normalModeMultiplierPath`). Hybrid: QA confirms the effects on screen.
 * Expected: pass band in each qualifying window.
 */

import { test, expect } from '../../fixtures/index.js';
import { annotate, bandOutcome, measureSpin, withPad } from '../../support/pad-perf.js';
import { betFeatures, count } from '../../support/pad-scenarios.js';
import type { PerfWindow } from '../../../src/perf/index.js';

const MANUAL_TEST_ID = 'PAD-012' as const;
const WANTED = count(5, 1);
const MAX_SPINS = count(40, 10);

test.describe('PAD — Performance & Asset Diagnostics', () => {
  test(`${MANUAL_TEST_ID} FPS during scatter, wild and multiplier animations`, async ({ sgapSession, sgapDriver, page }, testInfo) => {
    test.setTimeout(MAX_SPINS * 60_000);
    const qualifying: PerfWindow[] = [];
    await withPad({ sgapSession, sgapDriver, page }, testInfo, MANUAL_TEST_ID, async (ctx, windows) => {
      const kinds = new Set((sgapSession.manifest.reelValidation?.symbols ?? []).map((s) => s.kind));
      if (!kinds.has('scatter') && !kinds.has('wild')) {
        annotate(testInfo, 'config', `${sgapSession.manifest.gameId} manifest has no reelValidation symbol kinds: only multipliers can qualify a spin`);
      }
      for (let i = 1; i <= MAX_SPINS && qualifying.length < WANTED; i += 1) {
        const w = await measureSpin(ctx, `spin ${i}`, { maxMs: 40_000 });
        const f = betFeatures(ctx, ctx.state.betBody);
        if (f.scatters > 0 || f.wilds > 0 || f.maxMultiplier > 1) {
          qualifying.push(w);
          windows.push(w);
          annotate(testInfo, `qualifying ${qualifying.length}`, `${w.label}: scatters ${f.scatters}, wilds ${f.wilds}, multiplier ×${f.maxMultiplier}; ${bandOutcome(w.stats.avgFps, w.stats.low1Fps).text}`);
        }
      }
    });
    test.skip(qualifying.length === 0, `No scatter, wild or multiplier in ${MAX_SPINS} spins`);
    annotate(testInfo, 'qa-check', 'Scatter, wild and multiplier animations look right: confirm on the game window');
    for (const w of qualifying) {
      const outcome = bandOutcome(w.stats.avgFps, w.stats.low1Fps);
      expect.soft(outcome.verdict, `${w.label}: ${outcome.text}`).not.toBe('fail');
    }
  });
});
