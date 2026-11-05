/**
 * PAD-047 — Reproducing a found FPS problem (5 attempts). The scenario comes from
 * `SGAP_PAD_REPRO` (first-spin | spin | bonus | big-win; default first-spin, the drop PAD-002
 * found on Gnome). An attempt reproduces when its window has a frame over `SGAP_PAD_REPRO_MS`
 * (default 33.3 ms). Hybrid: QA watches the attempts on the game window.
 * Expected: ≥ 3/5 → defect (fails); 1–2/5 → intermittent; 0/5 → inconclusive.
 */

import { test, expect } from '../../fixtures/index.js';
import { annotate, measureSpin, reloadGame, withPad, type PadContext } from '../../support/pad-perf.js';
import { betFeatures, bigWinThreshold, count, playBoughtRound } from '../../support/pad-scenarios.js';
import { LONG_FRAME_MS, type PerfWindow } from '../../../src/perf/index.js';

const MANUAL_TEST_ID = 'PAD-047' as const;
const ATTEMPTS = count(5, 2);
const SCENARIO = process.env.SGAP_PAD_REPRO?.trim() || 'first-spin';
const THRESHOLD_MS = Number(process.env.SGAP_PAD_REPRO_MS ?? LONG_FRAME_MS);

async function attempt(ctx: PadContext, n: number): Promise<PerfWindow | undefined> {
  switch (SCENARIO) {
    case 'first-spin':
      await reloadGame(ctx);
      return measureSpin(ctx, `attempt ${n} first spin`);
    case 'spin':
      return measureSpin(ctx, `attempt ${n} spin`);
    case 'bonus':
      return (await playBoughtRound(ctx, `attempt ${n} bonus`)).window;
    case 'big-win':
      for (let i = 1; i <= 40; i += 1) {
        const w = await measureSpin(ctx, `attempt ${n} spin ${i}`, { maxMs: 45_000 });
        if (betFeatures(ctx, ctx.state.betBody).winX >= bigWinThreshold(ctx)) return w;
      }
      return undefined;
    default:
      throw new Error(`Unknown SGAP_PAD_REPRO scenario "${SCENARIO}" (first-spin | spin | bonus | big-win)`);
  }
}

test.describe('PAD — Performance & Asset Diagnostics', () => {
  test(`${MANUAL_TEST_ID} reproducing a found FPS problem`, async ({ sgapSession, sgapDriver, page }, testInfo) => {
    test.setTimeout(ATTEMPTS * 10 * 60_000);
    await withPad({ sgapSession, sgapDriver, page }, testInfo, MANUAL_TEST_ID, async (ctx, windows) => {
      let reproduced = 0;
      let ran = 0;
      for (let n = 1; n <= ATTEMPTS; n += 1) {
        const w = await attempt(ctx, n);
        if (w === undefined) continue;
        ran += 1;
        windows.push(w);
        const hits = w.slowFrames.filter((f) => f.ms > THRESHOLD_MS);
        if (hits.length > 0) reproduced += 1;
        annotate(testInfo, w.label, hits.length > 0 ? `reproduced: ${hits.map((f) => `${f.ms} ms at +${f.offsetMs} ms`).join(', ')}` : 'not reproduced');
      }
      const verdict = reproduced >= 3 ? 'defect' : reproduced >= 1 ? 'intermittent' : 'inconclusive';
      annotate(testInfo, 'verdict', `${SCENARIO}: frame > ${THRESHOLD_MS.toFixed(1)} ms in ${reproduced}/${ran} attempts → ${verdict}`);
      annotate(testInfo, 'qa-check', 'Confirm the drop is visible on the game window during the attempts');
      expect(ran, 'attempts that reached the scenario').toBeGreaterThan(0);
      expect.soft(verdict, `${SCENARIO} reproduced ${reproduced}/${ran}`).not.toBe('defect');
    });
  });
});
