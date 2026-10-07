/**
 * Compare backend reel grid vs frontend visual grid (Column × Row).
 */

import type { VerificationResult } from '../../core/models/index.js';
import type { FrontendReelRead } from './canvas-reel-reader.js';
import type {
  ReelCellComparison,
  ReelGrid,
  ReelValidationReport,
} from './types.js';

export function formatReelValidationReport(
  report: Omit<ReelValidationReport, 'text'>,
): string {
  const lines: string[] = [
    '=== BACKEND vs FRONTEND REEL VALIDATION ===',
    `Grid: ${report.columns} columns × ${report.rows} rows`,
    `Summary: ${report.matchCount} MATCH, ${report.mismatchCount} MISMATCH, ${report.unknownCount} UNKNOWN`,
    '',
  ];

  for (let col = 1; col <= report.columns; col += 1) {
    lines.push(`Column ${col}`);
    const colRows = report.comparisons.filter((entry) => entry.column === col);
    for (const entry of colRows) {
      const frontId =
        entry.frontendSymbolId === undefined ? '-' : String(entry.frontendSymbolId);
      lines.push(
        `Row ${entry.row} | Backend: ${entry.backendSymbol.padEnd(10)} (id ${entry.backendSymbolId}) | Frontend: ${entry.frontendSymbol.padEnd(10)} (id ${frontId}, score ${entry.score.toFixed(2)}) | ${entry.result}`,
      );
    }
    lines.push('');
  }

  lines.push('| Column | Row | Backend Symbol | Frontend Symbol | Result |');
  lines.push('| ------ | --- | -------------- | --------------- | ------ |');
  for (const entry of report.comparisons) {
    lines.push(
      `| ${entry.column} | ${entry.row} | ${entry.backendSymbol} | ${entry.frontendSymbol} | ${entry.result} |`,
    );
  }

  return lines.join('\n');
}

export function compareBackendFrontendReels(
  backend: ReelGrid,
  frontend: FrontendReelRead,
): ReelValidationReport {
  if (backend.columns !== frontend.columns || backend.rows !== frontend.rows) {
    throw new Error(
      `Grid size mismatch: backend ${backend.columns}x${backend.rows} vs frontend ${frontend.columns}x${frontend.rows}`,
    );
  }

  const comparisons: ReelCellComparison[] = [];

  for (let col = 0; col < backend.columns; col += 1) {
    for (let row = 0; row < backend.rows; row += 1) {
      const back = backend.cells[col]![row]!;
      const front = frontend.cells[col]![row]!;
      let result: ReelCellComparison['result'];
      if (front.symbolId === undefined) {
        result = 'UNKNOWN_FRONTEND';
      } else if (front.symbolId === back.symbolId) {
        result = 'MATCH';
      } else {
        result = 'MISMATCH';
      }
      comparisons.push({
        column: back.column,
        row: back.row,
        backendSymbolId: back.symbolId,
        backendSymbol: back.symbolName,
        frontendSymbolId: front.symbolId,
        frontendSymbol: front.symbolName,
        score: front.score,
        result,
      });
    }
  }

  const matchCount = comparisons.filter((entry) => entry.result === 'MATCH').length;
  const mismatchCount = comparisons.filter((entry) => entry.result === 'MISMATCH').length;
  const unknownCount = comparisons.filter(
    (entry) => entry.result === 'UNKNOWN_FRONTEND',
  ).length;

  const partial = {
    columns: backend.columns,
    rows: backend.rows,
    comparisons,
    matchCount,
    mismatchCount,
    unknownCount,
    passed: mismatchCount === 0 && unknownCount === 0,
  };

  return { ...partial, text: formatReelValidationReport(partial) };
}

export function reelReportToVerificationResults(
  report: ReelValidationReport,
): VerificationResult[] {
  const results: VerificationResult[] = [
    {
      kind: 'uiSynchronization',
      passed: report.passed,
      message: report.passed
        ? `Backend matches frontend for all ${report.columns * report.rows} cells (${report.columns}x${report.rows})`
        : `Reel mismatch: ${report.mismatchCount} MISMATCH, ${report.unknownCount} UNKNOWN of ${report.columns * report.rows}`,
      expected: 'all cells MATCH',
      actual: {
        matchCount: report.matchCount,
        mismatchCount: report.mismatchCount,
        unknownCount: report.unknownCount,
      },
    },
  ];

  for (const entry of report.comparisons.filter((cell) => cell.result !== 'MATCH')) {
    results.push({
      kind: 'uiSynchronization',
      passed: false,
      message: `Column ${entry.column} Row ${entry.row}: Backend ${entry.backendSymbol} vs Frontend ${entry.frontendSymbol} → ${entry.result}`,
      expected: entry.backendSymbol,
      actual: entry.frontendSymbol,
    });
  }

  return results;
}
