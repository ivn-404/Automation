/**
 * Distinguish a genuine in-bonus free-spin re-trigger from ordinary progression.
 *
 * Purchased vs natural entry is required. Item-count growth is never proof.
 * Pass requires package-declared scatter + remaining-award evidence on in-bonus boards.
 */

import type { FreeSpinRetriggerRules } from '../capabilities/package-profile.js';
import { getFreeSpinItems, isFreeSpinBundleComplete } from '../shared/spin-payload-discovery.js';

export type { FreeSpinRetriggerRules };

/** How the free-spin session started. Missing context is insufficient evidence, not a guess. */
export type FreeSpinEntryKind = 'purchased' | 'natural';

/** Default FS-008 buy cap. 0 / missing / invalid env values fall back here — never unbounded. */
export const FS008_DEFAULT_MAX_BUYS = 3;

export const REMAINING_FIELD_CANDIDATES = [
  'spinsLeft',
  'spinsRemaining',
  'remaining',
  'roundsLeft',
  'freeSpinsLeft',
  'left',
] as const;

export type RetriggerEvidenceKind = 'verified' | 'not_observed' | 'insufficient_evidence';

export type Fs008HuntOutcome =
  | 'verified'
  | 'not_observed'
  | 'feature_entry_failed'
  | 'automation_failure'
  | 'insufficient_evidence'
  | 'budget_error';

export interface FreeSpinItemObservation {
  readonly payloadIndex: number;
  readonly itemIndex: number;
  readonly isOpener: boolean;
  readonly scatterCount: number;
  readonly remaining: number | undefined;
}

export interface RetriggerHit {
  readonly observation: FreeSpinItemObservation;
  readonly scatterItemIndex: number;
  readonly awardItemIndex: number;
  readonly previousRemaining: number | undefined;
  readonly awardedSpins: number | undefined;
  readonly scatterMet: boolean;
  readonly awardMet: boolean;
}

export interface FreeSpinRetriggerVerdict {
  readonly kind: RetriggerEvidenceKind;
  readonly verified: boolean;
  readonly hits: readonly RetriggerHit[];
  readonly observations: readonly FreeSpinItemObservation[];
  readonly reason: string;
}

