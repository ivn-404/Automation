/**
 * File-based Game Manifest loader.
 * Reads configuration from config/manifests/ — never embeds game-specific logic.
 */

import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import type { IGameManifestLoader } from '../../core/contracts/index.js';
import type { GameManifest } from '../../core/models/index.js';
import { loadPackageCatalog } from '../../verification/reel/package-catalog.js';
import { GameManifestValidationError, parseGameManifest } from './parse-game-manifest.js';

export class GameManifestNotFoundError extends Error {
  readonly gameId: string;

  constructor(gameId: string, manifestsDir: string) {
    super(`Game manifest not found for gameId "${gameId}" in ${manifestsDir}`);
    this.name = 'GameManifestNotFoundError';
    this.gameId = gameId;
  }
}

export interface FileGameManifestLoaderOptions {
  /** Absolute or process-relative path to the manifests directory. */
  readonly manifestsDir: string;
}

/**
 * Loads `{gameId}.json` manifests from disk and validates them.
 */
export class FileGameManifestLoader implements IGameManifestLoader {
  private readonly manifestsDir: string;

  constructor(options: FileGameManifestLoaderOptions) {
    this.manifestsDir = path.resolve(options.manifestsDir);
  }

  async listGameIds(): Promise<readonly string[]> {
    const entries = await readdir(this.manifestsDir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
      .map((entry) => entry.name.replace(/\.json$/u, ''))
      .sort();
  }

  async load(gameId: string): Promise<GameManifest> {
    if (!gameId || gameId.trim().length === 0) {
      throw new GameManifestValidationError('gameId', 'gameId must be a non-empty string');
    }

    const filePath = path.join(this.manifestsDir, `${gameId}.json`);
    let raw: string;
    try {
      raw = await readFile(filePath, 'utf8');
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') {
        throw new GameManifestNotFoundError(gameId, this.manifestsDir);
      }
      throw error;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch {
      throw new GameManifestValidationError(filePath, 'invalid JSON');
    }

    const manifest = parseGameManifest(withPackageReelDefaults(parsed, gameId));

    if (manifest.gameId !== gameId) {
      throw new GameManifestValidationError(
        '$.gameId',
        `file "${gameId}.json" declares gameId "${manifest.gameId}"; they must match`,
      );
    }

    return manifest;
  }
}

const PACKAGE_REEL_FIELDS = ['areaPath', 'tumblesPath', 'featureItemsPath', 'rowOrder', 'symbols'] as const;

/**
 * A manifest's `reelValidation` only has to carry what is specific to the title
 * (reel region, templates, help actions). Payload paths and the symbol list come
 * from the package catalog (`config/packages/<packageId>.json`) when omitted.
 */
function withPackageReelDefaults(parsed: unknown, gameId: string): unknown {
  if (parsed === null || typeof parsed !== 'object') {
    return parsed;
  }
  const input = parsed as Record<string, unknown>;
  const reel = input.reelValidation;
  if (reel === null || typeof reel !== 'object') {
    return parsed;
  }
  const own = reel as Record<string, unknown>;
  if (PACKAGE_REEL_FIELDS.every((field) => own[field] !== undefined)) {
    return parsed;
  }
  const metadata = (input.metadata ?? {}) as Record<string, unknown>;
  const packageId = typeof metadata.packageId === 'string' ? metadata.packageId : gameId;
  let catalog: Record<string, unknown>;
  try {
    catalog = loadPackageCatalog(packageId) as unknown as Record<string, unknown>;
  } catch {
    return parsed;
  }
  const merged: Record<string, unknown> = { ...own };
  for (const field of PACKAGE_REEL_FIELDS) {
    if (merged[field] === undefined && catalog[field] !== undefined) {
      merged[field] = catalog[field];
    }
  }
  return { ...input, reelValidation: merged };
}

/** Default manifests directory relative to the repository root (process cwd). */
export function defaultManifestsDir(cwd: string = process.cwd()): string {
  return path.join(cwd, 'config', 'manifests');
}
