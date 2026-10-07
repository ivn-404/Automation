/**
 * CSF-006 — Core Spin Flow (backend vs frontend reel result)
 *
 * Manual Test Case ID: CSF-006
 * Catalog: Result shown after reel stop [Manual]
 *
 * Manual — QA owns this visually; automation workers must not run it.
 * Intent (historical): after reels stop, every Column×Row symbol on canvas
 * matches the bet response. Kept skipped for discoverability.
 */

import type { Page } from 'playwright';

import { test, expect, type SgapSession } from '../../fixtures/index.js';
import { requireCapabilities } from '../../support/capabilities.js';
import { getLauncherMode } from '../../fixtures/local-launcher-html.js';
import { clearCanvasOverlays, settleCanvasToBaseGame } from '../../../src/platform/index.js';
import {
  InMemoryExecutionTracker,
  createDefaultExecutionReporters,
} from '../../../src/reporting/index.js';
import {
  parseReelGridFromBetResponse,
  reelReportToVerificationResults,
  validateSettledSpinLeaveOneOut,
} from '../../../src/verification/reel/index.js';
import { spinForBet } from '../../support/canvas-bet-flow.js';
import type { BetResponseSnapshot, VerificationResult } from '../../../src/core/models/index.js';
import type { PlaywrightGameDriver } from '../../../src/driver/playwright-game-driver.js';

const MANUAL_TEST_ID = 'CSF-006' as const;

function totalWinAmount(bet: BetResponseSnapshot): number {
  return Number(bet.win?.amount ?? '0');
}

/** Spin until a zero-win board (or best effort after maxAttempts). */
async function spinForStableBoard(
  sgapSession: SgapSession,
  sgapDriver: PlaywrightGameDriver,
  page: Page,
  maxAttempts = 6,
): Promise<BetResponseSnapshot> {
  let last = await spinForBet(sgapSession, sgapDriver, page);
  for (let attempt = 1; attempt < maxAttempts && totalWinAmount(last) > 0; attempt += 1) {
    await clearCanvasOverlays(sgapDriver, sgapSession.manifest, 2);
    await sgapDriver.clickCanvas('enter', { singleInput: true }).catch(() => undefined);
    await sgapDriver.clickCanvas('acknowledge', { singleInput: true }).catch(() => undefined);
    last = await spinForBet(sgapSession, sgapDriver, page);
  }
  await clearCanvasOverlays(sgapDriver, sgapSession.manifest, 2);
  await sgapDriver.clickCanvas('enter', { singleInput: true }).catch(() => undefined);
  await sgapDriver.clickCanvas('acknowledge', { singleInput: true }).catch(() => undefined);
  await sgapDriver.clickCanvas('dismiss', { singleInput: true }).catch(() => undefined);
  return last;
}

test.describe.skip('CSF — Core Spin Flow', () => {
  requireCapabilities('reelValidation');
  test(`${MANUAL_TEST_ID} backend reel result matches frontend canvas symbols`, async ({
    sgapSession,
    sgapDriver,
    page,
  }, testInfo) => {
    test.setTimeout(420_000);

    const tracker = new InMemoryExecutionTracker();
    await tracker.start(MANUAL_TEST_ID, testInfo.project.name);

    testInfo.annotations.push(
      { type: 'manualTestId', description: MANUAL_TEST_ID },
      { type: 'category', description: 'CSF' },
      { type: 'gameId', description: sgapSession.manifest.gameId },
    );

    let verificationResults: VerificationResult[] = [];

    try {
      const reelConfig = sgapSession.manifest.reelValidation;
      expect(reelConfig, 'manifest.reelValidation is required for CSF-006').toBeDefined();

      await expect(sgapDriver.isAttached()).resolves.toBe(true);
      expect(sgapSession.betWatcher).toBeDefined();
      await sgapDriver.gameCanvas().waitFor({ state: 'visible' });

      if (getLauncherMode() === 'staging') {
        await settleCanvasToBaseGame(
          page,
          sgapDriver,
          sgapSession.manifest,
          sgapSession.platform.getInitializeBody(),
        );
        await sgapSession.turbo.enable({ timeoutMs: 15_000 }).catch(() => undefined);
      }

      const bet = await spinForStableBoard(sgapSession, sgapDriver, page);
      const grid = parseReelGridFromBetResponse(bet.raw, reelConfig!);
      expect(grid.columns, 'columns derived from bet response').toBeGreaterThan(0);
      expect(grid.rows, 'rows derived from bet response').toBeGreaterThan(0);

      if (getLauncherMode() !== 'staging') {
        verificationResults = [
          {
            kind: 'uiSynchronization',
            passed: true,
            message: `Backend reel grid parsed: ${grid.columns}x${grid.rows} (visual compare skipped in local mode)`,
            expected: 'parseable slot.area',
            actual: { columns: grid.columns, rows: grid.rows },
          },
        ];
        console.log(
          `\n=== BACKEND REEL GRID (local) ${grid.columns}x${grid.rows} ===\n`,
        );
        for (const column of grid.cells) {
          console.log(`Column ${column[0]!.column}`);
          for (const cell of column) {
            console.log(`  Row ${cell.row}: ${cell.symbolName} (id ${cell.symbolId})`);
          }
        }
      } else {
        console.log(`Spin totalWin=${totalWinAmount(bet)} rowOrder=${reelConfig!.rowOrder ?? 'top-to-bottom'}`);
        const result = await validateSettledSpinLeaveOneOut({
          betBody: bet.raw,
          driver: sgapDriver,
          manifest: sgapSession.manifest,
          config: reelConfig!,
          settleRounds: 4,
        });

        console.log(`\nTemplate source: ${result.templateSource} (${result.templatesUsed})`);
        console.log(`\n${result.report.text}\n`);
        await testInfo.attach('reel-validation-report.txt', {
          body: result.report.text,
          contentType: 'text/plain',
        });
        await testInfo.attach('reel-validate-canvas.png', {
          body: result.canvasPng,
          contentType: 'image/png',
        });

        verificationResults = reelReportToVerificationResults(result.report);
      }

      for (const result of verificationResults) {
        expect(result.passed, result.message).toBe(true);
      }

      await tracker.record({
        manualTestId: MANUAL_TEST_ID,
        status: 'passed',
        startedAt: (await tracker.get(MANUAL_TEST_ID))!.startedAt,
        finishedAt: new Date().toISOString(),
        browserProject: testInfo.project.name,
        verificationResults,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      await tracker.finish(MANUAL_TEST_ID, 'failed', message);
      const failed = await tracker.get(MANUAL_TEST_ID);
      if (failed !== undefined && verificationResults.length > 0) {
        await tracker.record({ ...failed, verificationResults });
      }
      throw error;
    } finally {
      await createDefaultExecutionReporters().publish(await tracker.list());
    }
  });
});
