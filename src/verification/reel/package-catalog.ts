/**
 * Load package symbol catalogs (Package 1, Package 2, …).
 * Catalogs name ids; they never freeze column/row counts.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

import type { ReelSymbolDef, ReelSymbolKind } from '../../core/models/index.js';

export interface PackageReelsHint {
  readonly columns: number;
  readonly rows: number;
}

export interface PackageSymbolCatalog {
  readonly packageId: string;
  readonly gameId: string;
  readonly displayName?: string;
  readonly reelsHint?: PackageReelsHint;
  readonly rowOrder?: 'top-to-bottom' | 'bottom-to-top';
  readonly areaPath?: string;
  readonly tumblesPath?: string;
  /** Hint for nested feature-spin item arrays (e.g. slot.freeSpin.items). */
  readonly featureItemsPath?: string;
  readonly symbols: readonly ReelSymbolDef[];
}

interface RawCatalog {
  readonly packageId?: string;
  readonly gameId?: string;
  readonly gameIds?: readonly string[];
  readonly displayName?: string;
  readonly reelsHint?: { columns?: number; rows?: number };
  readonly rowOrder?: string;
  readonly areaPath?: string;
  readonly tumblesPath?: string;
  readonly featureItemsPath?: string;
  readonly symbols?: Array<{
    id: number;
    name: string;
    visualName?: string;
    kind?: ReelSymbolKind;
    multiplierValue?: number;
    helpOrder?: number;
  }>;
}

const KIND_VALUES = new Set<ReelSymbolKind>([
  'scatter',
  'high',
  'low',
  'multiplier',
  'wild',
  'other',
]);

function packagesDir(): string {
  return path.join(process.cwd(), 'config', 'packages');
}

function parseCatalog(raw: RawCatalog, fallbackId: string): PackageSymbolCatalog {
  const symbols = (raw.symbols ?? []).map((entry) => ({
    id: entry.id,
    name: entry.name,
    visualName: entry.visualName,
    kind: entry.kind !== undefined && KIND_VALUES.has(entry.kind) ? entry.kind : undefined,
    multiplierValue: entry.multiplierValue,
    ...(Number.isInteger(entry.helpOrder) ? { helpOrder: entry.helpOrder } : {}),
  }));
  if (symbols.length === 0) {
    throw new Error(`Package catalog ${fallbackId} has no symbols`);
  }
  const rowOrder =
    raw.rowOrder === 'bottom-to-top' || raw.rowOrder === 'top-to-bottom'
      ? raw.rowOrder
      : undefined;
  const hint =
    raw.reelsHint !== undefined &&
    Number.isInteger(raw.reelsHint.columns) &&
    Number.isInteger(raw.reelsHint.rows)
      ? { columns: raw.reelsHint.columns!, rows: raw.reelsHint.rows! }
      : undefined;
  return {
    packageId: raw.packageId ?? fallbackId,
    gameId: raw.gameId ?? fallbackId,
    displayName: raw.displayName,
    reelsHint: hint,
    rowOrder,
    areaPath: raw.areaPath,
    tumblesPath: raw.tumblesPath,
    featureItemsPath: raw.featureItemsPath,
    symbols,
  };
}

export function loadPackageCatalog(packageIdOrGameId: string): PackageSymbolCatalog {
  const dir = packagesDir();
  const direct = path.join(dir, `${packageIdOrGameId}.json`);
  if (existsSync(direct)) {
    const raw = JSON.parse(readFileSync(direct, 'utf8')) as RawCatalog;
    return parseCatalog(raw, packageIdOrGameId);
  }

  if (existsSync(dir)) {
    for (const file of readdirSync(dir)) {
      if (!file.endsWith('.json')) {
        continue;
      }
      const raw = JSON.parse(readFileSync(path.join(dir, file), 'utf8')) as RawCatalog;
      if (
        raw.packageId === packageIdOrGameId ||
        raw.gameId === packageIdOrGameId ||
        raw.gameIds?.includes(packageIdOrGameId) === true
      ) {
        return parseCatalog(raw, file.replace(/\.json$/u, ''));
      }
    }
  }

  throw new Error(`Package catalog not found for "${packageIdOrGameId}" in ${dir}`);
}

export function displaySymbolName(symbol: Pick<ReelSymbolDef, 'name' | 'visualName'>): string {
  return symbol.visualName ?? symbol.name;
}
