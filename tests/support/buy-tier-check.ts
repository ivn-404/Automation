/**
 * Buys one tier of a multi-choice buy panel and checks its price and start multiplier.
 *
 * Tier N reads manifest metadata:
 *  - cost: buyFeatureOptionNMultiplier (tier 1 falls back to buyFeatureMultiplier)
 *  - start: buyFeatureOptionNStartMultiplier (unset = random tier, priced from the scatter table)
 *  - start grid: buyFeatureOptionNStartGridValue, the opening cell value when it is not the
 *    start itself (an unmarked 0 board for a 1× start)
 *  - scatters: buyFeatureOptionNScatters, the minimum the tier guarantees
 * With metadata.buyFeatureStartMultiplierPath (per feature item) the start is the first
 * multiplier on a winning free spin before any retrigger; metadata.featureStartMultipliers
 * ("3:8,4:16") prices it from the scatters actually dealt on the trigger board
 * (metadata.featureTriggerScatterPaths). Otherwise the opening per-cell grid is read.
 */

import type { Page, Response, TestInfo } from '@playwright/test';

import { matchesBetUrl } from '../../src/network/bet-url.js';

import { expect } from '../fixtures/index.js';
import { settleCanvasToBaseGame } from '../../src/platform/index.js';
import { getAllByPath, getByPath, toAmountString } from '../../src/shared/json-path.js';
import {
  InMemoryExecutionTracker,
  createDefaultExecutionReporters,
} from '../../src/reporting/index.js';
import { buyFeatureForBet, spinForBet } from './canvas-bet-flow.js';
import { readLauncherBalance } from './launcher-balance.js';
import { readFreeSpinSession } from './free-spin-flow.js';
import { getFreeSpinItems } from '../../src/shared/spin-payload-discovery.js';
import { loadPackageCatalog } from '../../src/verification/reel/package-catalog.js';
import { ensureBaseHud } from './session-guard.js';
import type { VerificationResult } from '../../src/core/models/index.js';
import type { SgapSession } from '../fixtures/index.js';
import type { PlaywrightGameDriver } from '../../src/driver/playwright-game-driver.js';

export interface BuyTierSpec {
  readonly tier: number;
  readonly selectAction: string;
  readonly costMultiplier: number;
  readonly startMultiplier: number | undefined;
  /** Opening grid cell value; differs from the start when an unmarked board means 1×. */
  readonly startGridValue: number | undefined;
  readonly minScatters: number | undefined;
}

function optionalNumber(raw: string | undefined): number | undefined {
  const value = Number(raw);
  return raw !== undefined && raw.trim() !== '' && Number.isFinite(value) ? value : undefined;
}

/** Tier N from manifest metadata, or undefined when the manifest does not declare it. */
export function buyTierSpec(
  manifest: SgapSession['manifest'],
  tier: number,
): BuyTierSpec | undefined {
  const metadata = manifest.metadata ?? {};
  const selectAction = `buyFeatureOption${tier}`;
  const selections = optionalNumber(metadata.buyFeatureSelections) ?? 1;
  const costMultiplier = optionalNumber(
    metadata[`buyFeatureOption${tier}Multiplier`] ?? (tier === 1 ? metadata.buyFeatureMultiplier : undefined),
  );
  if (tier > selections || manifest.canvasActions?.actions[selectAction] === undefined || costMultiplier === undefined) {
    return undefined;
  }
  return {
    tier,
    selectAction,
    costMultiplier,
    startMultiplier: optionalNumber(metadata[`buyFeatureOption${tier}StartMultiplier`]),
    startGridValue: optionalNumber(
      metadata[`buyFeatureOption${tier}StartGridValue`] ?? metadata[`buyFeatureOption${tier}StartMultiplier`],
    ),
    minScatters: optionalNumber(metadata[`buyFeatureOption${tier}Scatters`]),
  };
}

/** "3:8,4:16,5:32" — start multiplier by scatters dealt on the trigger board. */
function parseStartTable(raw: string | undefined): ReadonlyMap<number, number> {
  const table = new Map<number, number>();
  for (const pair of (raw ?? '').split(',')) {
    const [scatters, start] = pair.split(':').map(Number);
    if (Number.isInteger(scatters) && Number.isFinite(start)) {
      table.set(scatters!, start!);
    }
  }
  return table;
}

