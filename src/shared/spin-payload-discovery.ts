/**
 * Discover feature-spin boards and remaining counts from live bet/buy payloads.
 *
 * Never assumes a single game schema — uses configured path hints first, then
 * common candidates, then a shallow tree walk of the response body.
 */

import { getByPath } from './json-path.js';

const FEATURE_ITEMS_PATH_CANDIDATES = [
  'slot.freeSpin.items',
  'slot.freeSpins.items',
  'slot.feature.items',
  'slot.bonus.items',
  'slot.bonusSpins.items',
  'data.slot.freeSpin.items',
  'result.slot.freeSpin.items',
  'freeSpin.items',
] as const;

const REMAINING_FIELD_CANDIDATES = [
  'spinsLeft',
  'spinsRemaining',
  'remaining',
  'roundsLeft',
  'freeSpinsLeft',
  'left',
] as const;

const TUMBLE_ARRAY_KEYS = ['tumbles', 'cascades', 'avalanches'] as const;

const MAX_WALK_DEPTH = 10;

export interface SpinPayloadDiscoveryOptions {
  /** Package/manifest hint — tried before generic discovery. */
  readonly featureItemsPath?: string;
}

export interface FeatureSpinItem {
  readonly area: number[][];
  readonly tumbles?: unknown[];
  readonly spinsRemaining?: number;
  readonly totalWin?: number;
  readonly sourceIndex: number;
  readonly sourcePath: string;
}

export interface FeatureSpinItemsDiscovery {
  readonly itemsPath: string;
  readonly items: readonly FeatureSpinItem[];
}

export function isIntMatrix(value: unknown): value is number[][] {
  if (!Array.isArray(value) || value.length === 0) {
    return false;
  }
  const rowCount = Array.isArray(value[0]) ? value[0].length : 0;
  if (rowCount === 0) {
    return false;
  }
  return value.every(
    (column) =>
      Array.isArray(column) &&
      column.length === rowCount &&
      column.every((cell) => Number.isInteger(Number(cell))),
  );
}

function toIntMatrix(value: number[][]): number[][] {
  return value.map((column) => column.map((cell) => Number(cell)));
}

function isFeatureItemEntry(value: unknown): value is { area: number[][] } {
  return (
    value !== null &&
    typeof value === 'object' &&
    'area' in value &&
    isIntMatrix((value as { area: unknown }).area)
  );
}

function isFeatureItemsArray(value: unknown): value is Array<{ area: number[][] }> {
  return Array.isArray(value) && value.length > 0 && value.every(isFeatureItemEntry);
}

function scoreFeatureItemsPath(path: string): number {
  let score = 100 - path.split('.').length;
  const lower = path.toLowerCase();
  if (/freespin|free_spin|feature|bonus/.test(lower)) {
    score += 30;
  }
  if (lower.endsWith('.items')) {
    score += 10;
  }
  return score;
}

function walkForFeatureItems(
  value: unknown,
  currentPath: string,
  depth: number,
  hits: string[],
): void {
  if (depth > MAX_WALK_DEPTH || value === null || value === undefined) {
    return;
  }
  if (isFeatureItemsArray(value)) {
    hits.push(currentPath);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => {
      walkForFeatureItems(entry, `${currentPath}[${index}]`, depth + 1, hits);
    });
    return;
  }
  if (typeof value === 'object') {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      const segment = currentPath.length > 0 ? `${currentPath}.${key}` : key;
      walkForFeatureItems(child, segment, depth + 1, hits);
    }
  }
}

