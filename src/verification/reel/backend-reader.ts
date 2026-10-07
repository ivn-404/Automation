/**
 * Package-agnostic backend spin reader.
 *
 * Grid size (columns × rows) and extra symbol ids always come from the bet JSON.
 * A package catalog only names known ids — unknown ids stay as Symbol(n)
 * so Package 2 (5×3) and Package 1 (6×5 + bombs 10–22) share one reader.
 */

import { getByPath } from '../../shared/json-path.js';
import { discoverFeatureSpinItems, isIntMatrix } from '../../shared/spin-payload-discovery.js';
import type { ReelSymbolDef } from '../../core/models/index.js';
import { buildReelGridFromMatrix, resolveReelAreaMatrix } from './parse-reel-area.js';
import type { ReelGrid } from './types.js';
import { loadPackageCatalog, type PackageSymbolCatalog } from './package-catalog.js';

const AREA_PATH_CANDIDATES = [
  'slot.area',
  'data.slot.area',
  'result.slot.area',
  'area',
] as const;

const TUMBLES_PATH_CANDIDATES = [
  'slot.tumbles',
  'data.slot.tumbles',
  'result.slot.tumbles',
  'tumbles',
] as const;

export interface BackendTumbleStep {
  readonly index: number;
  readonly columns: number;
  readonly rows: number;
  readonly uniqueSymbolIds: readonly number[];
  /** Visual row-major ids (R1 = top of canvas). */
  readonly ids: readonly (readonly number[])[];
}

/** One board in a spin sequence — stop or a tumble. ids[row][col]. */
export interface BackendBoardView {
  readonly key: string;
  readonly title: string;
  readonly columns: number;
  readonly rows: number;
  readonly ids: readonly (readonly number[])[];
  readonly names: readonly (readonly string[])[];
  /** Tumble metadata only (symbols.in/out) — no reel area in JSON. */
  readonly symbolsOnly?: boolean;
}

/** Logical spin within one bet/buy payload (opener, free spin N, etc.). */
export interface BackendSpinGroup {
  readonly key: string;
  readonly title: string;
  readonly fsIndex?: number;
  readonly fsTotal?: number;
  readonly spinsLeft?: number;
  readonly boards: readonly BackendBoardView[];
  readonly totalWin?: number;
  readonly sourcePath: string;
  readonly symbolsOnlyTumbleCount?: number;
}

export interface BackendSpinRead {
  readonly columns: number;
  readonly rows: number;
  readonly sourcePath: string;
  readonly rowOrder: 'top-to-bottom' | 'bottom-to-top';
  readonly catalogId?: string;
  readonly grid: ReelGrid;
  /** slot.area as sent (before rowOrder flip). */
  readonly rawArea: number[][];
  readonly uniqueSymbolIds: readonly number[];
  readonly unknownSymbolIds: readonly number[];
  readonly tumbles: readonly BackendTumbleStep[];
  readonly spinGroups: readonly BackendSpinGroup[];
  readonly boards: readonly BackendBoardView[];
  readonly totalWin?: number;
}

export interface ReadBackendSpinOptions {
  readonly catalog?: PackageSymbolCatalog;
  readonly packageId?: string;
  readonly gameId?: string;
  readonly areaPath?: string;
  readonly tumblesPath?: string;
  readonly featureItemsPath?: string;
  readonly rowOrder?: 'top-to-bottom' | 'bottom-to-top';
  readonly symbols?: readonly ReelSymbolDef[];
}

function toIntMatrix(value: number[][]): number[][] {
  return value.map((column) => column.map((cell) => Number(cell)));
}

function uniqueIdsFromMatrix(matrix: number[][]): number[] {
  const ids = new Set<number>();
  for (const column of matrix) {
    for (const id of column) {
      ids.add(id);
    }
  }
  return [...ids].sort((a, b) => a - b);
}

function nameForId(symbols: readonly ReelSymbolDef[], id: number): string {
  const found = symbols.find((entry) => entry.id === id);
  return found?.visualName ?? found?.name ?? `Symbol(${id})`;
}

/** Column-major JSON → visual row-major (R1 = top). */
export function visualRowMajorIds(
  columnMajor: number[][],
  rowOrder: 'top-to-bottom' | 'bottom-to-top',
): number[][] {
  const oriented =
    rowOrder === 'bottom-to-top'
      ? columnMajor.map((column) => [...column].reverse())
      : columnMajor;
  const columns = oriented.length;
  const rows = oriented[0]?.length ?? 0;
  const ids: number[][] = [];
  for (let row = 0; row < rows; row += 1) {
    ids.push(Array.from({ length: columns }, (_, col) => oriented[col]![row]!));
  }
  return ids;
}

