/**
 * PAD-030 — Cleanup after leaving the game (3 runs). Launcher page heap after a forced GC with the
 * game modal closed is the "before"; the game is opened, 3 spins played, the modal closed again
 * and the heap re-read. Expected: within 10% of before.
 */

import type { Page } from '@playwright/test';

import { test, expect } from '../../fixtures/index.js';
import { annotate, measureSpin, reopenGame, withPad } from '../../support/pad-perf.js';
import { count, hostHeapAfterGcMb } from '../../support/pad-scenarios.js';

const MANUAL_TEST_ID = 'PAD-030' as const;
const RUNS = count(3, 1);
const SPINS = count(3, 1);

async function closeGameModal(page: Page, iframeSelector: string): Promise<boolean> {
  const candidates = [
    page.getByRole('button', { name: /^(close|exit|back|×|✕)$/iu }),
    page.locator('[aria-label*="close" i], [title*="close" i], button.close, .modal-close'),
  ];
  for (const candidate of candidates) {
    const button = candidate.first();
    if (await button.isVisible().catch(() => false)) {
      await button.click({ timeout: 5_000 }).catch(() => undefined);
      break;
    }
  }
  if ((await page.locator(iframeSelector).count()) > 0) {
    await page.keyboard.press('Escape').catch(() => undefined);
  }
  return page
    .locator(iframeSelector)
    .first()
    .waitFor({ state: 'detached', timeout: 10_000 })
    .then(() => true)
    .catch(() => false);
}

test.describe('PAD — Performance & Asset Diagnostics', () => {
  test(`${MANUAL_TEST_ID} cleanup after leaving the game`, async ({ sgapSession, sgapDriver, page }, testInfo) => {
    test.setTimeout(RUNS * 6 * 60_000);
    await withPad({ sgapSession, sgapDriver, page }, testInfo, MANUAL_TEST_ID, async (ctx, windows) => {
      const launcherUrl = page.url();
      for (let run = 1; run <= RUNS; run += 1) {
        expect(await closeGameModal(page, sgapDriver.iframeSelector), 'launcher closes the game modal').toBe(true);
        await page.waitForTimeout(2_000);
        const before = await hostHeapAfterGcMb(page);
        await reopenGame(sgapSession, sgapDriver, page, launcherUrl);
        await ctx.perf.ensureSampler();
        for (let i = 1; i <= SPINS; i += 1) windows.push(await measureSpin(ctx, `run ${run} spin ${i}`));
        expect(await closeGameModal(page, sgapDriver.iframeSelector), 'launcher closes the game modal').toBe(true);
        await page.waitForTimeout(2_000);
        const after = await hostHeapAfterGcMb(page);
        annotate(testInfo, `run ${run}`, `launcher heap after GC: ${before ?? '?'} MB before the game → ${after ?? '?'} MB after closing it`);
        expect(before, 'launcher heap (CDP)').toBeDefined();
        expect.soft(after!, `run ${run}: launcher heap after closing the game`).toBeLessThanOrEqual(before! * 1.1);
        await reopenGame(sgapSession, sgapDriver, page, launcherUrl);
        await ctx.perf.ensureSampler();
      }
    });
  });
});