/** Resolve the array path that holds per-spin feature boards in this payload. */
export function discoverFeatureItemsPath(
  body: unknown,
  options?: SpinPayloadDiscoveryOptions,
): string | undefined {
  const preferred = options?.featureItemsPath?.trim();
  if (preferred !== undefined && preferred.length > 0) {
    const hinted = getByPath(body, preferred);
    if (isFeatureItemsArray(hinted)) {
      return preferred;
    }
  }

  for (const candidate of FEATURE_ITEMS_PATH_CANDIDATES) {
    if (candidate === preferred) {
      continue;
    }
    const value = getByPath(body, candidate);
    if (isFeatureItemsArray(value)) {
      return candidate;
    }
  }

  const walked: string[] = [];
  walkForFeatureItems(body, '', 0, walked);
  if (walked.length === 0) {
    return undefined;
  }
  walked.sort((a, b) => scoreFeatureItemsPath(b) - scoreFeatureItemsPath(a));
  return walked[0];
}

function remainingFromEntry(entry: Record<string, unknown>): number | undefined {
  for (const key of REMAINING_FIELD_CANDIDATES) {
    const left = Number(entry[key]);
    if (Number.isFinite(left) && left >= 0) {
      return left;
    }
  }
  return undefined;
}

function tumblesFromEntry(entry: Record<string, unknown>): unknown[] | undefined {
  for (const key of TUMBLE_ARRAY_KEYS) {
    const value = entry[key];
    if (Array.isArray(value)) {
      return value;
    }
  }
  return undefined;
}

function winFromEntry(entry: Record<string, unknown>): number | undefined {
  for (const key of ['totalWin', 'win', 'amount']) {
    const win = Number(entry[key]);
    if (Number.isFinite(win)) {
      return win;
    }
  }
  return undefined;
}

/** Parse every feature spin board found in the payload (empty when none). */
export function discoverFeatureSpinItems(
  body: unknown,
  options?: SpinPayloadDiscoveryOptions,
): FeatureSpinItemsDiscovery | undefined {
  const itemsPath = discoverFeatureItemsPath(body, options);
  if (itemsPath === undefined) {
    return undefined;
  }
  const raw = getByPath(body, itemsPath);
  if (!Array.isArray(raw)) {
    return undefined;
  }

  const items: FeatureSpinItem[] = [];
  raw.forEach((entry, sourceIndex) => {
    if (!isFeatureItemEntry(entry)) {
      return;
    }
    const typed = entry as Record<string, unknown>;
    items.push({
      area: toIntMatrix(entry.area),
      tumbles: tumblesFromEntry(typed),
      spinsRemaining: remainingFromEntry(typed),
      totalWin: winFromEntry(typed),
      sourceIndex,
      sourcePath: `${itemsPath}[${sourceIndex}].area`,
    });
  });

  if (items.length === 0) {
    return undefined;
  }

  items.sort(
    (a, b) => (Number(b.spinsRemaining) || 0) - (Number(a.spinsRemaining) || 0),
  );

  return { itemsPath, items };
}

/** Raw feature item objects at the discovered path (may be empty). */
export function getFreeSpinItems(body: unknown, options?: SpinPayloadDiscoveryOptions): unknown[] {
  const path = discoverFeatureItemsPath(body, options);
  if (path === undefined) {
    return [];
  }
  const items = getByPath(body, path);
  return Array.isArray(items) ? items : [];
}

/**
 * One payload embeds multiple feature spins (full history) vs one spin at a time.
 * Structural rule: more than one item with an area matrix in the same response.
 */
export function isFreeSpinBundleComplete(
  body: unknown,
  options?: SpinPayloadDiscoveryOptions,
): boolean {
  const discovered = discoverFeatureSpinItems(body, options);
  return discovered !== undefined && discovered.items.length > 1;
}

/**
 * Feature spins still to play after this payload.
 * - Bundled multi-item response → 0 (session resolved in one payload).
 * - Single item → remaining counter field on that item, when present.
 */
export function freeSpinItemsRemaining(
  body: unknown,
  options?: SpinPayloadDiscoveryOptions,
): number {
  const discovered = discoverFeatureSpinItems(body, options);
  if (discovered === undefined || discovered.items.length === 0) {
    return 0;
  }
  if (discovered.items.length > 1) {
    return 0;
  }
  const first = discovered.items[0]!;
  if (first.spinsRemaining !== undefined) {
    return first.spinsRemaining;
  }
  return 1;
}
