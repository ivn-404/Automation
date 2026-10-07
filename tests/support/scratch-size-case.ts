/**
 * Shared body for the per-size SCG cases (dimension, legend, minimum bet).
 * Each spec file keeps its own QA ID and title; only the grid size differs.
 */

import type { TestInfo } from '@playwright/test';

import type { ScratchCardController, ScratchGridSize } from '../../src/controllers/index.js';
import type { VerificationResult } from '../../src/core/models/index.js';
import {
  expectedScratchLegend,
  verifyScratchCardBought,
  verifyScratchCardSettled,
} from '../../src/verification/scratch-card-verification.js';
import {
  asNumber,
  attachDrawer,
  attachRound,
  buyAndScratchAll,
  expectChecks,
  readDrawerBet,
  readLegend,
  scratchCheck,
  walkBetToMinimum,
} from './scratch-flow.js';

/** Tap the size tab, buy: the card the hub deals has that dimension and the request carries the grid index. */
export async function verifySizeChangesDimension(
  scratch: ScratchCardController,
  size: ScratchGridSize,
  testInfo: TestInfo,
): Promise<void> {
  await scratch.open();
  await scratch.selectSize(size);
  const started = await scratch.buyCard();
  await attachRound(testInfo, 'scratch-start-round.json', started);
  await attachDrawer(testInfo, scratch, `scratch-${size}x${size}-dealt.png`);
  const settled = await scratch.scratchAll();
  const gridIndex = asNumber(started.requestArgs[1]);
  await expectChecks(testInfo, [
    scratchCheck(gridIndex === size - 3, `StartRound grid index ${gridIndex} for ${size}x${size}`, size - 3, gridIndex),
    ...verifyScratchCardBought(started, size),
    ...verifyScratchCardSettled(started, settled),
  ]);
}

/**
 * Legend drawn for the size exists, and after the hub confirms the size (StartRound)
 * it matches that size's paytable. A pre-buy legend that disagrees with the paytable
 * is reported as an annotation, not a failure.
 */
export async function verifyLegendForSize(
  scratch: ScratchCardController,
  size: ScratchGridSize,
  testInfo: TestInfo,
): Promise<void> {
  await scratch.open();
  await scratch.selectSize(size);
  const shownBefore = await readLegend(scratch);
  await attachDrawer(testInfo, scratch, `scratch-${size}x${size}-legend.png`);
  const started = await scratch.buyCard();
  await attachRound(testInfo, 'scratch-start-round.json', started);
  const shownAfter = await readLegend(scratch);
  await scratch.scratchAll();

  const expected = expectedScratchLegend(started.payTable);
  const same = (left: readonly string[], right: readonly string[]): boolean =>
    [...left].sort().join(' ') === [...right].sort().join(' ');
  if (!same(shownBefore, expected)) {
    testInfo.annotations.push({
      type: 'finding',
      description: `${size}x${size} legend before buying "${shownBefore.join(' ')}" differs from the ${size}x${size} paytable "${expected.join(' ')}"`,
    });
    console.log(`[scg] FINDING ${size}x${size} pre-buy legend "${shownBefore.join(' ')}" vs paytable "${expected.join(' ')}"`);
  }
  await expectChecks(testInfo, [
    scratchCheck(shownBefore.length > 0, `${size}x${size} legend drawn: ${shownBefore.join(' ')}`, '≥ 1 label', shownBefore),
    scratchCheck(
      same(shownAfter, expected),
      `${size}x${size} legend "${shownAfter.join(' ')}" matches the ${size}x${size} paytable "${expected.join(' ')}"`,
      expected,
      shownAfter,
    ),
  ]);
}

/** Walk bet − to its floor, buy, press − again, buy: both cards cost the floor, never less. */
export async function verifyMinimumBetForSize(
  scratch: ScratchCardController,
  size: ScratchGridSize,
  testInfo: TestInfo,
): Promise<void> {
  await scratch.open();
  await scratch.selectSize(size);
  const floor = await walkBetToMinimum(scratch);
  const first = await buyAndScratchAll(scratch);
  await scratch.adjustBet('minus', 3);
  const after = await readDrawerBet(scratch);
  const second = await buyAndScratchAll(scratch);
  await attachRound(testInfo, 'scratch-start-round-floor.json', first.started);
  await attachRound(testInfo, 'scratch-start-round-after-extra-minus.json', second.started);

  const config = (first.started.raw as { config?: { minBet?: unknown } } | null)?.config;
  const minBet = asNumber(config?.minBet);
  const sentFirst = asNumber(first.started.requestArgs[0]);
  const sentSecond = asNumber(second.started.requestArgs[0]);
  const checks: VerificationResult[] = [
    scratchCheck(floor.amount > 0, `${size}x${size} bet floor drawn ${floor.text}`, '> 0', floor.amount),
    scratchCheck(sentFirst === floor.amount, `Card at floor sent bet ${sentFirst}`, floor.amount, sentFirst),
    scratchCheck(after?.amount === floor.amount, `Extra − ×3 keeps drawn bet ${after?.text}`, floor.amount, after?.amount),
    scratchCheck(sentSecond === sentFirst, `Next card still sent bet ${sentSecond}`, sentFirst, sentSecond),
    scratchCheck(
      second.started.betAmount === first.started.betAmount,
      `Hub bet ${first.started.betAmount} → ${second.started.betAmount}`,
      first.started.betAmount,
      second.started.betAmount,
    ),
  ];
  if (minBet !== undefined) {
    checks.push(
      scratchCheck(floor.amount >= minBet, `Floor ${floor.amount} ≥ hub minBet ${minBet}`, `≥ ${minBet}`, floor.amount),
    );
  }
  await expectChecks(testInfo, checks);
}
