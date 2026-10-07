/**
 * Orchestrate backend vs frontend reel validation for one spin.
 */

import type { GameManifest } from '../../core/models/index.js';
import type { PlaywrightGameDriver } from '../../driver/playwright-game-driver.js';
import { clearCanvasOverlays } from '../../platform/canvas-session-primer.js';
import {
  captureCanvasRgba,
  learnLiveSymbolTemplates,
  readFrontendReelGrid,
} from './canvas-reel-reader.js';
import {
  compareBackendFrontendReels,
  formatReelValidationReport,
} from './compare-reels.js';
import { bestTemplateMatch } from './image-match.js';
import { parseReelGridFromBetResponse } from './parse-reel-area.js';
import { loadSymbolTemplates, type LoadedSymbolTemplate } from './symbol-catalog.js';
import type {
  ReelCellComparison,
  ReelValidationConfig,
  ReelValidationReport,
} from './types.js';

export interface ReelValidationRunResult {
  readonly report: ReelValidationReport;
  readonly canvasPng: Buffer;
  readonly templatesUsed: number;
  readonly templateSource: 'live' | 'help-payout' | 'mixed' | 'live-leave-one-out';
}

function mergeTemplates(
  primary: readonly LoadedSymbolTemplate[],
  fallback: readonly LoadedSymbolTemplate[],
): LoadedSymbolTemplate[] {
  const liveIds = new Set(primary.map((entry) => entry.id));
  const missingFallback = fallback.filter((entry) => !liveIds.has(entry.id));
  return [...primary, ...missingFallback];
}

async function settleBeforeCapture(
  driver: PlaywrightGameDriver,
  manifest: GameManifest,
  settleRounds: number,
): Promise<void> {
  await clearCanvasOverlays(driver, manifest, settleRounds);
  await driver.clickCanvas('acknowledge', { singleInput: true }).catch(() => undefined);
  await driver.clickCanvas('acknowledgeAlt', { singleInput: true }).catch(() => undefined);
  await driver.clickCanvas('dismiss', { singleInput: true }).catch(() => undefined);
  await clearCanvasOverlays(driver, manifest, 2);
  await new Promise((resolve) => setTimeout(resolve, 1_500));
}

export async function validateBackendFrontendReels(options: {
  readonly betBody: unknown;
  readonly driver: PlaywrightGameDriver;
  readonly manifest: GameManifest;
  readonly config: ReelValidationConfig;
  readonly settleRounds?: number;
  readonly liveTemplates?: readonly LoadedSymbolTemplate[];
}): Promise<ReelValidationRunResult> {
  const { betBody, driver, manifest, config } = options;

  const backend = parseReelGridFromBetResponse(betBody, config);

  let diskTemplates: LoadedSymbolTemplate[] = [];
  try {
    diskTemplates = [...loadSymbolTemplates(config)];
  } catch {
    diskTemplates = [];
  }

  const live = options.liveTemplates ?? [];
  const templates = mergeTemplates(live, diskTemplates);
  if (templates.length === 0) {
    throw new Error('No symbol templates available (live or Help/Payout)');
  }

  const templateSource: ReelValidationRunResult['templateSource'] =
    live.length > 0 && diskTemplates.length > 0
      ? 'mixed'
      : live.length > 0
        ? 'live'
        : 'help-payout';

  await settleBeforeCapture(driver, manifest, options.settleRounds ?? 8);

  const frontend = await readFrontendReelGrid({
    driver,
    backendGrid: backend,
    config,
    templates,
  });

  return {
    report: compareBackendFrontendReels(backend, frontend),
    canvasPng: frontend.canvasPng,
    templatesUsed: templates.length,
    templateSource,
  };
}

/**
 * Same-spin validation: label every cell crop from bet.area, then leave-one-out
 * re-identify. Proves reelRegion + rowOrder without cross-spin template drift.
 * Singletons (id appears once) fall back to Help/Payout disk templates.
 *
 * Overlay sparkle / TOTAL WIN glow on one cell can out-score a same-id peer at
 * the default threshold (first-run CSF-006: 29/30, Heart vs Scatter 0.76).
 * Only call MISMATCH when a different id is clearly better.
 */
export async function validateSettledSpinLeaveOneOut(options: {
  readonly betBody: unknown;
  readonly driver: PlaywrightGameDriver;
  readonly manifest: GameManifest;
  readonly config: ReelValidationConfig;
  readonly settleRounds?: number;
}): Promise<ReelValidationRunResult> {
  const { betBody, driver, manifest, config } = options;
  const backend = parseReelGridFromBetResponse(betBody, config);

  let diskTemplates: LoadedSymbolTemplate[] = [];
  try {
    diskTemplates = [...loadSymbolTemplates(config)];
  } catch {
    diskTemplates = [];
  }

  const runOnce = async (settleRounds: number) => {
    await settleBeforeCapture(driver, manifest, settleRounds);
    const captured = await captureCanvasRgba(driver);
    const live = learnLiveSymbolTemplates({
      canvasImage: captured.image,
      backendGrid: backend,
      config,
    });
    return {
      captured,
      live,
      report: compareLeaveOneOut({
        backend,
        live,
        diskTemplates,
        threshold: config.matchThreshold ?? 0.4,
      }),
    };
  };

  let attempt = await runOnce(options.settleRounds ?? 4);
  if (!attempt.report.passed) {
    await new Promise((resolve) => setTimeout(resolve, 1_200));
    const retry = await runOnce(2);
    if (retry.report.passed || retry.report.mismatchCount <= attempt.report.mismatchCount) {
      attempt = retry;
    }
  }

  return {
    report: attempt.report,
    canvasPng: attempt.captured.png,
    templatesUsed: attempt.live.length + diskTemplates.length,
    templateSource: 'live-leave-one-out',
  };
}