function startForScatters(table: ReadonlyMap<number, number>, scatters: number): number | undefined {
  const keys = [...table.keys()].filter((key) => key <= scatters).sort((a, b) => b - a);
  return keys.length > 0 ? table.get(keys[0]!) : undefined;
}

/** Scatters on the board that opened the feature (base area plus symbols dropped in by its tumbles). */
function triggerScatterCount(body: unknown, gameId: string, pathsRaw: string | undefined): number {
  let scatterIds: ReadonlySet<number>;
  try {
    scatterIds = new Set(
      loadPackageCatalog(gameId).symbols.filter((symbol) => symbol.kind === 'scatter').map((symbol) => symbol.id),
    );
  } catch {
    scatterIds = new Set([0]);
  }
  const paths = (pathsRaw ?? 'slot.area').split(',').map((path) => path.trim()).filter(Boolean);
  return paths
    .flatMap((path) => getAllByPath(body, path))
    .flat(Number.POSITIVE_INFINITY as 1)
    .filter((cell) => scatterIds.has(Number(cell))).length;
}

/** First multiplier on a winning free spin, stopping at a retrigger (which raises it). */
function firstFeatureMultiplier(
  items: readonly unknown[],
  itemPath: string,
): { readonly first: number | undefined; readonly retriggered: boolean } {
  let previousLeft: number | undefined;
  for (const item of items) {
    const typed = (item ?? {}) as { spinsLeft?: unknown; spinsRemaining?: unknown };
    const left = Number(typed.spinsLeft ?? typed.spinsRemaining);
    if (previousLeft !== undefined && Number.isFinite(left) && left > previousLeft) {
      return { first: undefined, retriggered: true };
    }
    if (Number.isFinite(left)) {
      previousLeft = left;
    }
    const first = getAllByPath(item, itemPath).map(Number).find((value) => Number.isFinite(value));
    if (first !== undefined) {
      return { first, retriggered: false };
    }
  }
  return { first: undefined, retriggered: false };
}

/** Spin bodies are flat; some buy bodies nest the payload under data. */
function payloadRoot(raw: unknown): unknown {
  if (raw === null || typeof raw !== 'object') {
    return raw;
  }
  if (getByPath(raw, 'balance') !== undefined) {
    return raw;
  }
  const data = (raw as { data?: unknown }).data;
  return data !== null && typeof data === 'object' ? data : raw;
}

/**
 * Some servers credit a bought feature's win on the next bet, and a session can reopen on an
 * unfinished feature whose replay swallows the first spin taps. Spin until two captured spins
 * reconcile (balance = previous − stake + win) and return that server balance.
 */
export async function settleWalletWithSpins(
  sgapSession: SgapSession,
  sgapDriver: PlaywrightGameDriver,
  page: Page,
  maxSpins = 5,
): Promise<string | undefined> {
  let previous: Awaited<ReturnType<typeof spinForBet>> | undefined;
  for (let attempt = 0; attempt < maxSpins; attempt += 1) {
    const next = await spinForBet(sgapSession, sgapDriver, page).catch(() => undefined);
    if (next === undefined) continue;
    if (previous !== undefined) {
      const expected =
        Number(previous.balance?.amount ?? 'NaN') -
        Number(next.bet?.amount ?? 'NaN') +
        Number(next.win?.amount ?? 0);
      if (Math.abs(expected - Number(next.balance?.amount ?? 'NaN')) < 0.02) {
        return next.balance?.amount;
      }
    }
    previous = next;
  }
  return previous?.balance?.amount;
}

