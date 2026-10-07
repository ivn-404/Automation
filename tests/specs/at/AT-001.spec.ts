/**
 * AT-001 — Additional Test
 *
 * Manual Test Case ID: AT-001
 * Intent: Misleading payout guides on Help Screen — Help/Payout catalog matches
 * Package 1 symbol ids (not Help order), Help does not fire a bet, and Amplify
 * does not change which ids the backend pays.
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { packageProfileFor } from '../../../src/capabilities/index.js';
import { loadPackageCatalog } from '../../../src/verification/reel/package-catalog.js';

import { test, expect } from '../../fixtures/index.js';
import { requireCapabilities } from '../../support/capabilities.js';
import { clearCanvasOverlays, settleCanvasToBaseGame } from '../../../src/platform/index.js';
import {
  InMemoryExecutionTracker,
  createDefaultExecutionReporters,
} from '../../../src/reporting/index.js';
import { expectNoBetWithin, spinForBet } from '../../support/canvas-bet-flow.js';
import { verifyBetSpinOutcome } from '../../../src/verification/bet-response-verification.js';
import { readBackendSpin } from '../../../src/verification/reel/backend-reader.js';
import type { VerificationResult } from '../../../src/core/models/index.js';

const MANUAL_TEST_ID = 'AT-001' as const;

interface HelpCatalogSymbol {
  readonly id: number;
  readonly name: string;
  readonly kind?: string;
  readonly helpOrder?: number;
  readonly multiplierValue?: number;
}

function loadHelpCatalog(gameId: string): readonly HelpCatalogSymbol[] {
  const catalogPath = path.join(process.cwd(), 'config', 'symbols', gameId, 'catalog.json');
  if (existsSync(catalogPath)) {
    const raw = JSON.parse(readFileSync(catalogPath, 'utf8')) as {
      symbols?: HelpCatalogSymbol[];
    };
    if (!Array.isArray(raw.symbols) || raw.symbols.length === 0) {
      throw new Error(`Empty help/payout catalog: ${catalogPath}`);
    }
    return raw.symbols;
  }

  return loadPackageCatalog(gameId).symbols.map((entry) => ({
    id: entry.id,
    name: entry.name,
    kind: entry.kind,
    multiplierValue: entry.multiplierValue,
    helpOrder: entry.helpOrder,
  }));
}

test.describe('AT — Additional Test', () => {
  requireCapabilities('menu', 'symbolCatalog');

  test(`${MANUAL_TEST_ID} misleading payout guides on Help Screen`, async ({
    sgapSession,
    sgapDriver,
    page,
  }, testInfo) => {
    test.setTimeout(360_000);

    const tracker = new InMemoryExecutionTracker();
    await tracker.start(MANUAL_TEST_ID, testInfo.project.name);

    testInfo.annotations.push(
      { type: 'manualTestId', description: MANUAL_TEST_ID },
      { type: 'category', description: 'AT' },
      { type: 'gameId', description: sgapSession.manifest.gameId },
    );

    let verificationResults: VerificationResult[] = [];

    try {
      await expect(sgapDriver.isAttached()).resolves.toBe(true);
      await expect(sgapSession.menu.isAvailable()).resolves.toBe(true);

      const catalog = loadHelpCatalog(sgapSession.manifest.gameId);
      const catalogIds = catalog.map((entry) => entry.id).sort((a, b) => a - b);
      const uniqueIds = new Set(catalogIds);
      verificationResults.push({
        kind: 'uiSynchronization',
        passed: uniqueIds.size === catalogIds.length,
        message:
          uniqueIds.size === catalogIds.length
            ? `Help/Payout catalog has ${catalogIds.length} unique symbol ids`
            : 'Help/Payout catalog has duplicate symbol ids',
        actual: catalogIds,
      });

      const helpOrders = catalog
        .map((entry) => entry.helpOrder)
        .filter((order): order is number => Number.isInteger(order));
      const uniqueHelp = new Set(helpOrders);
      verificationResults.push({
        kind: 'uiSynchronization',
        passed: helpOrders.length > 0 && uniqueHelp.size === helpOrders.length,
        message:
          helpOrders.length > 0 && uniqueHelp.size === helpOrders.length
            ? `Help-screen order is unique (${helpOrders.length} pay symbols)`
            : 'Help-screen order missing or duplicated — payout guide would be misleading',
        actual: helpOrders,
      });

      const multipliers = catalog
        .filter((entry) => entry.kind === 'multiplier')
        .map((entry) => entry.multiplierValue)
        .filter((value): value is number => Number.isFinite(value))
        .sort((a, b) => a - b);
      const profile = packageProfileFor(sgapSession.manifest);
      if (profile?.multiplierValues === undefined) {
        throw new Error(
          `NOT CONFIGURED — no multiplierValues in the package profile for ${sgapSession.manifest.gameId} (config/packages/<packageId>.json)`,
        );
      }
      const expectedMultipliers = [...profile.multiplierValues];
      const multipliersMatch =
        multipliers.length === expectedMultipliers.length &&
        multipliers.every((value, index) => value === expectedMultipliers[index]);
      verificationResults.push({
        kind: 'win',
        passed: multipliersMatch,
        message: multipliersMatch
          ? `Help/Payout multipliers match ${profile.packageId} (${multipliers.join(',')})`
          : `Help/Payout multipliers mismatch: catalog=${multipliers.join(',')} expected=${expectedMultipliers.join(',')}`,
        expected: expectedMultipliers,
        actual: multipliers,
      });

      const manifestIds = new Set(
        (sgapSession.manifest.reelValidation?.symbols ?? []).map((entry) => entry.id),
      );
      const catalogVsManifest = catalogIds.filter((id) => !manifestIds.has(id));
      verificationResults.push({
        kind: 'uiSynchronization',
        passed: catalogVsManifest.length === 0 && manifestIds.size === uniqueIds.size,
        message:
          catalogVsManifest.length === 0 && manifestIds.size === uniqueIds.size
            ? 'Help/Payout catalog ids match the reel-validation manifest'
            : `Help catalog vs manifest mismatch: extra=${catalogVsManifest.join(',') || 'none'}`,
        actual: catalogVsManifest,
      });

      await sgapDriver.gameCanvas().waitFor({ state: 'visible' });
      await settleCanvasToBaseGame(
        page,
        sgapDriver,
        sgapSession.manifest,
        sgapSession.platform.getInitializeBody(),
      );
      await sgapSession.turbo.enable({ timeoutMs: 15_000 }).catch(() => undefined);

      const openActions = sgapSession.manifest.reelValidation?.helpOpenActions ?? ['menu'];
      const closeActions = sgapSession.manifest.reelValidation?.helpCloseActions ?? [
        'menuClose',
        'menuCloseAlt',
      ];

      const openHelp = async (): Promise<void> => {
        for (const actionName of openActions) {
          await sgapDriver.clickCanvas(actionName, { timeoutMs: 12_000, singleInput: true }).catch(
            () => undefined,
          );
        }
        await sgapSession.menu.open({ timeoutMs: 20_000 }).catch(() => undefined);
      };
      const closeHelp = async (): Promise<void> => {
        for (const actionName of closeActions) {
          await sgapDriver.clickCanvas(actionName, { timeoutMs: 8_000, singleInput: true }).catch(
            () => undefined,
          );
        }
        await sgapSession.menu.close({ timeoutMs: 20_000 }).catch(() => undefined);
        await page.keyboard.press('Escape').catch(() => undefined);
        await clearCanvasOverlays(sgapDriver, sgapSession.manifest, 4, { forceGridSpam: true });
      };

      await openHelp();
      await expectNoBetWithin(page, 2_500);
      verificationResults.push({
        kind: 'stateManagement',
        passed: true,
        message: 'Help Screen open — no /bet (payout guide is not a spin)',
      });
      await closeHelp();

      if (await sgapSession.amplifyBet.isAvailable()) {
        await sgapSession.amplifyBet.enable({ timeoutMs: 15_000 });
        await openHelp();
        await expectNoBetWithin(page, 2_500);
        verificationResults.push({
          kind: 'stateManagement',
          passed: true,
          message: 'Help Screen with Amplify enabled — no /bet (Amplify does not rewrite payouts)',
        });
        await closeHelp();
        await sgapSession.amplifyBet.disable({ timeoutMs: 15_000 });
      }

      await settleCanvasToBaseGame(
        page,
        sgapDriver,
        sgapSession.manifest,
        sgapSession.platform.getInitializeBody(),
      );

      const bet = await spinForBet(sgapSession, sgapDriver, page);
      verificationResults.push(...verifyBetSpinOutcome(bet, { requireCompleted: true }));

      const read = readBackendSpin(bet.raw, {
        areaPath: sgapSession.manifest.reelValidation?.areaPath,
        tumblesPath: sgapSession.manifest.reelValidation?.tumblesPath,
        featureItemsPath: sgapSession.manifest.reelValidation?.featureItemsPath,
        rowOrder: sgapSession.manifest.reelValidation?.rowOrder,
        symbols: sgapSession.manifest.reelValidation?.symbols,
        gameId: sgapSession.manifest.gameId,
      });
      verificationResults.push({
        kind: 'win',
        passed: read.unknownSymbolIds.length === 0,
        message:
          read.unknownSymbolIds.length === 0
            ? `Backend paid only catalog ids (${read.uniqueSymbolIds.join(',') || 'none'})`
            : `Misleading ids vs Help/Payout catalog: unknown=${read.unknownSymbolIds.join(',')}`,
        actual: { unique: read.uniqueSymbolIds, unknown: read.unknownSymbolIds },
      });

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
      await sgapSession.menu.close({ timeoutMs: 8_000 }).catch(() => undefined);
      await sgapSession.amplifyBet.disable({ timeoutMs: 8_000 }).catch(() => undefined);
      await tracker.record({
        manualTestId: MANUAL_TEST_ID,
        status: 'failed',
        startedAt: (await tracker.get(MANUAL_TEST_ID))!.startedAt,
        finishedAt: new Date().toISOString(),
        browserProject: testInfo.project.name,
        errorMessage: message,
        verificationResults,
      });
      throw error;
    } finally {
      await createDefaultExecutionReporters().publish(await tracker.list());
    }
  });
});