export interface Fs008HuntClassification {
  readonly outcome: Fs008HuntOutcome;
  readonly passed: boolean;
  readonly skipReason?: string;
  readonly failMessage?: string;
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

export function countScatterInArea(area: unknown, scatterIds: ReadonlySet<number>): number {
  if (!Array.isArray(area)) {
    return 0;
  }
  let count = 0;
  for (const column of area) {
    if (!Array.isArray(column)) {
      continue;
    }
    for (const id of column) {
      if (scatterIds.has(Number(id))) {
        count += 1;
      }
    }
  }
  return count;
}

function payloadsToWalk(payloads: readonly unknown[]): readonly unknown[] {
  const bundled = payloads.find((body) => isFreeSpinBundleComplete(body));
  if (bundled !== undefined) {
    return [bundled];
  }
  return payloads;
}

function awardMatches(
  previousRemaining: number | undefined,
  remaining: number | undefined,
  rules: FreeSpinRetriggerRules | undefined,
  scatterMet: boolean,
): { readonly awardMet: boolean; readonly awardedSpins: number | undefined } {
  if (previousRemaining === undefined || remaining === undefined) {
    return { awardMet: false, awardedSpins: undefined };
  }
  const awardedSpins = remaining - previousRemaining;
  const awardSpins = rules?.awardSpins;
  const awardKind = rules?.awardKind;

  if (awardKind === 'add' && awardSpins !== undefined) {
    const consumeThenAdd = remaining === previousRemaining - 1 + awardSpins;
    const addWithoutConsume = remaining === previousRemaining + awardSpins;
    return { awardMet: consumeThenAdd || addWithoutConsume, awardedSpins };
  }

  if (awardKind === 'reset' && awardSpins !== undefined) {
    const resetToAward = remaining === awardSpins;
    if (remaining === previousRemaining) {
      return { awardMet: scatterMet && resetToAward, awardedSpins };
    }
    const ordinaryConsume = remaining === previousRemaining - 1;
    return { awardMet: resetToAward && !ordinaryConsume, awardedSpins };
  }

  // No package award size: only an authoritative remaining increase counts.
  return { awardMet: remaining > previousRemaining, awardedSpins };
}

function itemIsInBonus(
  itemIndex: number,
  entryKind: FreeSpinEntryKind,
  rules: FreeSpinRetriggerRules | undefined,
): boolean {
  if (itemIndex > 0) {
    return true;
  }
  return entryKind === 'purchased' && rules?.purchasedOpenerInBonus === true;
}

/**
 * Score one free-spin session (one bundled payload, or opener + later /bet bodies).
 * Pass a bundled body once — snapshots cloned from the same bundle are ignored.
 */
export function evaluateFreeSpinRetrigger(
  payloads: readonly unknown[],
  options?: {
    readonly rules?: FreeSpinRetriggerRules;
    readonly scatterIds?: ReadonlySet<number>;
    readonly entryKind?: FreeSpinEntryKind;
  },
): FreeSpinRetriggerVerdict {
  const rules = options?.rules;
  const scatterIds = options?.scatterIds ?? new Set([0]);
  const entryKind = options?.entryKind;
  const emptyHits: RetriggerHit[] = [];

  if (entryKind !== 'purchased' && entryKind !== 'natural') {
    return {
      kind: 'insufficient_evidence',
      verified: false,
      hits: emptyHits,
      observations: [],
      reason: 'Feature-entry context was not established (purchased vs natural)',
    };
  }

  const bodies = payloadsToWalk(payloads);
  const observations: FreeSpinItemObservation[] = [];
  const hits: RetriggerHit[] = [];

  for (const [payloadIndex, body] of bodies.entries()) {
    const items = getFreeSpinItems(body);
    items.forEach((entry, itemIndex) => {
      if (typeof entry !== 'object' || entry === null) {
        return;
      }
      const typed = entry as Record<string, unknown>;
      observations.push({
        payloadIndex,
        itemIndex,
        isOpener: observations.length === 0,
        scatterCount: countScatterInArea(typed.area, scatterIds),
        remaining: remainingFromEntry(typed),
      });
    });
  }

  if (observations.length === 0) {
    return {
      kind: 'insufficient_evidence',
      verified: false,
      hits,
      observations,
      reason: 'No free-spin items with board data in the supplied payloads',
    };
  }

  const scatterThreshold = rules?.scatterRetriggerAt;
  const scatterRequired = scatterThreshold !== undefined;
  const awardLag = rules?.awardLagItems ?? 0;
  let sawInBonusScatterWithoutAward = false;
  let sawAwardWithoutScatter = false;

  const scatterMetAt = (index: number): boolean => {
    const observation = observations[index];
    if (observation === undefined || !itemIsInBonus(index, entryKind, rules)) {
      return false;
    }
    return scatterRequired ? observation.scatterCount >= scatterThreshold : false;
  };

  for (let index = 0; index < observations.length; index += 1) {
    const observation = observations[index]!;
    const inBonus = itemIsInBonus(index, entryKind, rules);
    const scatterMet = scatterMetAt(index);

    if (index > 0 && inBonus) {
      const previous = observations[index - 1]!;
      const sameItem = awardMatches(previous.remaining, observation.remaining, rules, scatterMet);
      const laggedScatter = awardLag >= 1 && scatterMetAt(index - 1);
      const pairedScatter = scatterMet || laggedScatter;
      if (sameItem.awardMet && (!scatterRequired || pairedScatter)) {
        hits.push({
          observation,
          scatterItemIndex: scatterMet ? index : laggedScatter ? index - 1 : index,
          awardItemIndex: index,
          previousRemaining: previous.remaining,
          awardedSpins: sameItem.awardedSpins,
          scatterMet: pairedScatter,
          awardMet: true,
        });
      } else if (scatterRequired && sameItem.awardMet) {
        sawAwardWithoutScatter = true;
      }
    }

    if (scatterMet) {
      const awardOnThis =
        index > 0 &&
        awardMatches(
          observations[index - 1]!.remaining,
          observation.remaining,
          rules,
          true,
        ).awardMet;
      const next = observations[index + 1];
      const awardOnNext =
        awardLag >= 1 &&
        next !== undefined &&
        awardMatches(observation.remaining, next.remaining, rules, true).awardMet;
      if (!awardOnThis && !awardOnNext) {
        sawInBonusScatterWithoutAward = true;
      }
    }
  }

  const verifiedHit = hits.find((hit) => hit.awardMet && (!scatterRequired || hit.scatterMet));
  if (verifiedHit !== undefined) {
    const remainingText =
      verifiedHit.previousRemaining !== undefined && verifiedHit.observation.remaining !== undefined
        ? `${verifiedHit.previousRemaining}→${verifiedHit.observation.remaining}`
        : 'unknown remaining';
    const scatterBoard = observations[verifiedHit.scatterItemIndex];
    return {
      kind: 'verified',
      verified: true,
      hits,
      observations,
      reason:
        `In-bonus re-trigger verified (${remainingText}, scatters=${scatterBoard?.scatterCount ?? '?'} ` +
        `on item ${verifiedHit.scatterItemIndex}→award item ${verifiedHit.awardItemIndex}` +
        `${rules?.awardKind !== undefined ? `, ${rules.awardKind} ${rules.awardSpins ?? '?'}` : ''})`,
    };
  }

  const hasRemaining = observations.some((entry) => entry.remaining !== undefined);
  if (!hasRemaining) {
    return {
      kind: 'insufficient_evidence',
      verified: false,
      hits,
      observations,
      reason: 'Free-spin items have no remaining/spinsLeft field to prove an award',
    };
  }

  if (sawInBonusScatterWithoutAward || sawAwardWithoutScatter) {
    const detail = sawInBonusScatterWithoutAward
      ? 'in-bonus scatters met the package threshold without an authoritative remaining award'
      : 'remaining increased without in-bonus scatters meeting the package threshold';
    return {
      kind: 'insufficient_evidence',
      verified: false,
      hits,
      observations,
      reason: `Insufficient re-trigger evidence: ${detail}`,
    };
  }

  return {
    kind: 'not_observed',
    verified: false,
    hits,
    observations,
    reason: 'Ordinary free-spin progression — no in-bonus re-trigger in these payloads',
  };
}

const INCONCLUSIVE_PREFIX = 'INCONCLUSIVE —';

export function resolveFs008MaxBuys(raw?: string): number {
  const parsed = Number(raw ?? FS008_DEFAULT_MAX_BUYS);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return FS008_DEFAULT_MAX_BUYS;
  }
  return Math.floor(parsed);
}

