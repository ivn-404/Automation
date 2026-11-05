/**
 * PAD-042 — Overhead of the measuring tools: idle with the collector and FPS counter off vs on
 * (3 each, alternating). Phaser's own `loop.actualFps` is the referee in both phases.
 * Expected: average FPS changes ≤ 1.
 */

import { test, expect } from '../../fixtures/index.js';
import { annotate, settle, startPad } from '../../support/pad-perf.js';

const MANUAL_TEST_ID = 'PAD-042' as const;
const PAIRS = 3;
const PHASE_MS = 20_000;
const MAX_DELTA_FPS = 1;

test.describe('PAD — Performance & Asset Diagnostics', () => {
  test(`${MANUAL_TEST_ID} collector and counter overhead`, async ({ sgapSession, sgapDriver, page }, testInfo) => {
    test.setTimeout(10 * 60_000);
    const ctx = await startPad(sgapSession, sgapDriver, page, testInfo, MANUAL_TEST_ID);
    const phases: { phase: 'off' | 'on'; pair: number; meanFps: number; samples: number }[] = [];

    const samplePhaser = async (ms: number): Promise<{ meanFps: number; samples: number }> => {
      await page.waitForTimeout(2_000);
      const values: number[] = [];
      const deadline = Date.now() + ms;
      while (Date.now() < deadline) {
        const fps = await ctx.perf.phaserFpsNow();
        if (fps !== undefined) values.push(fps);
        await page.waitForTimeout(500);
      }
      const meanFps = values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : Number.NaN;
      return { meanFps: Math.round(meanFps * 100) / 100, samples: values.length };
    };

    try {
      await settle(ctx);
      for (let pair = 1; pair <= PAIRS; pair += 1) {
        ctx.perf.setStatus(`${MANUAL_TEST_ID} pair ${pair}: tools off`);
        await ctx.perf.pauseSampler();
        await ctx.perf.setCounter(false);
        phases.push({ phase: 'off', pair, ...(await samplePhaser(PHASE_MS)) });

        await ctx.perf.resumeSampler();
        await ctx.perf.setCounter(true);
        ctx.perf.setStatus(`${MANUAL_TEST_ID} pair ${pair}: tools on`);
        phases.push({ phase: 'on', pair, ...(await samplePhaser(PHASE_MS)) });
      }
    } finally {
      await ctx.perf.stop();
      await testInfo.attach('pad-042-overhead.json', { body: JSON.stringify(phases, null, 2), contentType: 'application/json' });
    }

    const mean = (phase: 'off' | 'on'): number => {
      const list = phases.filter((p) => p.phase === phase && Number.isFinite(p.meanFps));
      return list.reduce((a, b) => a + b.meanFps, 0) / Math.max(1, list.length);
    };
    const off = mean('off');
    const on = mean('on');
    const delta = off - on;
    annotate(testInfo, 'overhead', `Phaser actualFps: tools off ${off.toFixed(2)}, tools on ${on.toFixed(2)}, cost ${delta.toFixed(2)} FPS`);
    expect(phases.every((p) => p.samples > 0), 'Phaser loop.actualFps readable in every phase').toBe(true);
    expect.soft(delta, 'FPS cost of the collector + counter').toBeLessThanOrEqual(MAX_DELTA_FPS);
  });
});
