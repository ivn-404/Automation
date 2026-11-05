/**
 * PAD-005 — FPS in Turbo Mode (10 spins, turbo on). Hybrid: the FPS verdict is automatic; QA
 * confirms reels and tumbles stay in sync by watching the game window during the run.
 */

import { test, expect } from '../../fixtures/index.js';
import { requireCapabilities } from '../../support/capabilities.js';
import { annotate, bandOutcome, measureSpin, pooled, withPad } from '../../support/pad-perf.js';
import { count } from '../../support/pad-scenarios.js';

const MANUAL_TEST_ID = 'PAD-005' as const;
const SPINS = count(10, 3);

test.describe('PAD — Performance & Asset Diagnostics', () => {
  requireCapabilities('turbo');

  test(`${MANUAL_TEST_ID} FPS in turbo mode`, async ({ sgapSession, sgapDriver, page }, testInfo) => {
    test.setTimeout(SPINS * 90_000);
    await withPad({ sgapSession, sgapDriver, page }, testInfo, MANUAL_TEST_ID, async (ctx, windows) => {
      for (let i = 1; i <= SPINS; i += 1) {
        windows.push(await measureSpin(ctx, `turbo spin ${i}/${SPINS}`, { turbo: true }));
      }
      await sgapSession.turbo.disable({ timeoutMs: 8_000 }).catch(() => undefined);
      const all = pooled(windows);
      const outcome = bandOutcome(all.avgFps, all.low1Fps);
      annotate(testInfo, 'turbo spins', `${outcome.text}; worst P95 ${all.p95Ms} ms; hitches ${all.hitches}`);
      annotate(testInfo, 'qa-check', 'Reels and tumbles in sync under turbo: confirm on the game window (PAD Tester screen)');
      expect.soft(outcome.verdict, outcome.text).not.toBe('fail');
      for (const w of windows) {
        const one = bandOutcome(w.stats.avgFps, w.stats.low1Fps);
        expect.soft(one.verdict, `${w.label}: ${one.text}`).not.toBe('fail');
      }
    });
  });
});
