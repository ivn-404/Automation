/**
 * PAD-056 — Second monitor busy (3 rounds): normal spins measured alone, then while a second SGAP
 * lane spins the same game on the other monitor (BUSY-056, added by the PAD Tester when this case
 * is selected). Expected: the slowdown is documented; it confirms PAD runs must run alone.
 */

import { test } from '../../fixtures/index.js';
import { annotate, measureSpin, pooled, withPad } from '../../support/pad-perf.js';
import { busyLaneActive, clearBusyRequest, markBusyDone, requestBusy } from '../../support/pad-busy-lane.js';
import { count } from '../../support/pad-scenarios.js';
import type { PerfWindow } from '../../../src/perf/index.js';

const MANUAL_TEST_ID = 'PAD-056' as const;
const ROUNDS = count(3, 1);
const SPINS = count(5, 2);
const BUSY_WAIT_MS = 4 * 60_000;
const HEARTBEAT_MAX_AGE_MS = 30_000;

test.describe('PAD — Performance & Asset Diagnostics', () => {
  test(`${MANUAL_TEST_ID} second monitor busy`, async ({ sgapSession, sgapDriver, page }, testInfo) => {
    test.setTimeout(ROUNDS * (2 * SPINS * 60_000 + BUSY_WAIT_MS));
    let busyAvailable = true;
    try {
      await withPad({ sgapSession, sgapDriver, page }, testInfo, MANUAL_TEST_ID, async (ctx, windows) => {
        for (let round = 1; round <= ROUNDS && busyAvailable; round += 1) {
          clearBusyRequest();
          const alone: PerfWindow[] = [];
          for (let i = 1; i <= SPINS; i += 1) alone.push(await measureSpin(ctx, `round ${round} alone ${i}`));
          requestBusy(Date.now() + 30 * 60_000);
          ctx.perf.setStatus('waiting for the busy lane');
          const deadline = Date.now() + BUSY_WAIT_MS;
          while (!busyLaneActive(HEARTBEAT_MAX_AGE_MS) && Date.now() < deadline) await page.waitForTimeout(2_000);
          if (!busyLaneActive(HEARTBEAT_MAX_AGE_MS)) {
            busyAvailable = false;
            windows.push(...alone);
            break;
          }
          const busy: PerfWindow[] = [];
          for (let i = 1; i <= SPINS; i += 1) busy.push(await measureSpin(ctx, `round ${round} busy ${i}`));
          clearBusyRequest();
          windows.push(...alone, ...busy);
          const a = pooled(alone);
          const b = pooled(busy);
          annotate(testInfo, `round ${round}`, `alone ${a.avgFps} FPS (P95 ${a.p95Ms} ms, 1% low ${a.low1Fps}) vs busy ${b.avgFps} FPS (P95 ${b.p95Ms} ms, 1% low ${b.low1Fps}): ${(((b.avgFps - a.avgFps) / a.avgFps) * 100).toFixed(1)}% FPS, ${(((b.p95Ms - a.p95Ms) / a.p95Ms) * 100).toFixed(1)}% P95`);
        }
      });
    } finally {
      clearBusyRequest();
      markBusyDone();
    }
    test.skip(!busyAvailable, 'No busy lane answered: start PAD-056 from the PAD Tester, which adds the BUSY-056 lane');
  });
});
