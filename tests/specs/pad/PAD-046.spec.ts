/**
 * PAD-046 — Slow frames line up with game events: every hitch (> 100 ms frame) in 10 spins
 * plus 30 s idle must be tagged with the nearest event (click, `/bet`, round progress).
 */

import { test, expect } from '../../fixtures/index.js';
import { annotate, attachWindows, measureIdle, measureSpin, startPad } from '../../support/pad-perf.js';
import type { PerfWindow } from '../../../src/perf/index.js';

const MANUAL_TEST_ID = 'PAD-046' as const;
const SPINS = 10;

test.describe('PAD — Performance & Asset Diagnostics', () => {
  test(`${MANUAL_TEST_ID} hitches tagged with game events`, async ({ sgapSession, sgapDriver, page }, testInfo) => {
    test.setTimeout(15 * 60_000);
    const ctx = await startPad(sgapSession, sgapDriver, page, testInfo, MANUAL_TEST_ID);
    const windows: PerfWindow[] = [];
    try {
      for (let i = 1; i <= SPINS; i += 1) {
        windows.push(await measureSpin(ctx, `spin ${i}/${SPINS}`));
      }
      windows.push(await measureIdle(ctx, 'idle after spins', 30_000));
    } finally {
      await ctx.perf.stop();
      await attachWindows(testInfo, 'pad-046-hitches', windows);
    }

    const hitches = windows.flatMap((w) => w.hitches.map((h) => ({ window: w.label, ...h })));
    const untagged = hitches.filter((h) => h.nearest === undefined);
    await testInfo.attach('pad-046-hitch-list.json', { body: JSON.stringify(hitches, null, 2), contentType: 'application/json' });
    const byKind = new Map<string, number>();
    for (const h of hitches) {
      const kind = h.nearest?.kind ?? 'untagged';
      byKind.set(kind, (byKind.get(kind) ?? 0) + 1);
    }
    annotate(
      testInfo,
      'hitches',
      hitches.length === 0
        ? 'no frame over 100 ms'
        : `${hitches.length} hitches: ${[...byKind].map(([k, n]) => `${k} ${n}`).join(', ')}; worst ${Math.max(...hitches.map((h) => h.ms))} ms`,
    );
    expect.soft(untagged.length, 'hitches with no game event within 2 s').toBe(0);
  });
});