function boardFromColumnMajor(
  columnMajor: number[][],
  rowOrder: 'top-to-bottom' | 'bottom-to-top',
  symbols: readonly ReelSymbolDef[],
  key: string,
  title: string,
): BackendBoardView {
  const ids = visualRowMajorIds(columnMajor, rowOrder);
  const names = ids.map((row) => row.map((id) => nameForId(symbols, id)));
  return {
    key,
    title,
    columns: ids[0]?.length ?? 0,
    rows: ids.length,
    ids,
    names,
  };
}

function discoverArea(body: unknown, preferred?: string): { matrix: number[][]; path: string } {
  const paths = preferred
    ? [preferred, ...AREA_PATH_CANDIDATES.filter((entry) => entry !== preferred)]
    : [...AREA_PATH_CANDIDATES];

  for (const path of paths) {
    const value = getByPath(body, path);
    if (isIntMatrix(value)) {
      return { matrix: toIntMatrix(value), path };
    }
  }

  throw new Error(
    `No reel area matrix found (tried ${paths.join(', ')}). Reader needs an integer column×row array.`,
  );
}

function discoverTumblesPath(body: unknown, preferred?: string): string | undefined {
  const paths = preferred
    ? [preferred, ...TUMBLES_PATH_CANDIDATES.filter((entry) => entry !== preferred)]
    : [...TUMBLES_PATH_CANDIDATES];
  for (const path of paths) {
    const value = getByPath(body, path);
    if (Array.isArray(value)) {
      return path;
    }
  }
  return undefined;
}

function boardsFromAreaAndTumbles(
  columnMajor: number[][],
  rawTumbles: unknown[] | undefined,
  rowOrder: 'top-to-bottom' | 'bottom-to-top',
  symbols: readonly ReelSymbolDef[],
  keyPrefix: string,
): { boards: BackendBoardView[]; tumbles: BackendTumbleStep[]; symbolsOnlyTumbleCount: number } {
  const boards: BackendBoardView[] = [
    boardFromColumnMajor(columnMajor, rowOrder, symbols, `${keyPrefix}-stop`, 'Stop'),
  ];
  const tumbles: BackendTumbleStep[] = [];
  let symbolsOnlyTumbleCount = 0;

  if (Array.isArray(rawTumbles)) {
    rawTumbles.forEach((step, index) => {
      if (step === null || typeof step !== 'object') {
        return;
      }
      if ('area' in step) {
        const area = (step as { area: unknown }).area;
        if (!isIntMatrix(area)) {
          return;
        }
        const tumbleMatrix = toIntMatrix(area);
        const board = boardFromColumnMajor(
          tumbleMatrix,
          rowOrder,
          symbols,
          `${keyPrefix}-tumble-${index + 1}`,
          `Tumble ${index + 1}`,
        );
        tumbles.push({
          index,
          columns: tumbleMatrix.length,
          rows: tumbleMatrix[0]?.length ?? 0,
          uniqueSymbolIds: uniqueIdsFromMatrix(tumbleMatrix),
          ids: board.ids,
        });
        boards.push(board);
        return;
      }
      if ('symbols' in step) {
        symbolsOnlyTumbleCount += 1;
        boards.push({
          key: `${keyPrefix}-tumble-${index + 1}-meta`,
          title: `Tumble ${index + 1} (symbols only)`,
          columns: boards[0]!.columns,
          rows: boards[0]!.rows,
          ids: [],
          names: [],
          symbolsOnly: true,
        });
      }
    });
  }

  return { boards, tumbles, symbolsOnlyTumbleCount };
}

function resolveCatalog(options?: ReadBackendSpinOptions): PackageSymbolCatalog | undefined {
  if (options?.catalog !== undefined) {
    return options.catalog;
  }
  if (options?.packageId !== undefined) {
    return loadPackageCatalog(options.packageId);
  }
  if (options?.gameId !== undefined) {
    return loadPackageCatalog(options.gameId);
  }
  return undefined;
}

/**
 * Read one spin/bet payload into a visual Column×Row grid.
 * Does not assume 6×5 or a closed symbol set.
 */
