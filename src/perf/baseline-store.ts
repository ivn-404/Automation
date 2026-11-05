/**
 * PAD baselines kept between runs (`perf-baselines/<gameId>.json`): idle CPU for PAD-013, the
 * per-build profile for PAD-039 and the per-browser profile for PAD-040. Runs append; nothing is
 * overwritten, so an earlier build stays comparable.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export interface BaselineEntry {
  readonly at: string;
  readonly caseId: string;
  readonly build: string;
  readonly browser: string;
  readonly metrics: Readonly<Record<string, number>>;
}

function storeDir(): string {
  return process.env.SGAP_PERF_BASELINE_DIR ?? path.join(process.cwd(), 'perf-baselines');
}

function storePath(gameId: string): string {
  return path.join(storeDir(), `${gameId}.json`);
}

export function readBaselines(gameId: string): BaselineEntry[] {
  try {
    const parsed = JSON.parse(readFileSync(storePath(gameId), 'utf8')) as { entries?: BaselineEntry[] };
    return Array.isArray(parsed.entries) ? parsed.entries : [];
  } catch {
    return [];
  }
}

export function appendBaseline(gameId: string, entry: Omit<BaselineEntry, 'at'>): BaselineEntry {
  const full: BaselineEntry = { at: new Date().toISOString(), ...entry };
  const entries = [...readBaselines(gameId), full];
  mkdirSync(storeDir(), { recursive: true });
  writeFileSync(storePath(gameId), `${JSON.stringify({ gameId, entries }, null, 2)}\n`);
  return full;
}

/** Most recent entry for a case that matches the filter. */
export function latestBaseline(
  gameId: string,
  caseId: string,
  match: (entry: BaselineEntry) => boolean = () => true,
): BaselineEntry | undefined {
  return readBaselines(gameId)
    .filter((entry) => entry.caseId === caseId && match(entry))
    .sort((a, b) => b.at.localeCompare(a.at))[0];
}
