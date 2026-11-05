/**
 * PAD-022 — Duplicate downloaded files (identical content under different URLs).
 * Scenario: cache cleared → reload → 20 spins → one bought bonus (cold), then a warm reload.
 * Bodies are SHA-256 hashed. Game files, third-party files inside the game frame and launcher
 * files are listed separately. Expected: every duplicate listed with size, URLs and wasted bytes.
 */

import { test, expect } from '../../fixtures/index.js';
import { annotate, reloadGame, withPad } from '../../support/pad-perf.js';
import { attachAssetReport, coldAssetSession, count, kb, startAssetAudit } from '../../support/pad-scenarios.js';

const MANUAL_TEST_ID = 'PAD-022' as const;
const SPINS = count(20, 3);

test.describe('PAD — Performance & Asset Diagnostics', () => {
  test(`${MANUAL_TEST_ID} duplicate downloaded files`, async ({ sgapSession, sgapDriver, page }, testInfo) => {
    test.setTimeout(SPINS * 60_000 + 15 * 60_000);
    await withPad({ sgapSession, sgapDriver, page }, testInfo, MANUAL_TEST_ID, async (ctx, windows) => {
      const audit = startAssetAudit(ctx);
      try {
        const cold = await coldAssetSession(ctx, audit, SPINS);
        windows.push(...cold.windows);
        await attachAssetReport(testInfo, 'pad-022-cold-assets', cold.report);
        audit.reset();
        await reloadGame(ctx);
        await page.waitForTimeout(5_000);
        const warm = await audit.report();
        await attachAssetReport(testInfo, 'pad-022-warm-assets', warm);
        for (const [label, report] of [['cold', cold.report], ['warm', warm]] as const) {
          const wasted = report.duplicates.reduce((n, d) => n + d.wastedBytes, 0);
          annotate(testInfo, `${label} duplicates`, `${report.duplicates.length} group(s), ${kb(wasted)} wasted of ${kb(report.totalBytes)} (${report.total} files)`);
        }
        expect(cold.report.total, 'responses recorded on cold load').toBeGreaterThan(0);
        for (const d of cold.report.duplicates) {
          expect(d.urls.length).toBeGreaterThan(1);
          expect(d.wastedBytes).toBe(d.bytes * (d.urls.length - 1));
        }
      } finally {
        await audit.stop();
      }
    });
  });
});