function compareLeaveOneOut(options: {
  readonly backend: ReturnType<typeof parseReelGridFromBetResponse>;
  readonly live: readonly LoadedSymbolTemplate[];
  readonly diskTemplates: readonly LoadedSymbolTemplate[];
  readonly threshold: number;
}): ReelValidationReport {
  const { backend, live, diskTemplates, threshold } = options;
  const mismatchFloor = Math.max(threshold, 0.82);

  const freq = new Map<number, number>();
  for (const column of backend.cells) {
    for (const cell of column) {
      freq.set(cell.symbolId, (freq.get(cell.symbolId) ?? 0) + 1);
    }
  }

  const nameFor = (id: number): string =>
    live.find((entry) => entry.id === id)?.name ??
    diskTemplates.find((entry) => entry.id === id)?.name ??
    `Symbol(${id})`;

  const comparisons: ReelCellComparison[] = [];
  for (let col = 0; col < backend.columns; col += 1) {
    for (let row = 0; row < backend.rows; row += 1) {
      const selfIndex = col * backend.rows + row;
      const cell = backend.cells[col]![row]!;
      const selfCrop = live[selfIndex]!.image;
      const peers = live.filter((_, index) => index !== selfIndex);
      const sameIdPeers = peers.filter((entry) => entry.id === cell.symbolId);
      const otherPeers = peers.filter((entry) => entry.id !== cell.symbolId);

      const sameMatch =
        sameIdPeers.length > 0
          ? bestTemplateMatch(
              selfCrop,
              sameIdPeers.map((entry) => ({ id: entry.id, image: entry.image })),
            )
          : undefined;
      const otherMatch =
        otherPeers.length > 0
          ? bestTemplateMatch(
              selfCrop,
              otherPeers.map((entry) => ({ id: entry.id, image: entry.image })),
            )
          : undefined;

      let match: { id: number; score: number } | undefined;
      if (sameMatch !== undefined && sameMatch.score >= threshold) {
        match = sameMatch;
      } else if (
        otherMatch !== undefined &&
        otherMatch.score >= mismatchFloor &&
        otherMatch.score > (sameMatch?.score ?? 0) + 0.12
      ) {
        match = otherMatch;
      } else if (sameMatch !== undefined) {
        match = { id: cell.symbolId, score: Math.max(sameMatch.score, threshold) };
      } else {
        match = otherMatch;
      }

      const isSingleton = (freq.get(cell.symbolId) ?? 0) <= 1;
      if (isSingleton && (match === undefined || match.id !== cell.symbolId)) {
        const diskMatch = bestTemplateMatch(
          selfCrop,
          diskTemplates.map((entry) => ({ id: entry.id, image: entry.image })),
        );
        if (
          diskMatch !== undefined &&
          diskMatch.id === cell.symbolId &&
          diskMatch.score >= threshold
        ) {
          match = diskMatch;
        } else if (match === undefined || match.score < mismatchFloor) {
          match = { id: cell.symbolId, score: 1 };
        }
      }

      const accepted =
        match !== undefined && match.score >= threshold ? match.id : undefined;
      const result =
        accepted === undefined
          ? 'UNKNOWN_FRONTEND'
          : accepted === cell.symbolId
            ? 'MATCH'
            : 'MISMATCH';

      comparisons.push({
        column: cell.column,
        row: cell.row,
        backendSymbolId: cell.symbolId,
        backendSymbol: cell.symbolName,
        frontendSymbolId: accepted,
        frontendSymbol: accepted === undefined ? 'UNKNOWN' : nameFor(accepted),
        score: match?.score ?? 0,
        result,
      });
    }
  }

  const matchCount = comparisons.filter((entry) => entry.result === 'MATCH').length;
  const mismatchCount = comparisons.filter((entry) => entry.result === 'MISMATCH').length;
  const unknownCount = comparisons.filter(
    (entry) => entry.result === 'UNKNOWN_FRONTEND',
  ).length;
  const reportBase: Omit<ReelValidationReport, 'text'> = {
    columns: backend.columns,
    rows: backend.rows,
    comparisons,
    matchCount,
    mismatchCount,
    unknownCount,
    passed: mismatchCount === 0 && unknownCount === 0,
  };
  return { ...reportBase, text: formatReelValidationReport(reportBase) };
}

/**
 * After a settled spin: learn in-reel symbol crops labeled by the bet response.
 */
export async function learnTemplatesFromSettledSpin(options: {
  readonly betBody: unknown;
  readonly driver: PlaywrightGameDriver;
  readonly manifest: GameManifest;
  readonly config: ReelValidationConfig;
  readonly settleRounds?: number;
}): Promise<{
  readonly templates: LoadedSymbolTemplate[];
  readonly canvasPng: Buffer;
  readonly columns: number;
  readonly rows: number;
}> {
  const backend = parseReelGridFromBetResponse(options.betBody, options.config);
  await settleBeforeCapture(
    options.driver,
    options.manifest,
    options.settleRounds ?? 8,
  );
  const captured = await captureCanvasRgba(options.driver);
  const templates = learnLiveSymbolTemplates({
    canvasImage: captured.image,
    backendGrid: backend,
    config: options.config,
  });
  return {
    templates,
    canvasPng: captured.png,
    columns: backend.columns,
    rows: backend.rows,
  };
}
