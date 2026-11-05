/**
 * CSF-011 — Core Spin Flow
 *
 * Manual Test Case ID: CSF-011
 * Intent: Normal mode multiplier — only for titles whose base game carries multipliers
 * (QA: packages 2, 3, 5, 6, 7, 8, 11; see docs/catalogs/ALL_GAMES.MD). Applicability is game config:
 * manifest `metadata.normalModeMultiplier: "true"` plus `metadata.normalModeMultiplierPath`,
 * the bet-response path of the multiplier the server applied. Other titles skip.
 * The path may fan out with `[]` (e.g. `slot.paylines[].multipliers`); each entry is either a
 * number or `{ symbol, count }` priced by the symbol's `multiplierValue`.
 *
 * When applicable: a base-game spin that lands a multiplier symbol, wins and reports an applied
 * multiplier must report a multiplier > 1 and credit a positive total win.
 *
 * `metadata.normalModeMultiplierMode: "position"` is the other shape. The multiplier is the
 * background on a winning cell, not a reel symbol. `spinForBet` waits for the completed
 * `/bet`, whose tumbles are already in order, so the check replays that settled cascade
 * instead of reading the art while it is still moving.
 *
 * `metadata.normalModeMultiplierMode: "tumble"` is a per-cascade ladder: the path reads one
 * multiplier per tumble and `metadata.normalModeTumbleMultipliers` lists the expected values
 * in order (the last one repeats). A winning cascade must climb past 1 on that ladder.
 *
 * `metadata.normalModeMultiplierMode: "reel"` is a multiplier under each reel that wilds raise.
 * The path is the tumble array; every ways win must pay the sum of the raised multipliers on
 * the reels it covers (1 when none is raised) and `pay × ways × multiplier`.
 */

import { test, expect } from '../../fixtures/index.js';
import { requireCapabilities } from '../../support/capabilities.js';
import { settleCanvasToBaseGame } from '../../../src/platform/index.js';
import {
  InMemoryExecutionTracker,
  createDefaultExecutionReporters,
} from '../../../src/reporting/index.js';
import { getByPath } from '../../../src/shared/json-path.js';
import {
  checkPositionMultiplierProgress,
  readTumbleClusterWins,
} from '../../../src/verification/position-multiplier.js';
import {
  checkReelMultiplierWins,
  readReelMultiplierWins,
  type ReelMultiplierStep,
} from '../../../src/verification/reel-multiplier.js';
import { readBackendSpin } from '../../../src/verification/reel/backend-reader.js';
import { loadPackageCatalog } from '../../../src/verification/reel/package-catalog.js';
import { spinForBet } from '../../support/canvas-bet-flow.js';
import { prepareCanvasTurbo } from '../../support/canvas-bet-control.js';
import { ensureBaseHud } from '../../support/session-guard.js';
import type {
  BetResponseSnapshot,
  ReelSymbolDef,
  VerificationResult,
} from '../../../src/core/models/index.js';

const MANUAL_TEST_ID = 'CSF-011' as const;
/** Package 3 multipliers often sit in tumble in/out, not the final area; 25 was too thin. */
const DEFAULT_MAX_SPINS = 120;

function maxSpins(metadata: Readonly<Record<string, string>>): number {
  const parsed = Number(metadata.normalModeMultiplierMaxSpins);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_SPINS;
}

