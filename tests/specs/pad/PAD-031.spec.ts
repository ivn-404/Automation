/**
 * PAD-031 — Renderer in use, once per load (3 loads). Expected: WebGL; a Canvas fallback is a
 * finding on its own. Spin frame cost is PAD-003.
 */

import { test, expect } from '../../fixtures/index.js';
import { annotate, reloadGame, withPad } from '../../support/pad-perf.js';
import { count, renderInfo } from '../../support/pad-scenarios.js';

const MANUAL_TEST_ID = 'PAD-031' as const;
const LOADS = count(3, 2);

test.describe('PAD — Performance & Asset Diagnostics', () => {
  test(`${MANUAL_TEST_ID} renderer in use`, async ({ sgapSession, sgapDriver, page }, testInfo) => {
    test.setTimeout(LOADS * 3 * 60_000);
    await withPad({ sgapSession, sgapDriver, page }, testInfo, MANUAL_TEST_ID, async (ctx) => {
      for (let load = 1; load <= LOADS; load += 1) {
        if (load > 1) await reloadGame(ctx);
        const info = await renderInfo(ctx);
        annotate(testInfo, `load ${load}`, `Phaser ${info?.phaserVersion ?? '?'}, ${info?.renderer ?? 'unknown'} renderer, canvas ${info?.canvasWidth}×${info?.canvasHeight}, DPR ${info?.devicePixelRatio}`);
        expect.soft(info?.renderer, `load ${load}: renderer`).toBe('webgl');
      }
    });
  });
});
