import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { eyeRootDir } from './catalog.js';

export function scenarioReferencesDir(scenarioId: string): string {
  return path.join(eyeRootDir(), 'scenarios', scenarioId, 'references');
}

export function goldenPath(scenarioId: string, gameId: string): string {
  return path.join(scenarioReferencesDir(scenarioId), `${gameId}.png`);
}

export function listGoldenPaths(scenarioId: string): string[] {
  const dir = scenarioReferencesDir(scenarioId);
  if (!existsSync(dir)) {
    return [];
  }
  return readdirSync(dir)
    .filter((name) => name.endsWith('.png'))
    .map((name) => path.join(dir, name));
}

export function debugCapturePath(scenarioId: string, gameId: string): string {
  const dir = path.join(process.cwd(), 'test-results', 'eye', scenarioId);
  mkdirSync(dir, { recursive: true });
  return path.join(dir, `${gameId}-${Date.now()}.png`);
}

export function savePng(filePath: string, buffer: Buffer): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, buffer);
}

export function saveGoldenIfMissing(scenarioId: string, gameId: string, buffer: Buffer): string | undefined {
  const target = goldenPath(scenarioId, gameId);
  if (existsSync(target)) {
    return undefined;
  }
  savePng(target, buffer);
  return target;
}
