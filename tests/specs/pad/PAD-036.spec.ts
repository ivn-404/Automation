/**
 * PAD-036 — After resizing the window: 1920×1080, 1280×720 and portrait 390×844 (3 runs). At each
 * size: 10 s idle and one spin. The canvas must keep its aspect ratio (CSS box vs backing size
 * within 2%) and not be blank (a near-uniform canvas compresses to almost nothing).
 * Hybrid: QA confirms the layout on the game window. Expected: pass band at each size.
 */

import { test, expect } from '../../fixtures/index.js';
import { annotate, bandOutcome, measureIdle, measureSpin, settle, withPad } from '../../support/pad-perf.js';
import { count, gameFrame } from '../../support/pad-scenarios.js';

const MANUAL_TEST_ID = 'PAD-036' as const;
const RUNS = count(3, 1);
const SIZES = [
  { width: 1920, height: 1080 },
  { width: 1280, height: 720 },
  { width: 390, height: 844 },
] as const;
const BLANK_JPEG_BYTES = 4_000;

test.describe('PAD — Performance & Asset Diagnostics', () => {
  test(`${MANUAL_TEST_ID} FPS after resizing the window`, async ({ sgapSession, sgapDriver, page }, testInfo) => {
    test.setTimeout(RUNS * SIZES.length * 3 * 60_000);
    const original = page.viewportSize();
    await withPad({ sgapSession, sgapDriver, page }, testInfo, MANUAL_TEST_ID, async (ctx, windows) => {
      try {
        for (let run = 1; run <= RUNS; run += 1) {
          for (const size of SIZES) {
            const label = `run ${run} ${size.width}×${size.height}`;
            await page.setViewportSize(size);
            await page.waitForTimeout(2_000);
            await settle(ctx);
            const frame = await gameFrame(ctx);
            const shape = frame === null
              ? undefined
              : await frame
                  .evaluate(() => {
                    const canvas = document.querySelector('canvas');
                    if (canvas === null) return undefined;
                    const box = canvas.getBoundingClientRect();
                    return { cssW: box.width, cssH: box.height, w: canvas.width, h: canvas.height };
                  })
                  .catch(() => undefined);
            const box = await sgapDriver.gameCanvas().boundingBox();
            const shot = box === null ? undefined : await page.screenshot({ type: 'jpeg', quality: 60, clip: box }).catch(() => undefined);
            const stretch = shape === undefined || shape.cssH === 0 || shape.h === 0 ? Number.NaN : Math.abs(shape.cssW / shape.cssH / (shape.w / shape.h) - 1);
            const idle = await measureIdle(ctx, `${label} idle`, 10_000);
            const spin = await measureSpin(ctx, `${label} spin`);
            windows.push(idle, spin);
            const outIdle = bandOutcome(idle.stats.avgFps, idle.stats.low1Fps);
            const outSpin = bandOutcome(spin.stats.avgFps, spin.stats.low1Fps);
            annotate(testInfo, label, `canvas ${Math.round(shape?.cssW ?? 0)}×${Math.round(shape?.cssH ?? 0)} css / ${shape?.w}×${shape?.h} px, aspect off by ${(stretch * 100).toFixed(1)}%, capture ${shot?.length ?? 0} B; idle ${outIdle.text}; spin ${outSpin.text}`);
            expect.soft(shape, `${label}: game canvas present`).toBeDefined();
            expect.soft(stretch, `${label}: canvas not stretched`).toBeLessThanOrEqual(0.02);
            expect.soft(shot?.length ?? 0, `${label}: canvas not blank`).toBeGreaterThan(BLANK_JPEG_BYTES);
            expect.soft(outIdle.verdict, `${label} idle: ${outIdle.text}`).not.toBe('fail');
            expect.soft(outSpin.verdict, `${label} spin: ${outSpin.text}`).not.toBe('fail');
          }
        }
        annotate(testInfo, 'qa-check', 'Layout at each size (no clipped HUD, no letterbox glitches): confirm on the game window');
      } finally {
        if (original !== null) await page.setViewportSize(original);
      }
    });
  });
});
