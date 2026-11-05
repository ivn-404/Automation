/**
 * PAD-002 — FPS during the first spin after the game loads (3 fresh sessions).
 * Expected: pass band; first spin's P95 frame time no more than 10% above a warm spin's.
 */

import { test, expect } from '../../fixtures/index.js';
import {
  annotate,
  attachWindows,
  bandOutcome,
  measureSpin,
  reloadGame,
  startPad,
} from '../../support/pad-perf.js';
import type { PerfWindow } from '../../../src/perf/index.js';

const MANUAL_TEST_ID = 'PAD-002' as const;
const SESSIONS = 3;
const WARM_SPINS = 3;
const MAX_P95_GROWTH = 0.1;

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

test.describe('PAD — Performance & Asset Diagnostics', () => {
  test(`${MANUAL_TEST_ID} first spin after load vs warm spins`, async ({ sgapSession, sgapDriver, page }, testInfo) => {
    test.setTimeout(25 * 60_000);
    const ctx = await startPad(sgapSession, sgapDriver, page, testInfo, MANUAL_TEST_ID);
    const windows: PerfWindow[] = [];
    const sessions: { first: PerfWindow; warm: PerfWindow[]; loadMs: number }[] = [];
    try {
      for (let s = 1; s <= SESSIONS; s += 1) {
        const loadMs = await reloadGame(ctx);
        const first = await measureSpin(ctx, `S${s} first spin`);
        windows.push(first);
        const warm: PerfWindow[] = [];
        for (let i = 1; i <= WARM_SPINS; i += 1) {
          const w = await measureSpin(ctx, `S${s} warm ${i}`);
          warm.push(w);
          windows.push(w);
        }
        sessions.push({ first, warm, loadMs });
      }
    } finally {
      await ctx.perf.stop();
      await attachWindows(testInfo, 'pad-002-first-spin', windows);
    }

    for (const [index, session] of sessions.entries()) {
      const label = `Session ${index + 1} (load ${Math.round(session.loadMs / 1000)} s)`;
      const outcome = bandOutcome(session.first.stats.avgFps, session.first.stats.low1Fps);
      const warmP95 = median(session.warm.map((w) => w.stats.p95Ms));
      const growth = warmP95 > 0 ? session.first.stats.p95Ms / warmP95 - 1 : 0;
      annotate(
        testInfo,
        'first-spin',
        `${label}: ${outcome.text}; P95 first ${session.first.stats.p95Ms} ms vs warm ${warmP95.toFixed(1)} ms (${(growth * 100).toFixed(1)}%)`,
      );
      expect.soft(outcome.verdict, `${label} first spin: ${outcome.text}`).not.toBe('fail');
      expect
        .soft(growth, `${label}: first-spin P95 ${session.first.stats.p95Ms} ms vs warm ${warmP95.toFixed(1)} ms`)
        .toBeLessThanOrEqual(MAX_P95_GROWTH);
    }
  });
});