test.describe('CSF — Core Spin Flow', () => {
  // QA scopes CSF-011 to packages 2, 3, 5, 6, 7, 8, 11.
  requireCapabilities('normalModeMultiplier');

  test(`${MANUAL_TEST_ID} normal mode multiplier`, async ({
    sgapSession,
    sgapDriver,
    page,
  }, testInfo) => {
    test.setTimeout(1_800_000);

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
      const positionMode = metadata.normalModeMultiplierMode === 'position';
      const tumbleMode = metadata.normalModeMultiplierMode === 'tumble';
      const reelMode = metadata.normalModeMultiplierMode === 'reel';
      const tumbleLadder = (metadata.normalModeTumbleMultipliers ?? '')
        .split(',')
        .map(Number)
        .filter((value) => Number.isFinite(value) && value > 0);
      const tumblesPath = metadata.normalModePositionTumblesPath;
      const multiplierPath = metadata.normalModeMultiplierPath;
      const symbols = reel?.symbols ?? catalogSymbols(sgapSession.manifest.gameId);
      const multiplierValues = new Map(
        symbols
          .filter((symbol) => symbol.kind === 'multiplier' || (symbol.multiplierValue ?? 0) > 1)
          .map((symbol) => [symbol.id, symbol.multiplierValue ?? Number.NaN] as const),
      );
      const multiplierIds = new Set(multiplierValues.keys());
      const missingConfig = [
        sgapSession.supports('spin') ? undefined : 'spin controller',
        positionMode
          ? tumblesPath !== undefined
            ? undefined
            : 'metadata.normalModePositionTumblesPath'
          : reelMode
            ? undefined
          : tumbleMode
            ? tumbleLadder.length > 0
              ? undefined
              : 'metadata.normalModeTumbleMultipliers'
            : multiplierIds.size > 0
              ? undefined
              : 'multiplier symbols (reelValidation or package catalog)',
        multiplierPath !== undefined ? undefined : 'metadata.normalModeMultiplierPath',
      ].filter((item): item is string => item !== undefined);
      verificationResults.push({
        kind: 'bet',
        passed: missingConfig.length === 0,
        message:
          missingConfig.length === 0
            ? positionMode
              ? `Config: position backgrounds replayed from "${tumblesPath}"`
              : reelMode
                ? `Config: reel multipliers summed per ways win from "${multiplierPath}"`
              : tumbleMode
                ? `Config: tumble ladder ${tumbleLadder.join(',')} read at "${multiplierPath}"`
                : `Config: ${multiplierIds.size} multiplier symbols, applied multiplier at "${multiplierPath}"`
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
      await prepareCanvasTurbo(sgapSession, sgapDriver, page);
      await sgapSession.turbo.enable({ timeoutMs: 15_000 }).catch(() => undefined);

      const spinBudget = maxSpins(metadata);
      let hit: { bet: BetResponseSnapshot; landed: number[]; applied: number[]; spin: number } | undefined;
      let positionMismatch = false;
      let positionHit:
        | { bet: BetResponseSnapshot; spin: number; applied: number; contributors: readonly number[] }
        | undefined;
      let tumbleMismatch = false;
      let tumbleHit: { bet: BetResponseSnapshot; spin: number; applied: readonly number[] } | undefined;
      let reelMismatch = false;
      let reelHit: { bet: BetResponseSnapshot; spin: number; step: ReelMultiplierStep } | undefined;
      let reelSingleHit: typeof reelHit;
      let reelWinsChecked = 0;
      for (
        let spin = 1;
        spin <= spinBudget &&
        hit === undefined &&
        positionHit === undefined &&
        tumbleHit === undefined &&
        reelHit === undefined;
        spin += 1
      ) {
        const bet = await spinForBet(sgapSession, sgapDriver, page);
        if (reelMode) {
          const steps = checkReelMultiplierWins(readReelMultiplierWins(bet.raw, multiplierPath!));
          reelWinsChecked += steps.length;
          const mismatch = steps.find((step) => !step.ok);
          if (mismatch !== undefined) {
            reelMismatch = true;
            await testInfo.attach('multiplier-mismatch.json', {
              body: JSON.stringify(bet.raw, null, 2),
              contentType: 'application/json',
            });
            verificationResults.push({
              kind: 'win',
              passed: false,
              message:
                `Spin ${spin} tumble ${mismatch.tumble}: symbol ${mismatch.symbol} across ${mismatch.columns} reels ` +
                `(reel multipliers ${mismatch.reels.join('|')}) paid ${mismatch.applied}× / ${mismatch.win}, ` +
                `expected ${mismatch.expected}× / ${mismatch.expectedWin} (pay ${mismatch.pay} × ways ${mismatch.ways})`,
              expected: { multiplier: mismatch.expected, win: mismatch.expectedWin },
              actual: { multiplier: mismatch.applied, win: mismatch.win },
            });
            break;
          }
          // A win over two or more raised reels shows the multipliers adding; keep a
          // single-reel hit as the fallback until one lands or the budget runs out.
          const multiplied =
            steps.find((step) => step.contributors.length > 1 && step.applied > 1) ??
            steps.find((step) => step.contributors.length > 0 && step.applied > 1);
          if (multiplied !== undefined && Number(bet.win?.amount ?? 0) > 0) {
            if (multiplied.contributors.length > 1) {
              reelHit = { bet, spin, step: multiplied };
            } else {
              reelSingleHit ??= { bet, spin, step: multiplied };
            }
          }
          if (spin === spinBudget && reelHit === undefined) {
            reelHit = reelSingleHit;
          }
          continue;
        }
        if (tumbleMode) {
          const applied = fanOut(bet.raw, multiplierPath!.split('[]')).map(Number);
          const wrong = applied.findIndex(
            (value, index) => value !== tumbleLadder[Math.min(index, tumbleLadder.length - 1)],
          );
          if (wrong >= 0) {
            tumbleMismatch = true;
            verificationResults.push({
              kind: 'win',
              passed: false,
              message: `Spin ${spin} tumble ${wrong + 1} applied ${applied[wrong]}× but the ladder says ${tumbleLadder[Math.min(wrong, tumbleLadder.length - 1)]}×`,
              expected: tumbleLadder.slice(0, applied.length),
              actual: applied,
            });
            break;
          }
          if (applied.some((value) => value > 1) && Number(bet.win?.amount ?? 0) > 0) {
            tumbleHit = { bet, spin, applied };
          }
          continue;
        }
        if (positionMode) {
          const steps = checkPositionMultiplierProgress(readTumbleClusterWins(bet.raw, tumblesPath!));
          const mismatch = steps.find((step) => !step.ok);
          if (mismatch !== undefined) {
            positionMismatch = true;
            verificationResults.push({
              kind: 'win',
              passed: false,
              message: `Spin ${spin} paid ${mismatch.applied}× but the winning cells already above 1 sum to ${mismatch.expected}`,
              expected: mismatch.expected,
              actual: mismatch.applied,
            });
            break;
          }
          const progressed = steps.find((step) => step.applied > 1 && step.contributors.length > 0);
          if (progressed !== undefined && Number(bet.win?.amount ?? 0) > 0) {
            positionHit = {
              bet,
              spin,
              applied: progressed.applied,
              contributors: progressed.contributors,
            };
          }
          continue;
        }
        const read = readBackendSpin(bet.raw, {
          symbols,
          areaPath: reel?.areaPath,
          tumblesPath: reel?.tumblesPath,
          rowOrder: reel?.rowOrder,
          areaLayout: reel?.areaLayout,
          gameId: sgapSession.manifest.gameId,
        });
        const baseBoards =
          read.spinGroups.find((group) => group.key === 'main' || group.key === 'opener')?.boards ??
          read.boards;
        const landed = [
          ...new Set([
            ...baseBoards.flatMap((board) => board.ids.flat()),
            ...reportedMultiplierSymbols(bet.raw, multiplierPath!, multiplierIds),
          ]),
        ].filter((id) => multiplierIds.has(id));
        const applied = appliedMultipliers(bet.raw, multiplierPath!, multiplierValues);
        if (landed.length > 0 && applied.length > 0 && Number(bet.win?.amount ?? 0) > 0) {
          hit = { bet, landed, applied, spin };
        }
      }
      if (reelMode) {
        if (!reelMismatch) {
          verificationResults.push({
            kind: 'win',
            passed: reelHit !== undefined,
            message:
              reelHit !== undefined
                ? `Spin ${reelHit.spin} tumble ${reelHit.step.tumble}: reel multipliers ${reelHit.step.reels.join('|')} ` +
                  `summed ${reelHit.step.contributors.join('+')} = ${reelHit.step.applied}× on a ${reelHit.step.columns}-reel win ` +
                  `(${reelHit.step.pay} × ${reelHit.step.ways} ways × ${reelHit.step.applied} = ${reelHit.step.win}); ` +
                  `${reelWinsChecked} ways win(s) checked`
                : `No winning base spin in ${spinBudget} spins paid a raised reel multiplier (${reelWinsChecked} ways win(s) checked, all correct)`,
            actual: reelHit?.step,
          });
        }
      } else if (tumbleMode) {
        if (!tumbleMismatch) {
          verificationResults.push({
            kind: 'win',
            passed: tumbleHit !== undefined,
            message:
              tumbleHit !== undefined
                ? `Spin ${tumbleHit.spin} cascaded through ${tumbleHit.applied.join('→')}× on the tumble ladder`
                : `No winning cascade in ${spinBudget} spins reached a tumble above 1×`,
            actual: tumbleHit?.applied,
          });
        }
      } else if (positionMode && !positionMismatch) {
        verificationResults.push({
          kind: 'win',
          passed: positionHit !== undefined,
          message:
            positionHit !== undefined
              ? `Spin ${positionHit.spin} paid ${positionHit.applied}× from cells already at ${positionHit.contributors.join('+')} after earlier wins in that cascade`
              : `No cascade in ${spinBudget} spins paid a cell that had already won`,
          actual: positionHit?.contributors,
        });
      } else {
        verificationResults.push({
          kind: 'win',
          passed: hit !== undefined,
          message:
            hit !== undefined
              ? `Base spin ${hit.spin} landed multiplier symbol(s) ${hit.landed.join(',')} on a win`
              : `No winning base spin with a multiplier symbol in ${spinBudget} spins`,
        });
      }

      if (reelHit !== undefined) {
        const win = Number(reelHit.bet.win?.amount ?? 'NaN');
        await testInfo.attach('multiplier-spin.json', {
          body: JSON.stringify(reelHit.bet.raw, null, 2),
          contentType: 'application/json',
        });
        verificationResults.push({
          kind: 'win',
          passed: Number.isFinite(win) && win > 0,
          message: `Multiplied base win credited: ${win}`,
          actual: win,
        });
      } else if (tumbleHit !== undefined) {
        const win = Number(tumbleHit.bet.win?.amount ?? 'NaN');
        await testInfo.attach('multiplier-spin.json', {
          body: JSON.stringify(tumbleHit.bet.raw, null, 2),
          contentType: 'application/json',
        });
        verificationResults.push({
          kind: 'win',
          passed: Number.isFinite(win) && win > 0,
          message: `Multiplied base win credited: ${win}`,
          actual: win,
        });
      } else if (positionHit !== undefined) {
        const win = Number(positionHit.bet.win?.amount ?? 'NaN');
        await testInfo.attach('multiplier-spin.json', {
          body: JSON.stringify(positionHit.bet.raw, null, 2),
          contentType: 'application/json',
        });
        verificationResults.push({
          kind: 'win',
          passed: positionHit.applied > 1 && positionHit.contributors.every((value) => value > 1),
          message: `Position backgrounds ${positionHit.contributors.join('+')} paid ${positionHit.applied}×`,
          actual: positionHit.applied,
        });
        verificationResults.push({
          kind: 'win',
          passed: Number.isFinite(win) && win > 0,
          message: `Multiplied base win credited: ${win}`,
          actual: win,
        });
      } else if (hit !== undefined) {
        const { applied } = hit;
        const win = Number(hit.bet.win?.amount ?? 'NaN');
        await testInfo.attach('multiplier-spin.json', {
          body: JSON.stringify(hit.bet.raw, null, 2),
          contentType: 'application/json',
        });
        verificationResults.push({
          kind: 'win',
          passed: applied.every((value) => Number.isFinite(value) && value > 1),
          message: `Server applied multiplier ${applied.join(', ')} (${multiplierPath})`,
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

function catalogSymbols(gameId: string): readonly ReelSymbolDef[] {
  try {
    return loadPackageCatalog(gameId).symbols;
  } catch {
    return [];
  }
}

/** Ids the server listed on the applied-multiplier object (sibling of `.total`). */
function reportedMultiplierSymbols(
  body: unknown,
  path: string,
  multiplierIds: ReadonlySet<number>,
): number[] {
  const node = getByPath(body, path.replace(/\.total$/u, '.symbols'));
  const ids: number[] = [];
  const walk = (value: unknown): void => {
    if (typeof value === 'number' && Number.isInteger(value)) {
      ids.push(value);
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        walk(item);
      }
      return;
    }
    if (value !== null && typeof value === 'object' && 'symbol' in value) {
      const parsed = Number((value as { symbol: unknown }).symbol);
      if (Number.isInteger(parsed)) {
        ids.push(parsed);
      }
    }
  };
  walk(node);
  return ids.filter((id) => multiplierIds.has(id));
}

function fanOut(value: unknown, segments: readonly string[]): unknown[] {
  const [head = '', ...rest] = segments;
  const key = head.replace(/^\./u, '');
  const node = key === '' ? value : getByPath(value, key);
  if (rest.length === 0) {
    return [node];
  }
  return Array.isArray(node) ? node.flatMap((item) => fanOut(item, rest)) : [];
}

function multiplierOf(entry: unknown, values: ReadonlyMap<number, number>): number {
  if (entry !== null && typeof entry === 'object' && 'symbol' in entry) {
    const { symbol, count } = entry as { symbol: unknown; count?: unknown };
    return (values.get(Number(symbol)) ?? Number.NaN) * Number(count ?? 1);
  }
  return Number(entry);
}

/** One applied multiplier per resolved entry; empty lists (no multiplier on that line) are dropped. */
function appliedMultipliers(body: unknown, path: string, values: ReadonlyMap<number, number>): number[] {
  return fanOut(body, path.split('[]')).flatMap((node) => {
    if (!Array.isArray(node)) {
      const value = Number(node);
      return Number.isFinite(value) && value > 1 ? [value] : [];
    }
    if (node.length === 0) {
      return [];
    }
    // Multipliers on one line add together (Package 2 spec).
    return [node.reduce<number>((sum, entry) => sum + multiplierOf(entry, values), 0)];
  });
}
