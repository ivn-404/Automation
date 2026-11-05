/**
 * Maps initialize and /bet bodies of an unknown game onto the field paths and feature
 * flags a learned manifest needs. Prefers the shared DiJoker slots shape, then a shallow walk.
 * Stores paths only — never the payload itself.
 */

import type { FeatureCapability } from '../capabilities/index.js';
import { getByPath } from '../shared/json-path.js';
import { discoverFeatureItemsPath, isIntMatrix } from '../shared/spin-payload-discovery.js';

export interface PayloadFields {
  readonly balance?: string;
  readonly totalWin?: string;
  readonly transactionState?: string;
  readonly baseWin?: string;
  readonly bonusWin?: string;
  readonly unresolvedSpin?: string;
}

export interface PayloadLearning {
  readonly fields: PayloadFields;
  readonly areaPath?: string;
  readonly tumblesPath?: string;
  readonly featureItemsPath?: string;
  readonly features: Readonly<Partial<Record<FeatureCapability, string>>>;
  readonly spinsLearned: number;
  readonly evidence: readonly string[];
}

const FIELD_CANDIDATES: Readonly<Record<keyof PayloadFields, readonly string[]>> = {
  balance: ['balance', 'data.balance', 'wallet.balance', 'player.balance'],
  totalWin: ['slot.totalWin', 'data.slot.totalWin', 'slot.win', 'totalWin', 'win'],
  transactionState: ['transactionState', 'data.transactionState', 'slot.transactionState'],
  baseWin: ['slot.base.win', 'data.slot.base.win', 'slot.baseWin'],
  bonusWin: ['slot.bonus.win', 'data.slot.bonus.win', 'slot.bonusWin'],
  unresolvedSpin: ['unresolvedSpin', 'data.unresolvedSpin', 'slot.unresolvedSpin'],
};

const AREA_CANDIDATES = ['slot.area', 'data.slot.area', 'slot.reels', 'area'];
const TUMBLE_CANDIDATES = ['slot.tumbles', 'data.slot.tumbles', 'slot.cascades', 'slot.avalanches', 'tumbles'];

function isFiniteNumber(value: unknown): boolean {
  return typeof value === 'number' ? Number.isFinite(value) : typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value));
}

function firstNumericPath(bodies: readonly unknown[], candidates: readonly string[]): string | undefined {
  for (const path of candidates) {
    if (bodies.some((body) => isFiniteNumber(getByPath(body, path)))) return path;
  }
  return undefined;
}

function firstMatrixPath(bodies: readonly unknown[], candidates: readonly string[]): string | undefined {
  for (const path of candidates) {
    if (bodies.some((body) => isIntMatrix(getByPath(body, path)))) return path;
  }
  return undefined;
}

function firstArrayPath(bodies: readonly unknown[], candidates: readonly string[]): string | undefined {
  for (const path of candidates) {
    if (bodies.some((body) => Array.isArray(getByPath(body, path)))) return path;
  }
  return undefined;
}

function walkKeys(node: unknown, trail: string, depth: number, hits: string[], test: (key: string) => boolean): void {
  if (node === null || typeof node !== 'object' || depth > 5 || hits.length > 20) return;
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    const at = trail ? `${trail}.${key}` : key;
    if (test(key)) hits.push(at);
    walkKeys(value, at, depth + 1, hits, test);
  }
}

/** Paths and feature flags learned from this game's initialize and /bet bodies. */
export function learnPayload(bodies: readonly unknown[], spinsLearned = 0): PayloadLearning {
  const present = bodies.filter((body) => body !== undefined && body !== null);
  const evidence: string[] = [];
  const fields: PayloadFields = {
    balance: firstNumericPath(present, FIELD_CANDIDATES.balance),
    totalWin: firstNumericPath(present, FIELD_CANDIDATES.totalWin),
    transactionState: firstNumericPath(present, FIELD_CANDIDATES.transactionState),
    baseWin: firstNumericPath(present, FIELD_CANDIDATES.baseWin),
    bonusWin: firstNumericPath(present, FIELD_CANDIDATES.bonusWin),
    unresolvedSpin: firstNumericPath(present, FIELD_CANDIDATES.unresolvedSpin),
  };
  for (const [name, path] of Object.entries(fields)) {
    if (path) evidence.push(`${name} at ${path}`);
  }

  const areaPath = firstMatrixPath(present, AREA_CANDIDATES);
  if (areaPath) evidence.push(`reel area at ${areaPath}`);
  const tumblesPath = firstArrayPath(present, TUMBLE_CANDIDATES);
  if (tumblesPath) evidence.push(`tumbles at ${tumblesPath}`);

  let featureItemsPath: string | undefined;
  for (const body of present) {
    featureItemsPath = discoverFeatureItemsPath(body);
    if (featureItemsPath !== undefined) {
      evidence.push(`feature items at ${featureItemsPath}`);
      break;
    }
  }

  const features: Partial<Record<FeatureCapability, string>> = {};
  if (tumblesPath) features.tumble = `bet payload has ${tumblesPath}`;
  const freeSpinHits: string[] = [];
  const scatterHits: string[] = [];
  for (const body of present) {
    walkKeys(body, '', 0, freeSpinHits, (key) => /free[_]?spins?/iu.test(key));
    walkKeys(body, '', 0, scatterHits, (key) => /scatter/iu.test(key));
  }
  if (featureItemsPath) {
    features.freeSpins = `bet payload has ${featureItemsPath}`;
    features.scatterTrigger = `free-spin items in the payload imply a scatter trigger`;
  } else if (freeSpinHits[0]) {
    features.freeSpins = `initialize/bet exposes ${freeSpinHits[0]}`;
    if (scatterHits[0]) features.scatterTrigger = `payload exposes ${scatterHits[0]}`;
  }

  const maxWinHits: string[] = [];
  const multiplierHits: string[] = [];
  const retriggerHits: string[] = [];
  const scatterModeHits: string[] = [];
  for (const body of present) {
    walkKeys(body, '', 0, maxWinHits, (key) => /max[_]?win|winupto/iu.test(key));
    walkKeys(body, '', 0, multiplierHits, (key) => /multiplier/iu.test(key) && !/max/iu.test(key));
    walkKeys(body, '', 0, retriggerHits, (key) => /retrigger/iu.test(key));
    walkKeys(body, '', 0, scatterModeHits, (key) => /scattermode|scatter[_]?mode/iu.test(key));
  }
  if (maxWinHits[0]) features.maxWin = `initialize/bet exposes ${maxWinHits[0]}`;
  if (multiplierHits[0]) {
    features.normalModeMultiplier = `payload exposes ${multiplierHits[0]}`;
    features.multiplierWild = `payload exposes ${multiplierHits[0]}`;
  }
  if (retriggerHits[0]) features.freeSpinRetrigger = `payload exposes ${retriggerHits[0]}`;
  if (scatterModeHits[0]) features.scatterMode = `payload exposes ${scatterModeHits[0]}`;

  if (areaPath) {
    features.reelValidation = `reel area path ${areaPath} learned; symbol catalog still needs a probe of this title's art`;
  }

  return {
    fields,
    ...(areaPath !== undefined ? { areaPath } : {}),
    ...(tumblesPath !== undefined ? { tumblesPath } : {}),
    ...(featureItemsPath !== undefined ? { featureItemsPath } : {}),
    features,
    spinsLearned,
    evidence,
  };
}