export async function runBuyTierCheck(
  args: {
    readonly sgapSession: SgapSession;
    readonly sgapDriver: PlaywrightGameDriver;
    readonly page: Page;
    readonly testInfo: TestInfo;
  },
  manualTestId: string,
  spec: BuyTierSpec,
): Promise<void> {
  const { sgapSession, sgapDriver, page, testInfo } = args;
  const label = `Buy tier ${spec.tier}`;
  const tracker = new InMemoryExecutionTracker();
  await tracker.start(manualTestId, testInfo.project.name);
  testInfo.annotations.push(
    { type: 'manualTestId', description: manualTestId },
    { type: 'category', description: 'BF' },
    { type: 'gameId', description: sgapSession.manifest.gameId },
    { type: 'buyTier', description: String(spec.tier) },
  );

  const verificationResults: VerificationResult[] = [];
  try {
    await expect(sgapDriver.isAttached()).resolves.toBe(true);
    await ensureBaseHud(sgapSession, sgapDriver, page);
    await settleCanvasToBaseGame(
      page,
      sgapDriver,
      sgapSession.manifest,
      sgapSession.platform.getInitializeBody(),
    );

    const settledBalance = await settleWalletWithSpins(sgapSession, sgapDriver, page);
    // Buy healing can land a normal spin before the purchase; measure from the last one.
    const seen: Promise<unknown>[] = [];
    const onResponse = (response: Response) => {
      if (response.ok() && matchesBetUrl(response.url())) {
        seen.push(response.json().catch(() => undefined));
      }
    };
    page.on('response', onResponse);
    const bet = await buyFeatureForBet(sgapSession, sgapDriver, page, { selectAction: spec.selectAction }).finally(
      () => page.off('response', onResponse),
    );
    const bodies = await Promise.all(seen);
    const purchaseIndex = bodies.findIndex((candidate) => JSON.stringify(candidate) === JSON.stringify(bet.raw));
    const strays = purchaseIndex > 0 ? bodies.slice(0, purchaseIndex) : [];
    const strayBalance =
      strays.length > 0 ? toAmountString(getByPath(payloadRoot(strays[strays.length - 1]), 'balance')) : undefined;
    const before =
      strayBalance ??
      settledBalance ??
      (await readLauncherBalance(page))?.toString() ??
      sgapSession.initializeBalance?.amount;
    const body = payloadRoot(bet.raw);
    const after = bet.balance?.amount ?? toAmountString(getByPath(body, 'balance'));
    const win = bet.win?.amount ?? toAmountString(getByPath(body, 'slot.totalWin'));
    const stake = bet.requestStake ?? Number(bet.bet?.amount ?? 'NaN');
    const expectedCost = stake * spec.costMultiplier;
    // Buy responses keep balance at the post-debit wallet. slot.totalWin is the
    // package win and is not credited yet, so the cash cost is before − after.
    const walletCost = Number(before ?? 'NaN') - Number(after ?? 'NaN');
    const cost =
      bet.requestTotalBet ??
      (Number.isFinite(walletCost) && walletCost >= 0 ? walletCost : undefined);
    const costMatches = cost !== undefined && Number.isFinite(cost) && Math.abs(cost - expectedCost) < 0.02;
    verificationResults.push({
      kind: 'bet',
      passed: costMatches,
      message: costMatches
        ? `${label} cost ${cost} = stake ${stake} × ${spec.costMultiplier} (buyFeat ${bet.requestBuyFeat ?? 'unset'}, win ${win} held aside${strays.length > 0 ? `, measured after ${strays.length} stray spin(s)` : ''})`
        : `${label} cost ${cost} is not stake ${stake} × ${spec.costMultiplier} (before ${before}, after ${after}, win ${win}, buyFeat ${bet.requestBuyFeat ?? 'unset'})`,
      expected: expectedCost,
      actual: cost,
    });

    const metadata = sgapSession.manifest.metadata ?? {};
    const itemPath = metadata.buyFeatureStartMultiplierPath;
    const startTable = parseStartTable(metadata.featureStartMultipliers);
    const spinsTable = parseStartTable(metadata.featureScatterSpins);
    const scatters =
      metadata.featureTriggerScatterPaths !== undefined
        ? triggerScatterCount(body, sgapSession.manifest.gameId, metadata.featureTriggerScatterPaths)
        : undefined;
    if (scatters !== undefined && spec.minScatters !== undefined) {
      verificationResults.push({
        kind: 'bet',
        passed: scatters >= spec.minScatters,
        message: `Trigger board dealt ${scatters} scatter(s); ${label.toLowerCase()} guarantees ${spec.minScatters}`,
        expected: spec.minScatters,
        actual: scatters,
      });
    }
    if (scatters !== undefined && spinsTable.size > 0) {
      const expectedSpins = startForScatters(spinsTable, scatters);
      const opening = readFreeSpinSession(bet.raw, { manifest: sgapSession.manifest })?.initialCount;
      verificationResults.push({
        kind: 'bet',
        passed: expectedSpins !== undefined && opening === expectedSpins,
        message:
          opening === expectedSpins
            ? `${scatters} scatter(s) opened ${opening} free spins (featureScatterSpins ${metadata.featureScatterSpins})`
            : `${scatters} scatter(s) opened ${opening ?? 'no'} free spins, expected ${expectedSpins ?? 'an entry in featureScatterSpins'}`,
        expected: expectedSpins,
        actual: opening,
      });
    }
    if (itemPath !== undefined) {
      let expectedStart = spec.startMultiplier;
      if (startTable.size > 0 && scatters !== undefined) {
        expectedStart = startForScatters(startTable, scatters) ?? spec.startMultiplier;
      }
      const { first, retriggered } = firstFeatureMultiplier(getFreeSpinItems(body), itemPath);
      verificationResults.push({
        kind: 'bet',
        passed: expectedStart !== undefined && first === expectedStart,
        message:
          expectedStart === undefined
            ? `${label} has no start multiplier in config to compare`
            : first === expectedStart
              ? `Feature starts at ${expectedStart}× (${itemPath} on the first winning free spin)`
              : first === undefined
                ? `No winning free spin${retriggered ? ' before the first retrigger' : ''} to confirm the ${expectedStart}× start`
                : `Feature starts at ${first}×, not ${expectedStart}× (${itemPath})`,
        expected: expectedStart,
        actual: first,
      });
    } else if (spec.startGridValue !== undefined) {
      const startGrid = getByPath(body, 'slot.freeSpin.items.0.multipliers');
      const startCells = Array.isArray(startGrid) ? startGrid.flat(2).map((cell) => Number(cell)) : [];
      const started = startCells.length > 0 && startCells.every((cell) => cell === spec.startGridValue);
      const shown =
        spec.startGridValue === spec.startMultiplier
          ? `${spec.startMultiplier}×`
          : `${spec.startMultiplier}× (cells ${spec.startGridValue}, unmarked)`;
      verificationResults.push({
        kind: 'bet',
        passed: started,
        message: started
          ? `Feature starts at ${shown} across ${startCells.length} cells (slot.freeSpin.items[0].multipliers)`
          : `Opening multiplier grid is not all ${spec.startGridValue} for a ${spec.startMultiplier}× start`,
        expected: spec.startGridValue,
        actual: startCells.slice(0, 8),
      });
    }

    const featureItems = getByPath(body, 'slot.freeSpin.items');
    verificationResults.push({
      kind: 'bet',
      passed: Array.isArray(featureItems) && featureItems.length > 0,
      message:
        Array.isArray(featureItems) && featureItems.length > 0
          ? `Buy opened ${featureItems.length} free spins`
          : 'Buy response has no slot.freeSpin.items',
      actual: Array.isArray(featureItems) ? featureItems.length : featureItems,
    });

    await testInfo.attach(`buy-tier-${spec.tier}.json`, {
      body: JSON.stringify({ spec, before, after, stake, cost, win, verificationResults, response: bet.raw }, null, 2),
      contentType: 'application/json',
    });
    for (const result of verificationResults) {
      expect(result.passed, result.message).toBe(true);
    }
    await tracker.record({
      manualTestId,
      status: 'passed',
      startedAt: (await tracker.get(manualTestId))!.startedAt,
      finishedAt: new Date().toISOString(),
      browserProject: testInfo.project.name,
      verificationResults,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    await tracker.finish(manualTestId, 'failed', message);
    throw error;
  } finally {
    await createDefaultExecutionReporters().publish(await tracker.list());
  }
}
