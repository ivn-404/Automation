/**
 * PAD-011 — FPS while opening and closing Menu / Help (open → scroll → close, 5 times).
 * Expected: pass band over the cycle; FPS back to the idle baseline within 2 s of closing.
 */

import { test, expect } from '../../fixtures/index.js';
import { requireCapabilities } from '../../support/capabilities.js';
import { annotate, bandOutcome, measureIdle, settle, withPad } from '../../support/pad-perf.js';
import { count, timeToBaselineMs } from '../../support/pad-scenarios.js';

const MANUAL_TEST_ID = 'PAD-011' as const;
const CYCLES = count(5, 2);
const RECOVERY_LIMIT_MS = 2_000;
const AFTER_CLOSE_MS = 4_000;

test.describe('PAD — Performance & Asset Diagnostics', () => {
  requireCapabilities('menu');

  test(`${MANUAL_TEST_ID} FPS opening and closing menu`, async ({ sgapSession, sgapDriver, page }, testInfo) => {
    test.setTimeout(CYCLES * 3 * 60_000);
    await withPad({ sgapSession, sgapDriver, page }, testInfo, MANUAL_TEST_ID, async (ctx, windows) => {
      await settle(ctx);
      const idle = await measureIdle(ctx, 'idle baseline', 10_000);
      windows.push(idle);
      for (let cycle = 1; cycle <= CYCLES; cycle += 1) {
        await settle(ctx);
        const token = ctx.perf.begin(`menu ${cycle}/${CYCLES}`);
        ctx.perf.mark('menu', 'open');
        await sgapSession.menu.open({ timeoutMs: 15_000 });
        const box = await sgapDriver.gameCanvas().boundingBox();
        if (box !== null) {
          await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
          for (let i = 0; i < 4; i += 1) {
            await page.mouse.wheel(0, 300);
            await page.waitForTimeout(250);
          }
        }
        ctx.perf.mark('menu', 'close');
        await sgapSession.menu.close({ timeoutMs: 15_000 });
        const closedAt = Date.now();
        await page.waitForTimeout(AFTER_CLOSE_MS);
        const w = await ctx.perf.end(token, { kind: 'menu' });
        windows.push(w);
        const recovery = timeToBaselineMs(ctx, closedAt, w.endedAt, idle.stats.avgFps);
        const outcome = bandOutcome(w.stats.avgFps, w.stats.low1Fps);
        annotate(testInfo, w.label, `${outcome.text}; back to idle ${idle.stats.avgFps} FPS after ${recovery ?? 'never'} ms`);
        expect.soft(outcome.verdict, `${w.label}: ${outcome.text}`).not.toBe('fail');
        expect.soft(recovery ?? Number.POSITIVE_INFINITY, `${w.label}: recovery to idle FPS`).toBeLessThanOrEqual(RECOVERY_LIMIT_MS);
      }
    });
  });
});