export function classifyFs008Hunt(input: {
  readonly maxBuys: number;
  readonly attempts: number;
  readonly featuresEntered: number;
  readonly automationError?: string;
  readonly budgetError?: string;
  readonly bestVerdict?: FreeSpinRetriggerVerdict;
}): Fs008HuntClassification {
  if (input.budgetError !== undefined && input.budgetError.length > 0) {
    return {
      outcome: 'budget_error',
      passed: false,
      failMessage: input.budgetError,
    };
  }

  if (input.automationError !== undefined && input.automationError.length > 0) {
    return {
      outcome: 'automation_failure',
      passed: false,
      failMessage: input.automationError,
    };
  }

  if (input.bestVerdict?.verified === true) {
    return {
      outcome: 'verified',
      passed: true,
    };
  }

  if (input.featuresEntered <= 0) {
    return {
      outcome: 'feature_entry_failed',
      passed: false,
      failMessage:
        `FS-008 FEATURE ENTRY FAILED — no free-spin feature after ${input.attempts} bounded buy(s) ` +
        `(cap ${input.maxBuys})`,
    };
  }

  if (input.bestVerdict?.kind === 'insufficient_evidence') {
    return {
      outcome: 'insufficient_evidence',
      passed: false,
      skipReason: `${INCONCLUSIVE_PREFIX} insufficient payload evidence: ${input.bestVerdict.reason}`,
    };
  }

  return {
    outcome: 'not_observed',
    passed: false,
    skipReason:
      `${INCONCLUSIVE_PREFIX} re-trigger not observed within ${input.maxBuys} buy(s) ` +
      `(${input.featuresEntered} feature(s) entered) — not a product defect`,
  };
}
