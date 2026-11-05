/**
 * PAD-017 — Memory cleanup after Free Spins (5 bought rounds). Heap (after forced GC) and texture
 * count are read before each buy and after the return to base game.
 * Expected: after round 5 ≤ after round 1 + 5% for both.
 */

import { test, expect } from '../../fixtures/index.js';
import { requireCapabilities } from '../../support/capabilities.js';
import { annotate, withPad } from '../../support/pad-perf.js';
import { count, playBoughtRound } from '../../support/pad-scenarios.js';

const MANUAL_TEST_ID = 'PAD-017' as const;
const ROUNDS = count(5, 2);

test.describe('PAD — Performance & Asset Diagnostics', () => {
  requireCapabilities('buyFeature');

  test(`${MANUAL_TEST_ID} memory cleanup after free spins`, async ({ sgapSession, sgapDriver, page }, testInfo) => {
    test.setTimeout(ROUNDS * 5 * 60_000);
    await withPad({ sgapSession, sgapDriver, page }, testInfo, MANUAL_TEST_ID, async (ctx, windows) => {
      const after: { heap?: number; textures?: number }[] = [];
      for (let round = 1; round <= ROUNDS; round += 1) {
        const r = await playBoughtRound(ctx, `bonus ${round}/${ROUNDS}`, { gcHeap: true });
        windows.push(r.window);
        after.push({ heap: r.heapAfterMb, textures: r.texturesAfter });
        annotate(testInfo, r.window.label, `heap ${r.heapBeforeMb ?? '?'} → ${r.heapAfterMb ?? '?'} MB; textures ${r.texturesBefore ?? '?'} → ${r.texturesAfter ?? '?'}`);
      }
      const first = after[0]!;
      const last = after[after.length - 1]!;
      expect(first.heap, 'heap after GC (CDP)').toBeDefined();
      expect.soft(last.heap!, `heap after round ${ROUNDS} vs round 1 (${first.heap} MB)`).toBeLessThanOrEqual(first.heap! * 1.05);
      if (first.textures !== undefined && last.textures !== undefined) {
        expect.soft(last.textures, `textures after round ${ROUNDS} vs round 1 (${first.textures})`).toBeLessThanOrEqual(Math.ceil(first.textures * 1.05));
      }
    });
  });
});
