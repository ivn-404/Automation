/**
 * Parse backend bet/spin JSON into a Column×Row reel grid.
 * Structure is derived from the response — never hardcoded.
 */

import { getByPath } from '../../shared/json-path.js';
import type { ReelCell, ReelGrid, ReelSymbolDef, ReelValidationConfig } from './types.js';

function symbolNameFor(symbols: readonly ReelSymbolDef[], id: number): string {
  const found = symbols.find((entry) => entry.id === id);
  if (found !== undefined) {
    return found.visualName ?? found.name;
  }
  return `Symbol(${id})`;
}

function parseAreaMatrix(value: unknown, path: string): number[][] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`Reel area at "${path}" is missing or empty`);
  }

  const matrix: number[][] = [];
  let rowCount: number | undefined;

  for (let col = 0; col < value.length; col += 1) {
    const column = value[col];
    if (!Array.isArray(column) || column.length === 0) {
      throw new Error(`Reel area column ${col + 1} at "${path}" is invalid`);
    }
    if (rowCount === undefined) {
      rowCount = column.length;
    } else if (column.length !== rowCount) {
      throw new Error(
        `Reel area column ${col + 1} has ${column.length} rows; expected ${rowCount}`,
      );
    }
    const ids = column.map((entry, row) => {
      const id = Number(entry);
      if (!Number.isInteger(id)) {
        throw new Error(`Reel area C${col + 1} R${row + 1} is not an integer id`);
      }
      return id;
    });
    matrix.push(ids);
  }

  return matrix;
}

/**
 * Prefer final tumble area when tumbles exist; otherwise use areaPath.
 */
export function resolveReelAreaMatrix(
  body: unknown,
  config: Pick<ReelValidationConfig, 'areaPath' | 'tumblesPath' | 'rowOrder'>,
): { matrix: number[][]; sourcePath: string } {
  const tumblesPath = config.tumblesPath ?? 'slot.tumbles';
  const tumbles = getByPath(body, tumblesPath);

  let matrix: number[][];
  let sourcePath: string;

  if (Array.isArray(tumbles) && tumbles.length > 0) {
    let found: { matrix: number[][]; sourcePath: string } | undefined;
    for (let i = tumbles.length - 1; i >= 0; i -= 1) {
      const tumble = tumbles[i];
      if (tumble !== null && typeof tumble === 'object' && 'area' in tumble) {
        const area = (tumble as { area: unknown }).area;
        if (Array.isArray(area) && area.length > 0) {
          found = {
            matrix: parseAreaMatrix(area, `${tumblesPath}[${i}].area`),
            sourcePath: `${tumblesPath}[${i}].area`,
          };
          break;
        }
      }
    }
    if (found === undefined) {
      const areaPath = config.areaPath || 'slot.area';
      found = {
        matrix: parseAreaMatrix(getByPath(body, areaPath), areaPath),
        sourcePath: areaPath,
      };
    }
    matrix = found.matrix;
    sourcePath = found.sourcePath;
  } else {
    const areaPath = config.areaPath || 'slot.area';
    matrix = parseAreaMatrix(getByPath(body, areaPath), areaPath);
    sourcePath = areaPath;
  }

  if (config.rowOrder === 'bottom-to-top') {
    matrix = matrix.map((column) => [...column].reverse());
  }

  return { matrix, sourcePath };
}

export function buildReelGridFromMatrix(
  matrix: number[][],
  symbols: readonly ReelSymbolDef[],
): ReelGrid {
  const columns = matrix.length;
  const rows = matrix[0]?.length ?? 0;
  const cells: ReelCell[][] = matrix.map((column, colIndex) =>
    column.map((symbolId, rowIndex) => ({
      column: colIndex + 1,
      row: rowIndex + 1,
      symbolId,
      symbolName: symbolNameFor(symbols, symbolId),
    })),
  );

  return { columns, rows, cells };
}

export function parseReelGridFromBetResponse(
  body: unknown,
  config: ReelValidationConfig,
): ReelGrid & { sourcePath: string } {
  const { matrix, sourcePath } = resolveReelAreaMatrix(body, config);
  return { ...buildReelGridFromMatrix(matrix, config.symbols), sourcePath };
}
