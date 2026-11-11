/**
 * Package profile — `config/packages/<packageId>.json`.
 *
 * One file per package holds what every title in that package shares: the symbol
 * catalog (ids → names/kinds, reel payload paths) and feature capability defaults.
 * A game manifest still wins: `metadata[capability]` overrides the package default.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

import type { GameManifest } from '../core/models/index.js';

/** How extra free spins are applied when a re-trigger lands. */
export type FreeSpinAwardKind = 'add' | 'reset';

/**
 * Package-declared free-spin re-trigger math.
 * Absent fields are not inferred — callers must not assume Package 1's 3 / +5.
 */
export interface FreeSpinRetriggerRules {
  /** Scatters that open the feature from the base game. Never proof of a re-trigger. */
  readonly scatterEntryAt?: number;
  /** In-bonus scatters that may award extra spins. */
  readonly scatterRetriggerAt?: number;
  readonly awardKind?: FreeSpinAwardKind;
  readonly awardSpins?: number;
  /**
   * Purchased bonus: the first free-spin item is already in-bonus (Buy Feature
   * opened the session). Absent/false → item 0 is the grant/entry board.
   */
  readonly purchasedOpenerInBonus?: boolean;
  /**
   * Remaining award may land this many items after the scatter board (Package 1
   * live contract: scatters on i, spinsLeft +5 on i+1). 0 = same item only.
   */
  readonly awardLagItems?: number;
}

export interface PackageProfile {
  readonly packageId: string;
  readonly gameIds: readonly string[];
  /** Feature capability defaults for every game in the package. */
  readonly capabilities: Readonly<Record<string, boolean>>;
  /** True when the profile carries a symbol catalog. */
  readonly hasSymbolCatalog: boolean;
  /** Multiplier values the package spec lists on the Help/Payout screen, ascending. */
  readonly multiplierValues?: readonly number[];
  /** Max win cap as a multiple of the bet. */
  readonly maxWinMultiplier?: number;
  /** Reel grid from the package spec (columns × rows). */
  readonly reelsHint?: { readonly columns: number; readonly rows: number };
  /** Declared in-bonus re-trigger math, when the package spec documents it. */
  readonly freeSpinRetriggerRules?: FreeSpinRetriggerRules;
}

interface RawPackageProfile {
  readonly packageId?: string;
  readonly gameId?: string;
  readonly gameIds?: readonly string[];
  readonly capabilities?: Readonly<Record<string, unknown>>;
  readonly symbols?: readonly unknown[];
  readonly multiplierValues?: readonly unknown[];
  readonly maxWinMultiplier?: unknown;
  readonly reelsHint?: { readonly columns?: unknown; readonly rows?: unknown };
  readonly freeSpinRetriggerRules?: unknown;
}

const cache = new Map<string, PackageProfile | null>();

export function packagesDir(): string {
  return path.join(process.cwd(), 'config', 'packages');
}

function positiveInt(value: unknown): number | undefined {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return undefined;
  }
  return Math.floor(parsed);
}

function nonNegativeInt(value: unknown): number | undefined {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return undefined;
  }
  return Math.floor(parsed);
}

export function parseFreeSpinRetriggerRules(raw: unknown): FreeSpinRetriggerRules | undefined {
  if (typeof raw !== 'object' || raw === null) {
    return undefined;
  }
  const source = raw as Record<string, unknown>;
  const awardKind = source.awardKind === 'add' || source.awardKind === 'reset' ? source.awardKind : undefined;
  const rules: FreeSpinRetriggerRules = {
    ...(positiveInt(source.scatterEntryAt) !== undefined
      ? { scatterEntryAt: positiveInt(source.scatterEntryAt) }
      : {}),
    ...(positiveInt(source.scatterRetriggerAt) !== undefined
      ? { scatterRetriggerAt: positiveInt(source.scatterRetriggerAt) }
      : {}),
    ...(awardKind !== undefined ? { awardKind } : {}),
    ...(positiveInt(source.awardSpins) !== undefined ? { awardSpins: positiveInt(source.awardSpins) } : {}),
    ...(source.purchasedOpenerInBonus === true ? { purchasedOpenerInBonus: true } : {}),
    ...(nonNegativeInt(source.awardLagItems) !== undefined
      ? { awardLagItems: nonNegativeInt(source.awardLagItems) }
      : {}),
  };
  return Object.keys(rules).length > 0 ? rules : undefined;
}

