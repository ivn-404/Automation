/**
 * Load Help/Payout symbol templates from disk (per-game catalog).
 */

import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

import { decodePng, type RgbaImage } from './image-match.js';
import { loadPackageCatalog } from './package-catalog.js';
import type { ReelSymbolDef, ReelValidationConfig } from './types.js';

export interface LoadedSymbolTemplate {
  readonly id: number;
  readonly name: string;
  readonly image: RgbaImage;
}

export function resolveSymbolTemplateDir(config: ReelValidationConfig): string {
  return path.isAbsolute(config.symbolTemplateDir)
    ? config.symbolTemplateDir
    : path.join(process.cwd(), config.symbolTemplateDir);
}

export function loadSymbolTemplates(
  config: ReelValidationConfig,
): readonly LoadedSymbolTemplate[] {
  const dir = resolveSymbolTemplateDir(config);
  const loaded: LoadedSymbolTemplate[] = [];

  for (const symbol of config.symbols) {
    const filePath = path.join(dir, `${symbol.id}.png`);
    if (!existsSync(filePath)) {
      continue;
    }
    const image = decodePng(readFileSync(filePath));
    loaded.push({ id: symbol.id, name: symbol.visualName ?? symbol.name, image });
  }

  if (loaded.length === 0) {
    throw new Error(`No symbol templates loaded from ${dir}`);
  }

  return loaded;
}

export function loadCatalogSymbols(gameId: string): readonly ReelSymbolDef[] {
  const catalogPath = path.join(
    process.cwd(),
    'config',
    'symbols',
    gameId,
    'catalog.json',
  );
  if (existsSync(catalogPath)) {
    const raw = JSON.parse(readFileSync(catalogPath, 'utf8')) as {
      symbols?: Array<{
        id: number;
        name: string;
        visualName?: string;
        kind?: ReelSymbolDef['kind'];
        multiplierValue?: number;
      }>;
    };
    if (!Array.isArray(raw.symbols) || raw.symbols.length === 0) {
      throw new Error(`Symbol catalog empty: ${catalogPath}`);
    }
    return raw.symbols.map((entry) => ({
      id: entry.id,
      name: entry.name,
      visualName: entry.visualName,
      kind: entry.kind,
      multiplierValue: entry.multiplierValue,
    }));
  }

  const packageCatalog = loadPackageCatalog(gameId);
  return packageCatalog.symbols;
}
