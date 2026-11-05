/**
 * PAD-049 — Long tumble chains: spins whose `/bet` holds ≥ 5 tumbles (up to 5 such spins).
 * The part of the window after `/bet` is split into one equal slice per tumble (tumble times are
 * not reported by the game, so slices approximate them).
 * Expected: pass band; the last slice's P95 no more than 20% above the first slice's.
 */

import { test, expect } from '../../fixtures/index.js';
import { annotate, bandOutcome, measureSpin, withPad } from '../../support/pad-perf.js';
import { betFeatures, count } from '../../support/pad-scenarios.js';
import type { PerfWindow } from '../../../src/perf/index.js';

const MANUAL_TEST_ID = 'PAD-049' as const;
const WANTED = count(5, 1);
const MAX_SPINS = count(80, 15);
const MIN_TUMBLES = 5;
const GROWTH_LIMIT = 1.2;

test.describe('PAD — Performance & Asset Diagnostics', () => {
  test(`${MANUAL_TEST_ID} long tumble chains`, async ({ sgapSession, sgapDriver, page }, testInfo) => {
    test.setTimeout(MAX_SPINS * 60_000);
    const qualifying: { w: PerfWindow; first: number; last: number }[] = [];
    await withPad({ sgapSession, sgapDriver, page }, testInfo, MANUAL_TEST_ID, async (ctx, windows) => {
      for (let i = 1; i <= MAX_SPINS && qualifying.length < WANTED; i += 1) {
        const w = await measureSpin(ctx, `spin ${i}`, { maxMs: 45_000 });
        const { tumbles, maxMultiplier } = betFeatures(ctx, ctx.state.betBody);
        if (tumbles < MIN_TUMBLES) continue;
        windows.push(w);
        const betAt = w.startedAt + Number(w.meta?.betAfterMs ?? 0);
        const slice = (w.endedAt - betAt) / tumbles;
        const p95 = Array.from({ length: tumbles }, (_, k) =>
          ctx.perf.windowBetween('tumble', betAt + k * slice, betAt + (k + 1) * slice).stats.p95Ms,
        );
        const first = p95[0]!;
        const last = p95[p95.length - 1]!;
        qualifying.push({ w, first, last });
        annotate(testInfo, `chain ${qualifying.length}`, `${w.label}: ${tumbles} tumbles, ×${maxMultiplier}; slice P95 ${p95.join(' / ')} ms; ${bandOutcome(w.stats.avgFps, w.stats.low1Fps).text}`);
      }
    });
    test.skip(qualifying.length === 0, `No spin with ≥ ${MIN_TUMBLES} tumbles in ${MAX_SPINS} spins`);
    for (const { w, first, last } of qualifying) {
      const outcome = bandOutcome(w.stats.avgFps, w.stats.low1Fps);
      expect.soft(outcome.verdict, `${w.label}: ${outcome.text}`).not.toBe('fail');
      expect.soft(last, `${w.label}: frame time growth across the chain (first ${first} ms)`).toBeLessThanOrEqual(first * GROWTH_LIMIT);
    }
  });
});