/** Declared re-trigger math for this game's package, or undefined when unmapped. */
export function freeSpinRetriggerRulesFor(
  manifest: Pick<GameManifest, 'gameId' | 'metadata'>,
): FreeSpinRetriggerRules | undefined {
  return packageProfileFor(manifest)?.freeSpinRetriggerRules;
}

function toProfile(raw: RawPackageProfile, fileId: string): PackageProfile {
  const capabilities: Record<string, boolean> = {};
  for (const [key, value] of Object.entries(raw.capabilities ?? {})) {
    if (typeof value === 'boolean') {
      capabilities[key] = value;
    }
  }
  const freeSpinRetriggerRules = parseFreeSpinRetriggerRules(raw.freeSpinRetriggerRules);
  return {
    packageId: raw.packageId ?? fileId,
    gameIds: raw.gameIds ?? (raw.gameId !== undefined ? [raw.gameId] : []),
    capabilities,
    hasSymbolCatalog: Array.isArray(raw.symbols) && raw.symbols.length > 0,
    ...(Array.isArray(raw.multiplierValues)
      ? {
          multiplierValues: raw.multiplierValues
            .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
            .sort((a, b) => a - b),
        }
      : {}),
    ...(typeof raw.maxWinMultiplier === 'number' && Number.isFinite(raw.maxWinMultiplier)
      ? { maxWinMultiplier: raw.maxWinMultiplier }
      : {}),
    ...(typeof raw.reelsHint?.columns === 'number' &&
    Number.isFinite(raw.reelsHint.columns) &&
    typeof raw.reelsHint.rows === 'number' &&
    Number.isFinite(raw.reelsHint.rows)
      ? { reelsHint: { columns: raw.reelsHint.columns, rows: raw.reelsHint.rows } }
      : {}),
    ...(freeSpinRetriggerRules !== undefined ? { freeSpinRetriggerRules } : {}),
  };
}

function readProfile(file: string): RawPackageProfile {
  return JSON.parse(readFileSync(file, 'utf8')) as RawPackageProfile;
}

function findProfile(gameId: string, packageId: string | undefined): PackageProfile | undefined {
  const dir = packagesDir();
  if (packageId !== undefined) {
    const direct = path.join(dir, `${packageId}.json`);
    if (existsSync(direct)) {
      return toProfile(readProfile(direct), packageId);
    }
  }
  if (!existsSync(dir)) {
    return undefined;
  }
  for (const file of readdirSync(dir)) {
    if (!file.endsWith('.json')) {
      continue;
    }
    const raw = readProfile(path.join(dir, file));
    if (raw.gameIds?.includes(gameId) === true || raw.gameId === gameId) {
      return toProfile(raw, file.replace(/\.json$/u, ''));
    }
  }
  return undefined;
}

/** The package profile a game belongs to, or undefined when its package has none yet. */
export function packageProfileFor(
  manifest: Pick<GameManifest, 'gameId' | 'metadata'>,
): PackageProfile | undefined {
  const packageId = manifest.metadata?.packageId;
  const key = `${manifest.gameId}|${packageId ?? ''}`;
  if (!cache.has(key)) {
    cache.set(key, findProfile(manifest.gameId, packageId) ?? null);
  }
  return cache.get(key) ?? undefined;
}

/** Test seam: drop the cache so a rewritten package file is picked up. */
export function clearPackageProfileCache(): void {
  cache.clear();
}