export function readBackendSpin(
  body: unknown,
  options?: ReadBackendSpinOptions,
): BackendSpinRead {
  const catalog = resolveCatalog(options);
  const areaPath = options?.areaPath ?? catalog?.areaPath;
  const tumblesPath = options?.tumblesPath ?? catalog?.tumblesPath;
  const featureItemsPath = options?.featureItemsPath ?? catalog?.featureItemsPath;
  const rowOrder = options?.rowOrder ?? catalog?.rowOrder ?? 'top-to-bottom';
  const symbols = options?.symbols ?? catalog?.symbols ?? [];

  const discovered = discoverArea(body, areaPath);
  const resolvedTumbles = discoverTumblesPath(body, tumblesPath);

  const { matrix, sourcePath } = resolveReelAreaMatrix(body, {
    areaPath: discovered.path,
    tumblesPath: resolvedTumbles,
    rowOrder,
  });

  const grid = buildReelGridFromMatrix(matrix, symbols);
  const rawArea = discovered.matrix;
  const uniqueSymbolIds = uniqueIdsFromMatrix(rawArea);
  const known = new Set(symbols.map((entry) => entry.id));
  const unknownSymbolIds = uniqueSymbolIds.filter((id) => !known.has(id));

  const spinGroups: BackendSpinGroup[] = [];
  const allTumbles: BackendTumbleStep[] = [];
  const allBoards: BackendBoardView[] = [];

  const openerParsed = boardsFromAreaAndTumbles(
    rawArea,
    resolvedTumbles !== undefined ? (getByPath(body, resolvedTumbles) as unknown[]) : undefined,
    rowOrder,
    symbols,
    'opener',
  );
  allTumbles.push(...openerParsed.tumbles);
  spinGroups.push({
    key: 'opener',
    title: 'Buy Bonus',
    boards: openerParsed.boards,
    sourcePath: discovered.path,
    symbolsOnlyTumbleCount:
      openerParsed.symbolsOnlyTumbleCount > 0 ? openerParsed.symbolsOnlyTumbleCount : undefined,
  });

  const featureDiscovery = discoverFeatureSpinItems(body, { featureItemsPath });
  const fsItems = featureDiscovery?.items ?? [];
  const fsTotal = fsItems.length;
  fsItems.forEach((item, index) => {
    const fsIndex = index + 1;
    const parsed = boardsFromAreaAndTumbles(
      item.area,
      item.tumbles,
      rowOrder,
      symbols,
      `fs-${fsIndex}`,
    );
    allTumbles.push(...parsed.tumbles);
    spinGroups.push({
      key: `fs-${fsIndex}`,
      title: `Free Spin ${fsIndex}/${fsTotal}`,
      fsIndex,
      fsTotal,
      spinsLeft: item.spinsRemaining,
      boards: parsed.boards,
      totalWin: item.totalWin,
      sourcePath: item.sourcePath,
      symbolsOnlyTumbleCount:
        parsed.symbolsOnlyTumbleCount > 0 ? parsed.symbolsOnlyTumbleCount : undefined,
    });
  });

  if (fsItems.length === 0) {
    spinGroups[0] = {
      ...spinGroups[0]!,
      key: 'main',
      title: 'Spin',
    };
  }

  for (const group of spinGroups) {
    allBoards.push(...group.boards);
  }

  const totalWinRaw = getByPath(body, 'slot.totalWin') ?? getByPath(body, 'data.slot.totalWin');
  const totalWin = Number(totalWinRaw);
  const hasTotalWin = Number.isFinite(totalWin);

  return {
    columns: grid.columns,
    rows: grid.rows,
    sourcePath,
    rowOrder,
    catalogId: catalog?.packageId,
    grid,
    rawArea,
    uniqueSymbolIds,
    unknownSymbolIds,
    tumbles: allTumbles,
    spinGroups,
    boards: allBoards,
    totalWin: hasTotalWin ? totalWin : undefined,
  };
}

export function formatBackendSpinGrid(read: BackendSpinRead): string {
  const header = [
    `Backend reel ${read.columns}×${read.rows} from ${read.sourcePath}`,
    `rowOrder=${read.rowOrder}${read.catalogId !== undefined ? ` catalog=${read.catalogId}` : ''}`,
    `ids=[${read.uniqueSymbolIds.join(', ')}]`,
    read.unknownSymbolIds.length > 0
      ? `unknown=[${read.unknownSymbolIds.join(', ')}]`
      : undefined,
    read.totalWin !== undefined ? `totalWin=${read.totalWin}` : undefined,
  ]
    .filter(Boolean)
    .join(' | ');

  const lines = [header, ''];
  const rowLabel = '     ' + Array.from({ length: read.columns }, (_, col) => `C${col + 1}`.padEnd(16)).join('');
  lines.push(rowLabel);
  for (let row = 0; row < read.rows; row += 1) {
    const cells = Array.from({ length: read.columns }, (_, col) => {
      const cell = read.grid.cells[col]![row]!;
      return `[${cell.symbolId}] ${cell.symbolName}`.padEnd(16);
    });
    lines.push(`R${row + 1}   ${cells.join('')}`);
  }
  return lines.join('\n');
}
