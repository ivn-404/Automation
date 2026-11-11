/**
 * FS-008 — Feature / Free Spins
 *
 * Manual Test Case ID: FS-008
 * Intent: Scatter retriggers correctly during Feature — mid-feature boards can
 * award extra free spins. The opening feature event is never proof.
 *
 * Package 1: in-bonus 3+ scatters add 5. Other packages use their declared rules.
 * Default regression is a bounded sample. RNG miss is INCONCLUSIVE, not a defect.
 * SGAP_FS008_MAX_BUYS caps the loop (invalid / 0 → 3). Wallet refill is off unless
 * SGAP_FS008_REFILL_WALLET=1.
 */

import { test, expect } from '../../fixtures/index.js';
import { requireCapabilities } from '../../support/capabilities.js';
import { settleCanvasToBaseGame } from '../../../src/platform/index.js';
import {
  InMemoryExecutionTracker,
  createDefaultExecutionReporters,
} from '../../../src/reporting/index.js';
import { buyFeatureForBet } from '../../support/canvas-bet-flow.js';
import {
  featureEnteredFromBody,
  resolveBuyFeatureMultiplier,
} from '../../support/buy-feature-verify.js';
import { resetStakeToMinimum, resolveBetLevels } from '../../support/canvas-bet-control.js';
import { drainFreeSpins } from '../../support/free-spin-flow.js';
import {
  STAGING_DEFAULT_BET_LIMIT,
  STAGING_DEFAULT_WALLET,
  readLauncherBalance,
  readLauncherBetRemaining,
  restoreStagingWallet,
  setLauncherBetLimit,
} from '../../support/launcher-balance.js';
import { getLauncherMode } from '../../fixtures/local-launcher-html.js';
import { freeSpinRetriggerRulesFor } from '../../../src/capabilities/index.js';
import {
  classifyFs008Hunt,
  countScatterInArea,
  decideNextBuyBudget,
  evaluateFreeSpinRetrigger,
  resolveFs008MaxBuys,
  resolveGrossBuyCost,
  type FreeSpinRetriggerVerdict,
} from '../../../src/verification/index.js';
import { nearestBetLevelIndex } from '../../../src/shared/bet-levels.js';
import { getFreeSpinItems, isFreeSpinBundleComplete } from '../../../src/shared/spin-payload-discovery.js';
import type { VerificationResult } from '../../../src/core/models/index.js';

const MANUAL_TEST_ID = 'FS-008' as const;
const MAX_BUYS = resolveFs008MaxBuys(process.env.SGAP_FS008_MAX_BUYS);
const REFILL_WALLET = process.env.SGAP_FS008_REFILL_WALLET === '1';
const TARGET_BET = Number(process.env.SGAP_FS008_TARGET_BET ?? '');
const MAX_SPEND = Math.max(0, Number(process.env.SGAP_FS008_MAX_SPEND ?? 0) || 0);
const MAX_CONSECUTIVE_ERRORS = 5;
/** Refill once the wallet or wager cap cannot cover this many more buys. */
const RESERVE_BUYS = 5;
const MIN_RESERVE = 2_000;

function scatterIdsFor(manifest: { reelValidation?: { symbols?: readonly { id: number; kind?: string }[] } }): ReadonlySet<number> {
  const ids = (manifest.reelValidation?.symbols ?? [])
    .filter((entry) => entry.kind === 'scatter')
    .map((entry) => entry.id);
  return new Set(ids.length > 0 ? ids : [0]);
}

function compactFreeSpinPayload(body: unknown, scatterIds: ReadonlySet<number>): unknown {
  const items = getFreeSpinItems(body);
  return {
    bundled: isFreeSpinBundleComplete(body),
    itemCount: items.length,
    items: items.map((entry, index) => {
      if (typeof entry !== 'object' || entry === null) {
        return { index, keys: [] };
      }
      const typed = entry as Record<string, unknown>;
      const area = typed.area;
      return {
        index,
        keys: Object.keys(typed),
        spinsLeft: typed.spinsLeft,
        spinsRemaining: typed.spinsRemaining,
        remaining: typed.remaining,
        freeSpinsLeft: typed.freeSpinsLeft,
        scatterCount: countScatterInArea(area, scatterIds),
        areaColumns: Array.isArray(area) ? area.length : 0,
        areaRows: Array.isArray(area) && Array.isArray(area[0]) ? area[0].length : 0,
      };
    }),
  };
}

