/**
 * PAD-010 — FPS while repeatedly skipping spin animations: the skip control is tapped every
 * 150 ms from the click until shortly after `/bet`. Each run first measures normal spins as the
 * PAD-003 reference. Expected: no freeze; skip P95 not worse than the reference (+10% noise).
 */

import { test, expect } from '../../fixtures/index.js';
import { annotate, measureSpin, pooled, withPad } from '../../support/pad-perf.js';
import { count } from '../../support/pad-scenarios.js';

const MANUAL_TEST_ID = 'PAD-010' as const;
const RUNS = count(3, 1);
const REFERENCE_SPINS = count(3, 2);
const SKIP_SPINS = count(10, 3);
const FREEZE_MS = 1_000;

test.describe('PAD — Performance & Asset Diagnostics', () => {
  test(`${MANUAL_TEST_ID} FPS while spamming skip`, async ({ sgapSession, sgapDriver, page }, testInfo) => {
    test.setTimeout(RUNS * (REFERENCE_SPINS + SKIP_SPINS) * 60_000);
    await withPad({ sgapSession, sgapDriver, page }, testInfo, MANUAL_TEST_ID, async (ctx, windows) => {
      for (let run = 1; run <= RUNS; run += 1) {
        const reference = [];
        for (let i = 1; i <= REFERENCE_SPINS; i += 1) reference.push(await measureSpin(ctx, `run ${run} normal ${i}`));
        const skipped = [];
        for (let i = 1; i <= SKIP_SPINS; i += 1) skipped.push(await measureSpin(ctx, `run ${run} skip ${i}`, { skipSpam: true }));
        windows.push(...reference, ...skipped);
        const ref = pooled(reference);
        const spam = pooled(skipped);
        const extra = skipped.reduce((n, w) => n + Number(w.meta?.extraBets ?? 0), 0);
        annotate(testInfo, `run ${run}`, `normal P95 ${ref.p95Ms} ms vs skip-spam P95 ${spam.p95Ms} ms; skip avg ${spam.avgFps} FPS${extra > 0 ? `; ${extra} extra spin(s) started by taps` : ''}`);
        expect.soft(Math.max(...skipped.map((w) => w.stats.maxMs)), `run ${run}: freeze`).toBeLessThan(FREEZE_MS);
        expect.soft(spam.p95Ms, `run ${run}: skip P95 vs normal ${ref.p95Ms} ms`).toBeLessThanOrEqual(ref.p95Ms * 1.1);
      }
    });
  });
});
