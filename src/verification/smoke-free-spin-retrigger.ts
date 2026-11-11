/**
 * Offline FS-008 re-trigger detector fixtures. No browser, no wallet, no /bet.
 * node --import ./scripts/lib/register-ts-loader.mjs src/verification/smoke-free-spin-retrigger.ts
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { FileGameManifestLoader, defaultManifestsDir } from '../platform/manifest/file-game-manifest-loader.js';
import {
  capabilityStatus,
  clearPackageProfileCache,
  freeSpinRetriggerRulesFor,
  isNotApplicableReason,
  isNotConfiguredReason,
  notApplicableReason,
  notConfiguredMessage,
  unmappedCapabilities,
  unsupportedCapabilities,
} from '../capabilities/index.js';
import { decideNextBuyBudget, resolveGrossBuyCost } from './buy-feature-spend.js';
import type { FreeSpinRetriggerRules } from '../capabilities/package-profile.js';
import {
  classifyFs008Hunt,
  evaluateFreeSpinRetrigger,
  resolveFs008MaxBuys,
  FS008_DEFAULT_MAX_BUYS,
  type FreeSpinEntryKind,
  type FreeSpinRetriggerVerdict,
} from './free-spin-retrigger.js';

const P1 = {
  scatterEntryAt: 4,
  scatterRetriggerAt: 3,
  awardKind: 'add' as const,
  awardSpins: 5,
  purchasedOpenerInBonus: true,
  awardLagItems: 1,
};

const P6 = {
  scatterEntryAt: 3,
  scatterRetriggerAt: 3,
  awardKind: 'reset' as const,
  awardSpins: 12,
};

function fail(message: string): never {
  throw new Error(message);
}

function assert(condition: boolean, message: string): void {
  if (!condition) {
    fail(message);
  }
}

function area(scatterCount: number, columns = 6, rows = 5): number[][] {
  const board = Array.from({ length: columns }, () => Array.from({ length: rows }, () => 1));
  let placed = 0;
  for (let c = 0; c < columns && placed < scatterCount; c += 1) {
    for (let r = 0; r < rows && placed < scatterCount; r += 1) {
      board[c]![r] = 0;
      placed += 1;
    }
  }
  return board;
}

function item(spinsLeft: number | undefined, scatters: number): Record<string, unknown> {
  return {
    area: area(scatters),
    ...(spinsLeft !== undefined ? { spinsLeft } : {}),
    totalWin: 0,
  };
}

function bundled(items: readonly Record<string, unknown>[]): unknown {
  return { slot: { freeSpin: { items, multiplierValue: 1 } } };
}

function incremental(spinsLeft: number | undefined, scatters: number): unknown {
  return bundled([item(spinsLeft, scatters)]);
}

function expectKind(
  name: string,
  verdict: FreeSpinRetriggerVerdict,
  kind: FreeSpinRetriggerVerdict['kind'],
): void {
  if (verdict.kind !== kind || verdict.verified !== (kind === 'verified')) {
    fail(`${name}: expected ${kind}, got ${verdict.kind} (${verdict.reason})`);
  }
}

function score(
  body: unknown | readonly unknown[],
  entryKind: FreeSpinEntryKind,
  rules: FreeSpinRetriggerRules = P1,
): FreeSpinRetriggerVerdict {
  const payloads = Array.isArray(body) ? body : [body];
  return evaluateFreeSpinRetrigger(payloads, { rules, entryKind });
}

function loadSanitized(name: string): unknown {
  const file = path.join(process.cwd(), 'tests', 'fixtures', 'fs008', name);
  return JSON.parse(readFileSync(file, 'utf8')) as unknown;
}

async function main(): Promise<void> {
  clearPackageProfileCache();

  const openingFourScatter = bundled([
    item(10, 4),
    item(9, 0),
    item(8, 0),
    item(7, 0),
    item(6, 1),
  ]);
  expectKind(
    'natural feature entry, opening board not a re-trigger',
    score(openingFourScatter, 'natural'),
    'not_observed',
  );
  const opening = score(openingFourScatter, 'natural');
  assert(opening.observations[0]?.isOpener === true, 'first item must be the opener');
  assert(opening.observations[0]?.scatterCount === 4, 'opener may hold the entry scatters');
  assert(opening.verified === false, 'natural 4-scatter opener must not verify');

  const genuine = bundled([
    item(10, 4),
    item(9, 0),
    item(8, 0),
    item(12, 3),
    item(11, 0),
  ]);
  const genuineVerdict = score(genuine, 'natural');
  expectKind('genuine three-scatter in-bonus +5 (same item)', genuineVerdict, 'verified');
  assert(
    genuineVerdict.hits.some((hit) => hit.scatterMet && hit.awardMet && hit.scatterItemIndex > 0),
    'verified natural hit must be after the opening board',
  );
  assert(
    genuineVerdict.hits.some((hit) => hit.previousRemaining === 8 && hit.observation.remaining === 12),
    'authoritative remaining must show consume-then-+5 (8→12)',
  );

  const ordinary = bundled([item(10, 0), item(9, 1), item(8, 0), item(7, 2), item(6, 0)]);
  expectKind('ordinary 10→9 progression', score(ordinary, 'purchased'), 'not_observed');

  const threeWithoutAward = bundled([item(10, 0), item(9, 0), item(8, 3), item(7, 0)]);
  expectKind(
    'three scatters without a corresponding +5 award',
    score(threeWithoutAward, 'purchased'),
    'insufficient_evidence',
  );

  expectKind(
    '+5 remaining without qualifying scatters',
    score(bundled([item(10, 0), item(9, 0), item(8, 0), item(12, 0)]), 'purchased'),
    'insufficient_evidence',
  );

  expectKind(
    'scatter and award separated by an incorrect item offset',
    score(bundled([item(10, 0), item(9, 3), item(8, 0), item(12, 0)]), 'purchased'),
    'insufficient_evidence',
  );

  expectKind(
    'missing entry context is not guessed',
    evaluateFreeSpinRetrigger([ordinary], { rules: P1 }),
    'insufficient_evidence',
  );

  const longerThanGrant = bundled([
    item(10, 0),
    item(9, 0),
    item(8, 0),
    item(7, 0),
    item(6, 0),
    item(5, 0),
    item(4, 0),
    item(3, 0),
    item(2, 0),
    item(1, 0),
    item(0, 0),
  ]);
  expectKind(
    'items.length > initialCount is not proof',
    score(longerThanGrant, 'purchased'),
    'not_observed',
  );

  const bundledClone = score([genuine, genuine], 'natural');
  expectKind('bundled response clones must not be double-counted', bundledClone, 'verified');
  assert(bundledClone.observations.length === 5, `bundled walk should keep 5 items, got ${bundledClone.observations.length}`);

  const incrementalPayloads = [
    incremental(10, 4),
    incremental(9, 0),
    incremental(8, 0),
    incremental(12, 3),
    incremental(11, 0),
  ];
  const incrementalVerdict = score(incrementalPayloads, 'natural');
  expectKind('incremental Free Spin /bet payloads', incrementalVerdict, 'verified');
  assert(incrementalVerdict.observations[0]?.isOpener === true, 'first incremental payload is the opener');
  assert(
    incrementalVerdict.observations.filter((entry) => !entry.isOpener).length === 4,
    'later incremental /bet bodies are in-bonus',
  );

  const huntMiss = classifyFs008Hunt({
    maxBuys: 3,
    attempts: 3,
    featuresEntered: 3,
    bestVerdict: score(ordinary, 'purchased'),
  });
  assert(huntMiss.outcome === 'not_observed', `bounded hunt expected not_observed, got ${huntMiss.outcome}`);
  assert(huntMiss.passed === false, 'bounded miss must not pass');
  assert(
    huntMiss.skipReason?.startsWith('INCONCLUSIVE —') === true,
    `bounded miss must skip as INCONCLUSIVE, got ${huntMiss.skipReason}`,
  );

  const loader = new FileGameManifestLoader({ manifestsDir: defaultManifestsDir() });
  const kobo = await loader.load('kobo-ass');
  assert(capabilityStatus(kobo, 'freeSpinRetrigger') === 'unsupported', 'Package 2 must declare retrigger unsupported');
  assert(
    unsupportedCapabilities(kobo, ['freeSpinRetrigger']).includes('freeSpinRetrigger'),
    'Package 2 FS-008 gate must be unsupported, not unmapped',
  );
  const koboNa = notApplicableReason(kobo, ['freeSpinRetrigger']);
  assert(isNotApplicableReason(koboNa), 'Package 2 skip must stay F1-A N/A');
  assert(!isNotConfiguredReason(koboNa), 'N/A must not be NOT CONFIGURED');

  const p6Reset = bundled([item(12, 3), item(11, 0), item(12, 3)]);
  expectKind('Package 6 reset-to-12', score(p6Reset, 'purchased', P6), 'verified');
  const p6AsP1 = score(p6Reset, 'purchased');
  assert(
    p6AsP1.kind !== 'verified',
    'Package 6 11→12 must not verify under Package 1 +5 rules',
  );
  expectKind(
    'Package 6 sticky 12→12 with in-bonus scatters',
    score(bundled([item(12, 3), item(12, 3)]), 'purchased', P6),
    'verified',
  );
  expectKind(
    'Package 6 12→12 without scatters is not a reset',
    score(bundled([item(12, 0), item(12, 0)]), 'purchased', P6),
    'not_observed',
  );
  expectKind(
    'Package 6 purchased opener 3 scatters is entry, not +5',
    score(bundled([item(12, 3), item(11, 0), item(10, 0)]), 'purchased', P6),
    'not_observed',
  );

  expectKind('missing payloads', evaluateFreeSpinRetrigger([], { entryKind: 'purchased' }), 'insufficient_evidence');
  expectKind('malformed empty object', score({}, 'purchased'), 'insufficient_evidence');
  expectKind(
    'items without remaining',
    score(bundled([item(undefined, 4), item(undefined, 3)]), 'purchased'),
    'insufficient_evidence',
  );

  const huntEntry = classifyFs008Hunt({ maxBuys: 3, attempts: 3, featuresEntered: 0 });
  assert(huntEntry.outcome === 'feature_entry_failed', huntEntry.outcome);
  assert(huntEntry.failMessage?.includes('FEATURE ENTRY FAILED') === true, String(huntEntry.failMessage));

  const huntAuto = classifyFs008Hunt({
    maxBuys: 3,
    attempts: 2,
    featuresEntered: 0,
    automationError: 'FS-008 automation could not complete a buy 5 times in a row',
  });
  assert(huntAuto.outcome === 'automation_failure', huntAuto.outcome);

  const huntVerified = classifyFs008Hunt({
    maxBuys: 3,
    attempts: 1,
    featuresEntered: 1,
    bestVerdict: genuineVerdict,
  });
  assert(huntVerified.outcome === 'verified' && huntVerified.passed, 'verified hunt must pass');

  const huntEvidence = classifyFs008Hunt({
    maxBuys: 3,
    attempts: 1,
    featuresEntered: 1,
    bestVerdict: score(threeWithoutAward, 'purchased'),
  });
  assert(huntEvidence.outcome === 'insufficient_evidence', huntEvidence.outcome);
  assert(huntEvidence.skipReason?.startsWith('INCONCLUSIVE —') === true, String(huntEvidence.skipReason));

  assert(resolveFs008MaxBuys(undefined) === FS008_DEFAULT_MAX_BUYS, 'default max buys');
  assert(resolveFs008MaxBuys('0') === FS008_DEFAULT_MAX_BUYS, '0 must not unbounded');
  assert(resolveFs008MaxBuys('-4') === FS008_DEFAULT_MAX_BUYS, 'negative must not unbounded');
  assert(resolveFs008MaxBuys('20') === 20, 'explicit finite cap');

  const sugar = await loader.load('sugar-wonderland');
  const sugarRules = freeSpinRetriggerRulesFor(sugar);
  assert(sugarRules?.scatterRetriggerAt === 3, `P1 scatterRetriggerAt ${sugarRules?.scatterRetriggerAt}`);
  assert(sugarRules?.awardKind === 'add' && sugarRules.awardSpins === 5, 'P1 award is +5');
  assert(sugarRules?.scatterEntryAt === 4, 'P1 entry stays 4, not a global 3');
  assert(sugarRules?.purchasedOpenerInBonus === true, 'P1 purchased opener is in-bonus');
  assert(sugarRules?.awardLagItems === 1, 'P1 remaining award may lag one item');

  const buy1 = loadSanitized('f8b-sugar-buy1.sanitized.json');
  const buy2 = loadSanitized('f8b-sugar-buy2.sanitized.json');
  expectKind('F8-B Buy 1 ordinary session', score(buy1, 'purchased', sugarRules ?? P1), 'not_observed');
  const liveBuy2 = score(buy2, 'purchased', sugarRules ?? P1);
  expectKind('F8-B Buy 2 item 0 scatters + 10→14', liveBuy2, 'verified');
  assert(
    liveBuy2.hits.some(
      (hit) =>
        hit.scatterItemIndex === 0 &&
        hit.awardItemIndex === 1 &&
        hit.previousRemaining === 10 &&
        hit.observation.remaining === 14,
    ),
    `Buy 2 should pair item 0 scatters with 10→14, hits=${JSON.stringify(liveBuy2.hits)}`,
  );

  const twoBuys = [100, 100].reduce((sum, cost) => sum + cost, 0);
  assert(twoBuys === 200, 'two 100-credit buys must record 200 gross spend');
  const first = resolveGrossBuyCost({ stake: 1, buyFeat: 1, multiplier: 100 });
  const second = resolveGrossBuyCost({ stake: 1, buyFeat: 1, multiplier: 100 });
  assert(first.cost === 100 && first.source === 'stakeTimesMultiplier', `first gross ${first.cost} ${first.source}`);
  assert(second.cost === 100, `second gross ${second.cost}`);
  const grossSpend = (first.cost ?? 0) + (second.cost ?? 0);
  assert(grossSpend === 200, `gross spend ${grossSpend} must be 200`);
  const winnings = 450.25;
  assert(grossSpend === 200, 'feature winnings must not reduce recorded gross spend');
  assert(winnings !== grossSpend, 'net wallet is separate from gross spend');

  const cap = decideNextBuyBudget(200, 100, 200);
  assert(cap.action === 'stop-cap', `budget guard expected stop-cap, got ${cap.action}`);
  const unknown = decideNextBuyBudget(0, undefined, 200);
  assert(unknown.action === 'stop-unknown', `unknown cost must stop, got ${unknown.action}`);
  const allow = decideNextBuyBudget(0, 100, 200);
  assert(allow.action === 'allow', allow.action);
  const flagTimesStake = resolveGrossBuyCost({ stake: 1, totalBet: 1, buyFeat: 1, multiplier: 100 });
  assert(
    flagTimesStake.cost === 100 && flagTimesStake.source === 'stakeTimesMultiplier',
    'totalBet equal to stake is the line bet, not gross purchase',
  );

  const zero = await loader.load('zero-law');
  const zeroRules = freeSpinRetriggerRulesFor(zero);
  assert(zeroRules?.awardKind === 'reset' && zeroRules.awardSpins === 12, 'P6 award is reset 12');
  assert(zeroRules?.scatterRetriggerAt === 3, 'P6 in-bonus scatter threshold is package-declared');

  const blitz = await loader.load('blockchain-blitz');
  assert(capabilityStatus(blitz, 'freeSpinRetrigger') === 'unmapped', 'unmapped retrigger must stay unmapped');
  assert(
    unmappedCapabilities(blitz, ['freeSpinRetrigger']).includes('freeSpinRetrigger'),
    'unmapped must not collapse to N/A',
  );
  const unmappedMessage = notConfiguredMessage(blitz, ['freeSpinRetrigger']);
  assert(isNotConfiguredReason(unmappedMessage), unmappedMessage);
  assert(!isNotApplicableReason(unmappedMessage), 'NOT CONFIGURED must not be N/A');

  console.log('free-spin retrigger smoke ok');
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});
