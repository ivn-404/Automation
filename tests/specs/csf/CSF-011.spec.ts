/**
 * CSF-011 — Core Spin Flow
 *
 * Manual Test Case ID: CSF-011
 * Intent: Normal mode multiplier — only for titles whose base game carries multipliers
 * (QA: packages 2, 3, 5, 6, 7, 8, 11; see docs/ALL_GAMES.MD). Applicability is game config:
 * manifest `metadata.normalModeMultiplier: "true"` plus `metadata.normalModeMultiplierPath`,
 * the bet-response path of the multiplier the server applied. Other titles skip.
 *
 * When applicable: a base-game spin that lands a multiplier symbol and wins must report a
 * multiplier > 1 and credit a positive total win.
 */

import { test, expect } from '../../fixtures/index.js';
import { requireCapabilities } from '../../support/capabilities.js';
import { settleCanvasToBaseGame } from '../../../src/platform/index.js';
import {
  InMemoryExecutionTracker,
  createDefaultExecutionReporters,
} from '../../../src/reporting/index.js';
import { getByPath } from '../../../src/shared/json-path.js';
import { readBackendSpin } from '../../../src/verification/reel/backend-reader.js';
import { spinForBet } from '../../support/canvas-bet-flow.js';
import { ensureBaseHud } from '../../support/session-guard.js';
import type { BetResponseSnapshot, VerificationResult } from '../../../src/core/models/index.js';

const MANUAL_TEST_ID = 'CSF-011' as const;
const MAX_SPINS = 25;

test.describe('CSF — Core Spin Flow', () => {
  // QA scopes CSF-011 to packages 2, 3, 5, 6, 7, 8, 11.
  requireCapabilities('normalModeMultiplier');

  test(`${MANUAL_TEST_ID} normal mode multiplier`, async ({
    sgapSession,
    sgapDriver,
    page,
  }, testInfo) => {
    test.setTimeout(900_000);

    const metadata = sgapSession.manifest.metadata ?? {};

    const tracker = new InMemoryExecutionTracker();
    await tracker.start(MANUAL_TEST_ID, testInfo.project.name);

    testInfo.annotations.push(
      { type: 'manualTestId', description: MANUAL_TEST_ID },
      { type: 'category', description: 'CSF' },
      { type: 'gameId', description: sgapSession.manifest.gameId },
    );

    let verificationResults: VerificationResult[] = [];

    try {
      await expect(sgapDriver.isAttached()).resolves.toBe(true);
      const reel = sgapSession.manifest.reelValidation;
      const multiplierPath = metadata.normalModeMultiplierPath;
      const multiplierIds = new Set(
        (reel?.symbols ?? []).filter((symbol) => symbol.kind === 'multiplier').map((symbol) => symbol.id),
      );
      const missingConfig = [
        sgapSession.supports('spin') ? undefined : 'spin controller',
        multiplierIds.size > 0 ? undefined : 'reelValidation multiplier symbols',
        multiplierPath !== undefined ? undefined : 'metadata.normalModeMultiplierPath',
      ].filter((item): item is string => item !== undefined);
      verificationResults.push({
        kind: 'bet',
        passed: missingConfig.length === 0,
        message:
          missingConfig.length === 0
            ? `Config: ${multiplierIds.size} multiplier symbols, applied multiplier at "${multiplierPath}"`
            : `${sgapSession.manifest.displayName} has a normal-mode multiplier but its manifest lacks: ${missingConfig.join(', ')}`,
      });
      expect(verificationResults[0]!.passed, verificationResults[0]!.message).toBe(true);

      await sgapDriver.gameCanvas().waitFor({ state: 'visible' });
      await ensureBaseHud(sgapSession, sgapDriver, page);
      await settleCanvasToBaseGame(
        page,
        sgapDriver,
        sgapSession.manifest,
        sgapSession.platform.getInitializeBody(),
      );
      await sgapSession.turbo.enable({ timeoutMs: 15_000 }).catch(() => undefined);

      let hit: { bet: BetResponseSnapshot; landed: number[]; spin: number } | undefined;
      for (let spin = 1; spin <= MAX_SPINS && hit === undefined; spin += 1) {
        const bet = await spinForBet(sgapSession, sgapDriver, page);
        const read = readBackendSpin(bet.raw, {
          symbols: reel!.symbols,
          areaPath: reel!.areaPath,
          tumblesPath: reel!.tumblesPath,
          rowOrder: reel!.rowOrder,
        });
        const landed = read.boards.flatMap((board) => board.ids.flat()).filter((id) => multiplierIds.has(id));
        if (landed.length > 0 && Number(bet.win?.amount ?? 0) > 0) {
          hit = { bet, landed, spin };
        }
      }
      verificationResults.push({
        kind: 'win',
        passed: hit !== undefined,
        message:
          hit !== undefined
            ? `Base spin ${hit.spin} landed multiplier symbol(s) ${hit.landed.join(',')} on a win`
            : `No winning base spin with a multiplier symbol in ${MAX_SPINS} spins`,
      });

      if (hit !== undefined) {
        const applied = Number(getByPath(hit.bet.raw, multiplierPath!));
        const win = Number(hit.bet.win?.amount ?? 'NaN');
        await testInfo.attach('multiplier-spin.json', {
          body: JSON.stringify(hit.bet.raw, null, 2),
          contentType: 'application/json',
        });
        verificationResults.push({
          kind: 'win',
          passed: Number.isFinite(applied) && applied > 1,
          message: `Server applied multiplier ${applied} (${multiplierPath})`,
          actual: applied,
        });
        verificationResults.push({
          kind: 'win',
          passed: Number.isFinite(win) && win > 0,
          message: `Multiplied base win credited: ${win}`,
          actual: win,
        });
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
