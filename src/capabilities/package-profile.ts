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

export interface PackageProfile {
  readonly packageId: string;
  readonly gameIds: readonly string[];
  /** Feature capability defaults for every game in the package. */
  readonly capabilities: Readonly<Record<string, boolean>>;
  /** True when the profile carries a symbol catalog. */
  readonly hasSymbolCatalog: boolean;
  /** Multiplier values the package spec lists on the Help/Payout screen, ascending. */
  readonly multiplierValues?: readonly number[];
}

interface RawPackageProfile {
  readonly packageId?: string;
  readonly gameId?: string;
  readonly gameIds?: readonly string[];
  readonly capabilities?: Readonly<Record<string, unknown>>;
  readonly symbols?: readonly unknown[];
  readonly multiplierValues?: readonly unknown[];
}

const cache = new Map<string, PackageProfile | null>();

export function packagesDir(): string {
  return path.join(process.cwd(), 'config', 'packages');
}

function toProfile(raw: RawPackageProfile, fileId: string): PackageProfile {
  const capabilities: Record<string, boolean> = {};
  for (const [key, value] of Object.entries(raw.capabilities ?? {})) {
    if (typeof value === 'boolean') {
      capabilities[key] = value;
    }
  }
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
