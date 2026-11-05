/**
 * PAD-053 — Headroom with the frame-rate limit removed (diagnostic, 3 runs). Needs a browser
 * started with `--disable-gpu-vsync --disable-frame-rate-limit` (PAD Tester "Headroom" option).
 * Runs idle, spins, a bought bonus and a long tumble search, then reports how far above 60 FPS
 * each moment ran and the 5 half-second slices with the least headroom.
 */

import { test } from '../../fixtures/index.js';
import { annotate, measureIdle, measureSpin, settle, withPad } from '../../support/pad-perf.js';
import { betFeatures, count, playBoughtRound } from '../../support/pad-scenarios.js';
import { frameStats, round1, type PerfWindow } from '../../../src/perf/index.js';

const MANUAL_TEST_ID = 'PAD-053' as const;
const RUNS = count(3, 1);
/** Above this the vsync cap is clearly off (a 60 Hz panel never shows it). */
const UNCAPPED_FPS = 70;
const SLICE_MS = 500;

test.describe('PAD — Performance & Asset Diagnostics', () => {
  test(`${MANUAL_TEST_ID} headroom with frame-rate limit removed`, async ({ sgapSession, sgapDriver, page }, testInfo) => {
    test.setTimeout(RUNS * 12 * 60_000);
    let uncapped = true;
    await withPad({ sgapSession, sgapDriver, page }, testInfo, MANUAL_TEST_ID, async (ctx, windows) => {
      await settle(ctx);
      const probe = await measureIdle(ctx, 'cap probe', 5_000);
      uncapped = probe.stats.avgFps >= UNCAPPED_FPS;
      if (!uncapped) {
        annotate(testInfo, 'headroom', `Frame rate capped (${probe.stats.avgFps} FPS idle): start the run with the PAD Tester "Headroom" option`);
        return;
      }
      const spans = ctx.perf.excludedSpans();
      for (let run = 1; run <= RUNS; run += 1) {
        const runWindows: PerfWindow[] = [await measureIdle(ctx, `run ${run} idle`, 15_000)];
        for (let i = 1; i <= count(5, 2); i += 1) runWindows.push(await measureSpin(ctx, `run ${run} spin ${i}`));
        if (sgapSession.supports('buyFeature')) runWindows.push((await playBoughtRound(ctx, `run ${run} bonus`)).window);
        for (let i = 1; i <= count(15, 5); i += 1) {
          const w = await measureSpin(ctx, `run ${run} tumble search ${i}`);
          if (betFeatures(ctx, ctx.state.betBody).tumbles >= 5) {
            runWindows.push(w);
            break;
          }
        }
        windows.push(...runWindows);
        const slices: { label: string; fps: number }[] = [];
        for (const w of runWindows) {
          for (let t = w.startedAt; t + SLICE_MS <= w.endedAt; t += SLICE_MS) {
            const s = frameStats(ctx.perf.framesIn(t, t + SLICE_MS), spans);
            if (s.frames > 0) slices.push({ label: `${w.label} +${((t - w.startedAt) / 1000).toFixed(1)} s`, fps: round1(s.avgFps) });
          }
        }
        const worst = [...slices].sort((a, b) => a.fps - b.fps).slice(0, 5);
        annotate(testInfo, `run ${run}`, runWindows.map((w) => `${w.label} ${w.stats.avgFps} FPS (1% low ${w.stats.low1Fps})`).join('; '));
        annotate(testInfo, `run ${run} least headroom`, worst.map((s) => `${s.label}: ${s.fps} FPS`).join('; '));
      }
    });
    test.skip(!uncapped, 'Headroom mode is off (frame rate capped at the display refresh)');
  });
});
