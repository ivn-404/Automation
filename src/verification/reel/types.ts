/**
 * Reel validation report types (runtime comparison output).
 * Config types live on GameManifest (core/models).
 */

export type {
  NormalizedRect,
  ReelSymbolDef,
  ReelSymbolKind,
  ReelValidationConfig,
} from '../../core/models/index.js';

export interface ReelCell {
  readonly column: number;
  readonly row: number;
  readonly symbolId: number;
  readonly symbolName: string;
}

export interface ReelGrid {
  readonly columns: number;
  readonly rows: number;
  /** cells[columnIndex][rowIndex] — visual top row is index 0 after rowOrder apply */
  readonly cells: ReadonlyArray<ReadonlyArray<ReelCell>>;
}

export type ReelCellCompareResult = 'MATCH' | 'MISMATCH' | 'UNKNOWN_FRONTEND';

export interface ReelCellComparison {
  readonly column: number;
  readonly row: number;
  readonly backendSymbolId: number;
  readonly backendSymbol: string;
  readonly frontendSymbolId: number | undefined;
  readonly frontendSymbol: string;
  readonly score: number;
  readonly result: ReelCellCompareResult;
}

export interface ReelValidationReport {
  readonly columns: number;
  readonly rows: number;
  readonly comparisons: readonly ReelCellComparison[];
  readonly matchCount: number;
  readonly mismatchCount: number;
  readonly unknownCount: number;
  readonly passed: boolean;
  readonly text: string;
}
