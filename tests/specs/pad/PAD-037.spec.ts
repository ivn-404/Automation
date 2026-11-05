/**
 * PAD-037 — Different device pixel ratios: 1, 1.5 and 2 through Chrome emulation (3 runs). The
 * game is reloaded under each ratio so Phaser picks it up, then 10 s idle and 2 spins.
 * Expected: FPS reported per DPR; pass band at DPR 1.
 */

import { test, expect } from '../../fixtures/index.js';
import { annotate, bandOutcome, measureIdle, measureSpin, pooled, reloadGame, settle, withPad } from '../../support/pad-perf.js';
import { count, renderInfo } from '../../support/pad-scenarios.js';

const MANUAL_TEST_ID = 'PAD-037' as const;
const RUNS = count(3, 1);
const RATIOS = [1, 1.5, 2] as const;

test.describe('PAD — Performance & Asset Diagnostics', () => {
  test(`${MANUAL_TEST_ID} FPS at different device pixel ratios`, async ({ sgapSession, sgapDriver, page }, testInfo) => {
    test.setTimeout(RUNS * RATIOS.length * 4 * 60_000);
    const viewport = page.viewportSize() ?? { width: 1400, height: 900 };
    const cdp = await page.context().newCDPSession(page);
    await withPad({ sgapSession, sgapDriver, page }, testInfo, MANUAL_TEST_ID, async (ctx, windows) => {
      try {
        for (let run = 1; run <= RUNS; run += 1) {
          for (const dpr of RATIOS) {
            await cdp.send('Emulation.setDeviceMetricsOverride', { ...viewport, deviceScaleFactor: dpr, mobile: false });
            await reloadGame(ctx);
            await settle(ctx);
            const info = await renderInfo(ctx);
            const label = `run ${run} DPR ${dpr}`;
            const idle = await measureIdle(ctx, `${label} idle`, 10_000);
            const spins = [await measureSpin(ctx, `${label} spin 1`), await measureSpin(ctx, `${label} spin 2`)];
            windows.push(idle, ...spins);
            const all = pooled([idle, ...spins]);
            const outcome = bandOutcome(all.avgFps, all.low1Fps);
            annotate(testInfo, label, `game sees DPR ${info?.devicePixelRatio}, canvas ${info?.canvasWidth}×${info?.canvasHeight}; ${outcome.text}`);
            if (dpr === 1) expect.soft(outcome.verdict, `${label}: ${outcome.text}`).not.toBe('fail');
          }
        }
      } finally {
        await cdp.send('Emulation.clearDeviceMetricsOverride').catch(() => undefined);
        await cdp.detach().catch(() => undefined);
      }
    });
  });
});
