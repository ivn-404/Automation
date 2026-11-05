/**
 * PAD-050 — Amplify Bet on: 5 normal spins as the PAD-003 reference, then 10 spins with Amplify.
 * Expected: the Amplify band is not worse than the reference band.
 */

import { test, expect } from '../../fixtures/index.js';
import { requireCapabilities } from '../../support/capabilities.js';
import { annotate, bandOutcome, measureSpin, pooled, withPad } from '../../support/pad-perf.js';
import { count } from '../../support/pad-scenarios.js';
import { fpsBand } from '../../../src/perf/index.js';

const MANUAL_TEST_ID = 'PAD-050' as const;
const REFERENCE = count(5, 2);
const SPINS = count(10, 3);
const RANK = { pass: 0, passable: 1, investigate: 2, optimize: 3, priority: 4 } as const;

test.describe('PAD — Performance & Asset Diagnostics', () => {
  requireCapabilities('amplifyBet');

  test(`${MANUAL_TEST_ID} FPS with amplify bet on`, async ({ sgapSession, sgapDriver, page }, testInfo) => {
    test.setTimeout((REFERENCE + SPINS) * 60_000 + 60_000);
    await withPad({ sgapSession, sgapDriver, page }, testInfo, MANUAL_TEST_ID, async (ctx, windows) => {
      const reference = [];
      for (let i = 1; i <= REFERENCE; i += 1) reference.push(await measureSpin(ctx, `normal ${i}/${REFERENCE}`));
      await sgapSession.amplifyBet.enable({ timeoutMs: 10_000 });
      const amplified = [];
      try {
        for (let i = 1; i <= SPINS; i += 1) amplified.push(await measureSpin(ctx, `amplify ${i}/${SPINS}`));
      } finally {
        await sgapSession.amplifyBet.disable({ timeoutMs: 10_000 }).catch(() => undefined);
      }
      windows.push(...reference, ...amplified);
      const ref = pooled(reference);
      const amp = pooled(amplified);
      const refBand = fpsBand(ref.avgFps);
      const ampBand = fpsBand(amp.avgFps);
      const ampOutcome = bandOutcome(amp.avgFps, amp.low1Fps);
      annotate(testInfo, 'compare', `normal ${ref.avgFps} FPS (${refBand.label}) vs amplify ${amp.avgFps} FPS (${ampBand.label}); amplify ${ampOutcome.text}`);
      expect.soft(RANK[ampBand.band], `amplify band ${ampBand.label} vs normal ${refBand.label}`).toBeLessThanOrEqual(RANK[refBand.band]);
      expect.soft(ampOutcome.verdict, ampOutcome.text).not.toBe('fail');
    });
  });
});
