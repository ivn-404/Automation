/**
 * PAD-051 — Buy Feature panel open / tier select / close (5 cycles). Tiers are the manifest's
 * `buyFeatureOption*` canvas actions; games without them only open and close the panel.
 * Expected: pass band; no hitch over 100 ms.
 */

import { test, expect } from '../../fixtures/index.js';
import { requireCapabilities } from '../../support/capabilities.js';
import { annotate, bandOutcome, settle, withPad } from '../../support/pad-perf.js';
import { dismissBuyFeaturePanel, openBuyFeaturePanel } from '../../support/canvas-bet-flow.js';
import { count } from '../../support/pad-scenarios.js';

const MANUAL_TEST_ID = 'PAD-051' as const;
const CYCLES = count(5, 2);

test.describe('PAD — Performance & Asset Diagnostics', () => {
  requireCapabilities('buyFeature');

  test(`${MANUAL_TEST_ID} buy feature panel open, tier select, close`, async ({ sgapSession, sgapDriver, page }, testInfo) => {
    test.setTimeout(CYCLES * 2 * 60_000);
    const tiers = Object.keys(sgapSession.manifest.canvasActions?.actions ?? {})
      .filter((name) => name.startsWith('buyFeatureOption'))
      .sort();
    await withPad({ sgapSession, sgapDriver, page }, testInfo, MANUAL_TEST_ID, async (ctx, windows) => {
      for (let cycle = 1; cycle <= CYCLES; cycle += 1) {
        await settle(ctx);
        const token = ctx.perf.begin(`panel ${cycle}/${CYCLES}`);
        ctx.perf.mark('buy-panel', 'open');
        expect(await openBuyFeaturePanel(sgapSession, sgapDriver, page), 'buy panel opened').toBe(true);
        await page.waitForTimeout(800);
        for (const tier of [...tiers.slice(1), tiers[0]].filter((t): t is string => t !== undefined)) {
          ctx.perf.mark('buy-panel', tier);
          await sgapDriver.clickCanvas(tier, { timeoutMs: 5_000, singleInput: true });
          await page.waitForTimeout(600);
        }
        ctx.perf.mark('buy-panel', 'close');
        await dismissBuyFeaturePanel(sgapSession, sgapDriver, page);
        await page.waitForTimeout(1_500);
        const w = await ctx.perf.end(token, { kind: 'buy-panel', tiers });
        windows.push(w);
        const outcome = bandOutcome(w.stats.avgFps, w.stats.low1Fps);
        annotate(testInfo, w.label, `${outcome.text}; ${tiers.length} tiers tapped; hitches ${w.hitches.length}`);
        expect.soft(outcome.verdict, `${w.label}: ${outcome.text}`).not.toBe('fail');
        expect.soft(w.hitches.length, `${w.label}: hitches over 100 ms`).toBe(0);
      }
    });
  });
});