test.describe('FS — Feature / Free Spins', () => {
  requireCapabilities('buyFeature', 'freeSpins', 'scatterTrigger', 'freeSpinRetrigger');

  test(`${MANUAL_TEST_ID} scatter retriggers correctly during Feature`, async ({
    sgapSession,
    sgapDriver,
    page,
  }, testInfo) => {
    test.setTimeout(Math.max(600_000, MAX_BUYS * 180_000));

    const tracker = new InMemoryExecutionTracker();
    await tracker.start(MANUAL_TEST_ID, testInfo.project.name);

    testInfo.annotations.push(
      { type: 'manualTestId', description: MANUAL_TEST_ID },
      { type: 'category', description: 'FS' },
      { type: 'gameId', description: sgapSession.manifest.gameId },
    );

    let verificationResults: VerificationResult[] = [];
    let skipReason: string | undefined;

    try {
      await expect(sgapDriver.isAttached()).resolves.toBe(true);
      await expect(sgapSession.buyFeature.isAvailable()).resolves.toBe(true);

      await sgapDriver.gameCanvas().waitFor({ state: 'visible' });
      await settleCanvasToBaseGame(
        page,
        sgapDriver,
        sgapSession.manifest,
        sgapSession.platform.getInitializeBody(),
      );
      await sgapSession.turbo.enable({ timeoutMs: 15_000 }).catch(() => undefined);

      const staging = getLauncherMode() === 'staging';
      const startedAt = Date.now();
      let bestMaxScatter = 0;
      let attempts = 0;
      let entered = 0;
      let freeSpinsPlayed = 0;
      let refills = 0;
      let consecutiveErrors = 0;
      let lastBuyCost = 0;
      let spent = 0;
      let lastBody: unknown;
      let retriggerSeries = '';
      let automationError: string | undefined;
      let budgetError: string | undefined;
      let bestVerdict: FreeSpinRetriggerVerdict | undefined;
      const rules = freeSpinRetriggerRulesFor(sgapSession.manifest);
      const buyMultiplier = resolveBuyFeatureMultiplier(sgapSession.manifest);
      const scatterIds = scatterIdsFor(sgapSession.manifest);
      const walletBefore = staging ? await readLauncherBalance(page) : undefined;
      console.log(
        `[FS-008] walletBefore=${walletBefore ?? '?'} maxBuys=${MAX_BUYS} refill=${REFILL_WALLET} ` +
          `targetBet=${Number.isFinite(TARGET_BET) ? TARGET_BET : 'unset'} maxSpend=${MAX_SPEND || 'unset'}`,
      );

      if (Number.isFinite(TARGET_BET) && TARGET_BET > 0) {
        const { levels } = resolveBetLevels(sgapSession);
        await resetStakeToMinimum(sgapSession, sgapDriver, levels, page);
        const targetIndex = nearestBetLevelIndex(levels, TARGET_BET);
        for (let i = 0; i < targetIndex; i += 1) {
          await sgapDriver
            .clickCanvas('betPlus', { timeoutMs: 8_000, singleInput: true })
            .catch(() => undefined);
          await page.waitForTimeout(150);
        }
        const walked = levels[targetIndex] ?? TARGET_BET;
        sgapSession.bet.observeBet(String(walked));
        console.log(`[FS-008] walked stake toward ${walked} (${targetIndex} plus tap(s) from minimum)`);
      }

      const reopenWithWallet = async (reason: string): Promise<void> => {
        if (!REFILL_WALLET) {
          return;
        }
        refills += 1;
        console.log(`[FS-008] ${reason} — refilling wallet to ${STAGING_DEFAULT_WALLET} and reopening the game`);
        await restoreStagingWallet({
          page,
          platform: sgapSession.platform,
          driver: sgapDriver,
          manifest: sgapSession.manifest,
        });
        await setLauncherBetLimit(page, STAGING_DEFAULT_BET_LIMIT).catch(() => undefined);
        await sgapSession.turbo.enable({ timeoutMs: 15_000 }).catch(() => undefined);
      };

      for (let attempt = 1; attempt <= MAX_BUYS; attempt += 1) {
        attempts = attempt;
        const elapsedMin = ((Date.now() - startedAt) / 60_000).toFixed(1);
        console.log(
          `[FS-008] buy ${attempt}/${MAX_BUYS} ` +
            `(${elapsedMin} min, ${freeSpinsPlayed} free spins, best scatters=${bestMaxScatter}) — settle, then buy`,
        );

        try {
          if (staging && REFILL_WALLET) {
            const reserve = Math.max(MIN_RESERVE, lastBuyCost * RESERVE_BUYS);
            const balance = await readLauncherBalance(page);
            const remaining = await readLauncherBetRemaining(page);
            if ((balance !== undefined && balance < reserve) || (remaining !== undefined && remaining < reserve)) {
              await reopenWithWallet(`balance=${balance ?? '?'} remaining=${remaining ?? '?'} below ${reserve}`);
            }
          }

          await settleCanvasToBaseGame(
            page,
            sgapDriver,
            sgapSession.manifest,
            sgapSession.platform.getInitializeBody(),
          ).catch(() => undefined);

          const estimatedNext =
            lastBuyCost > 0
              ? lastBuyCost
              : resolveGrossBuyCost({
                  stake: Number.isFinite(TARGET_BET) && TARGET_BET > 0 ? TARGET_BET : undefined,
                  multiplier: buyMultiplier,
                }).cost;
          const budget = decideNextBuyBudget(spent, estimatedNext, MAX_SPEND);
          if (budget.action === 'stop-unknown') {
            budgetError =
              'FS-008 BUDGET — purchase cost could not be determined before the next buy';
            break;
          }
          if (budget.action === 'stop-cap') {
            console.log(
              `[FS-008] stopping before buy ${attempt}: spent ${spent} + estimated ${budget.nextCost} exceeds ${MAX_SPEND}`,
            );
            break;
          }

          const buy = await buyFeatureForBet(sgapSession, sgapDriver, page);
          lastBody = buy.raw;
          const gross = resolveGrossBuyCost({
            stake: buy.requestStake,
            totalBet: buy.requestTotalBet,
            buyFeat: buy.requestBuyFeat,
            multiplier: buyMultiplier,
          });
          if (gross.cost === undefined) {
            budgetError =
              'FS-008 BUDGET — purchase cost could not be determined from the buy request ' +
              `(stake=${buy.requestStake ?? '?'}, totalBet=${buy.requestTotalBet ?? '?'}, ` +
              `buyFeat=${buy.requestBuyFeat ?? '?'}; buyFeat is not a price multiplier)`;
            break;
          }
          lastBuyCost = gross.cost;
          spent += gross.cost;
          if (!featureEnteredFromBody(buy.raw)) {
            console.log(`[FS-008] buy ${attempt}: response did not enter the feature — buying again`);
            consecutiveErrors = 0;
            continue;
          }
          entered += 1;

          const drained = await drainFreeSpins(sgapSession, sgapDriver, page, buy.raw, 24);
          const payloads = isFreeSpinBundleComplete(buy.raw)
            ? [buy.raw]
            : [buy.raw, ...drained.map((spin) => spin.raw)];
          const verdict = evaluateFreeSpinRetrigger(payloads, {
            rules,
            scatterIds,
            entryKind: 'purchased',
          });
          const inBonusScatters = verdict.observations
            .filter((entry) => !entry.isOpener || rules?.purchasedOpenerInBonus === true)
            .reduce((max, entry) => Math.max(max, entry.scatterCount), 0);
          bestMaxScatter = Math.max(bestMaxScatter, inBonusScatters);
          freeSpinsPlayed += verdict.observations.length;
          const leftSeries = verdict.observations
            .map((entry) => (entry.remaining !== undefined ? String(entry.remaining) : '?'))
            .join('→');
          console.log(
            `[FS-008] buy ${attempt}: items=${verdict.observations.length} ` +
              `inBonusMaxScatter=${inBonusScatters} spinsLeft=${leftSeries || '?'} ` +
              `verdict=${verdict.kind} stake=${buy.requestStake ?? '?'} totalBet=${buy.requestTotalBet ?? '?'} ` +
              `buyFeat=${buy.requestBuyFeat ?? '?'} gross=${gross.cost} source=${gross.source} spent=${spent}`,
          );
          await testInfo.attach(`fs-008-buy-${attempt}.json`, {
            body: JSON.stringify(
              {
                verdict,
                requestStake: buy.requestStake,
                requestTotalBet: buy.requestTotalBet,
                requestBuyFeat: buy.requestBuyFeat,
                grossCost: gross,
                compact: compactFreeSpinPayload(buy.raw, scatterIds),
                drainedCount: drained.length,
                drained: drained.map((spin) => compactFreeSpinPayload(spin.raw, scatterIds)),
                buy: buy.raw,
              },
              null,
              2,
            ),
            contentType: 'application/json',
          });
          consecutiveErrors = 0;
          if (bestVerdict === undefined || verdict.kind === 'verified') {
            bestVerdict = verdict;
          } else if (
            bestVerdict.kind !== 'verified' &&
            verdict.kind === 'insufficient_evidence'
          ) {
            bestVerdict = verdict;
          }
          if (verdict.verified) {
            retriggerSeries = leftSeries;
            console.log(`[FS-008] retrigger verified on buy ${attempt}: ${verdict.reason}`);
            break;
          }
        } catch (error: unknown) {
          consecutiveErrors += 1;
          const message = error instanceof Error ? error.message : String(error);
          console.log(
            `[FS-008] buy ${attempt} errored (${consecutiveErrors}/${MAX_CONSECUTIVE_ERRORS} in a row): ${message.split('\n')[0]}`,
          );
          if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
            automationError =
              `FS-008 automation could not complete a buy ${MAX_CONSECUTIVE_ERRORS} times in a row ` +
              `after ${entered} feature(s): ${message}`;
            break;
          }
          if (staging && REFILL_WALLET) {
            await reopenWithWallet('recovering after a failed buy').catch(() => undefined);
          }
        }
      }

      const elapsedMin = ((Date.now() - startedAt) / 60_000).toFixed(1);
      const hunt = classifyFs008Hunt({
        maxBuys: MAX_BUYS,
        attempts,
        featuresEntered: entered,
        automationError,
        budgetError,
        bestVerdict,
      });
      const walletAfter = staging ? await readLauncherBalance(page) : undefined;
      const summary = {
        outcome: hunt.outcome,
        verified: hunt.passed,
        attempts,
        featuresEntered: entered,
        freeSpinsPlayed,
        bestMaxScatter,
        walletBefore,
        walletAfter,
        buySpend: spent,
        lastBuyCost,
        buyMultiplier,
        walletRefills: refills,
        refillEnabled: REFILL_WALLET,
        elapsedMinutes: Number(elapsedMin),
        retriggerSpinsLeft: retriggerSeries || undefined,
        rules: rules ?? null,
        verdict: bestVerdict?.kind,
        verdictReason: bestVerdict?.reason,
      };
      console.log(
        `[FS-008] walletAfter=${walletAfter ?? '?'} spent=${spent} outcome=${hunt.outcome}`,
      );
      await testInfo.attach('fs-008-retrigger-hunt.json', {
        body: JSON.stringify(summary, null, 2),
        contentType: 'application/json',
      });
      testInfo.annotations.push({ type: 'fs008', description: hunt.outcome });

      const passedMessage =
        hunt.outcome === 'verified'
          ? `Scatter retrigger verified on buy ${attempts} after ${entered} feature(s), ` +
            `${freeSpinsPlayed} free spins, ${elapsedMin} min (${bestVerdict?.reason ?? retriggerSeries})`
          : hunt.failMessage ?? hunt.skipReason ?? `FS-008 ${hunt.outcome}`;

      verificationResults.push({
        kind: 'freeSpins',
        passed: hunt.passed,
        message: passedMessage,
        actual: { ...summary, entered: featureEnteredFromBody(lastBody) },
      });

      await tracker.record({
        manualTestId: MANUAL_TEST_ID,
        status: hunt.passed ? 'passed' : hunt.skipReason !== undefined ? 'skipped' : 'failed',
        startedAt: (await tracker.get(MANUAL_TEST_ID))!.startedAt,
        finishedAt: new Date().toISOString(),
        browserProject: testInfo.project.name,
        errorMessage: hunt.passed ? undefined : hunt.failMessage ?? hunt.skipReason,
        verificationResults,
      });

      skipReason = hunt.skipReason;
      if (skipReason === undefined) {
        for (const result of verificationResults) {
          expect(result.passed, result.message).toBe(true);
        }
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      await tracker.record({
        manualTestId: MANUAL_TEST_ID,
        status: 'failed',
        startedAt: (await tracker.get(MANUAL_TEST_ID))!.startedAt,
        finishedAt: new Date().toISOString(),
        browserProject: testInfo.project.name,
        errorMessage: message,
        verificationResults,
      });
      throw error;
    } finally {
      await createDefaultExecutionReporters().publish(await tracker.list());
    }

    if (skipReason !== undefined) {
      test.skip(true, skipReason);
    }
  });
});
