/**
 * PAD-033 — Particle-heavy animations. Over 10 spins and a bought bonus, the 500 ms activity
 * samples with the top 10% particle counts are compared with particle-free samples.
 * Hybrid: QA confirms the effects on screen.
 * Expected: pass band in the top-decile samples; their average frame time no more than one
 * 60 Hz frame budget (16.7 ms) above the particle-free average.
 */

import { test, expect } from '../../fixtures/index.js';
import { annotate, bandOutcome, measureSpin, withPad } from '../../support/pad-perf.js';
import { count, playBoughtRound } from '../../support/pad-scenarios.js';
import { frameStats, round1 } from '../../../src/perf/index.js';

const MANUAL_TEST_ID = 'PAD-033' as const;
const SAMPLE_MS = 500;
const BUDGET_MS = 1000 / 60;

test.describe('PAD — Performance & Asset Diagnostics', () => {
  test(`${MANUAL_TEST_ID} particle-heavy animations`, async ({ sgapSession, sgapDriver, page }, testInfo) => {
    test.setTimeout(20 * 60_000);
    let maxParticles = 0;
    await withPad({ sgapSession, sgapDriver, page }, testInfo, MANUAL_TEST_ID, async (ctx, windows) => {
      for (let i = 1; i <= count(10, 3); i += 1) windows.push(await measureSpin(ctx, `spin ${i}`));
      if (sgapSession.supports('buyFeature')) windows.push((await playBoughtRound(ctx, 'bonus')).window);
      const spans = ctx.perf.excludedSpans();
      const samples = windows.flatMap((w) => ctx.perf.activityIn(w.startedAt, w.endedAt));
      maxParticles = Math.max(0, ...samples.map((s) => s.value.particles));
      if (maxParticles === 0) return;
      const sorted = [...samples].sort((a, b) => b.value.particles - a.value.particles);
      const top = sorted.slice(0, Math.max(1, Math.ceil(sorted.length / 10))).filter((s) => s.value.particles > 0);
      const none = samples.filter((s) => s.value.particles === 0);
      const intervalMean = (list: typeof samples): number => {
        const stats = list.map((s) => frameStats(ctx.perf.framesIn(s.at - SAMPLE_MS, s.at), spans));
        const frames = stats.reduce((n, st) => n + st.frames, 0);
        return frames === 0 ? Number.NaN : stats.reduce((n, st) => n + st.durationMs, 0) / frames;
      };
      const topMs = intervalMean(top);
      const noneMs = intervalMean(none);
      const topFrames = top.flatMap((s) => ctx.perf.framesIn(s.at - SAMPLE_MS, s.at));
      const topStats = frameStats(topFrames, spans);
      const outcome = bandOutcome(round1(1000 / topMs), round1(topStats.low1Fps));
      annotate(testInfo, 'particles', `peak ${maxParticles} particles; top-decile samples (${top.length}) ${round1(topMs)} ms/frame vs particle-free ${round1(noneMs)} ms/frame; ${outcome.text}`);
      annotate(testInfo, 'qa-check', 'Particle effects look right: confirm on the game window');
      expect.soft(outcome.verdict, `top-decile particle samples: ${outcome.text}`).not.toBe('fail');
      if (Number.isFinite(noneMs)) {
        expect.soft(topMs, 'frame time rise with particles').toBeLessThanOrEqual(noneMs + BUDGET_MS);
      }
    });
    test.skip(maxParticles === 0, 'The game showed no live Phaser particles in this session');
  });
});
