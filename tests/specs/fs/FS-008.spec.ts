/**
 * FS-008 — Feature / Free Spins
 *
 * Manual Test Case ID: FS-008
 * Intent: Scatter retriggers correctly during Feature — mid-feature boards can
 * award extra free spins (spinsLeft increases, or ≥4 scatters land after the opener).
 *
 * Retriggers are rare (about 1 in 100+ buys on some packages), so the case keeps
 * buying until one lands instead of failing on a small sample. The sandbox wallet and
 * bet limit are refilled between buys. SGAP_FS008_MAX_BUYS caps the loop (0 = no cap).
 */

import { test, expect } from '../../fixtures/index.js';
import { requireCapabilities } from '../../support/capabilities.js';
import { settleCanvasToBaseGame } from '../../../src/platform/index.js';
import {
  InMemoryExecutionTracker,
  createDefaultExecutionReporters,
} from '../../../src/reporting/index.js';
import { buyFeatureForBet } from '../../support/canvas-bet-flow.js';
import { featureEnteredFromBody } from '../../support/buy-feature-verify.js';
import { drainFreeSpins, readFreeSpinSession } from '../../support/free-spin-flow.js';
import {
  STAGING_DEFAULT_BET_LIMIT,
  STAGING_DEFAULT_WALLET,
  readLauncherBalance,
  readLauncherBetRemaining,
  restoreStagingWallet,
  setLauncherBetLimit,
} from '../../support/launcher-balance.js';
import { getLauncherMode } from '../../fixtures/local-launcher-html.js';
import type { VerificationResult } from '../../../src/core/models/index.js';

const MANUAL_TEST_ID = 'FS-008' as const;
const MAX_BUYS = Math.max(0, Number(process.env.SGAP_FS008_MAX_BUYS ?? 0) || 0);
const MAX_CONSECUTIVE_ERRORS = 5;
/** Refill once the wallet or wager cap cannot cover this many more buys. */
const RESERVE_BUYS = 5;
const MIN_RESERVE = 2_000;

test.describe('FS — Feature / Free Spins', () => {
  requireCapabilities('buyFeature', 'freeSpins', 'scatterTrigger', 'freeSpinRetrigger');

  test(`${MANUAL_TEST_ID} scatter retriggers correctly during Feature`, async ({
    sgapSession,
    sgapDriver,
    page,
  }, testInfo) => {
    test.setTimeout(0);

    const tracker = new InMemoryExecutionTracker();
    await tracker.start(MANUAL_TEST_ID, testInfo.project.name);

    testInfo.annotations.push(
      { type: 'manualTestId', description: MANUAL_TEST_ID },
      { type: 'category', description: 'FS' },
      { type: 'gameId', description: sgapSession.manifest.gameId },
    );

    let verificationResults: VerificationResult[] = [];

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
      let retriggered = false;
      let bestMaxScatter = 0;
      let attempts = 0;
      let entered = 0;
      let freeSpinsPlayed = 0;
      let refills = 0;
      let consecutiveErrors = 0;
      let lastBuyCost = 0;
      let lastBody: unknown;
      let retriggerSeries = '';

      const reopenWithWallet = async (reason: string): Promise<void> => {
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

      for (let attempt = 1; MAX_BUYS === 0 || attempt <= MAX_BUYS; attempt += 1) {
        attempts = attempt;
        const elapsedMin = ((Date.now() - startedAt) / 60_000).toFixed(1);
        console.log(
          `[FS-008] buy ${attempt}${MAX_BUYS > 0 ? `/${MAX_BUYS}` : ''} ` +
            `(${elapsedMin} min, ${freeSpinsPlayed} free spins, best scatters=${bestMaxScatter}) — settle, then buy`,
        );

        try {
          if (staging) {
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

          const buy = await buyFeatureForBet(sgapSession, sgapDriver, page);
          lastBody = buy.raw;
          const cost =
            buy.requestTotalBet ??
            (buy.requestStake !== undefined && buy.requestBuyFeat !== undefined
              ? buy.requestStake * buy.requestBuyFeat
              : undefined);
          if (cost !== undefined && Number.isFinite(cost)) {
            lastBuyCost = Math.max(lastBuyCost, cost);
          }
          if (!featureEnteredFromBody(buy.raw)) {
            console.log(`[FS-008] buy ${attempt}: response did not enter the feature — buying again`);
            consecutiveErrors = 0;
            continue;
          }
          entered += 1;

          const session = readFreeSpinSession(buy.raw, { manifest: sgapSession.manifest });
          bestMaxScatter = Math.max(bestMaxScatter, session?.maxScatterOnItem ?? 0);
          freeSpinsPlayed += session?.itemCount ?? 0;
          const leftSeries = session?.spinsLeftSeries?.join('→') ?? '?';
          console.log(
            `[FS-008] buy ${attempt}: items=${session?.itemCount ?? 0} ` +
              `maxScatter=${session?.maxScatterOnItem ?? 0} spinsLeft=${leftSeries} ` +
              `retrigger=${session?.hadRetrigger === true}`,
          );
          if (
            session !== undefined &&
            (session.hadRetrigger || session.itemCount > session.initialCount || session.maxScatterOnItem >= 3)
          ) {
            await testInfo.attach(`fs-008-buy-${attempt}.json`, {
              body: JSON.stringify(buy.raw, null, 2),
              contentType: 'application/json',
            });
          }
          await drainFreeSpins(sgapSession, sgapDriver, page, buy.raw, 24);
          consecutiveErrors = 0;
          if (session?.hadRetrigger === true) {
            retriggered = true;
            retriggerSeries = leftSeries;
            console.log(`[FS-008] retrigger found on buy ${attempt} — feature drained so the extra spins played out`);
            break;
          }
        } catch (error: unknown) {
          consecutiveErrors += 1;
          const message = error instanceof Error ? error.message : String(error);
          console.log(
            `[FS-008] buy ${attempt} errored (${consecutiveErrors}/${MAX_CONSECUTIVE_ERRORS} in a row): ${message.split('\n')[0]}`,
          );
          if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
            throw new Error(
              `FS-008 automation could not complete a buy ${MAX_CONSECUTIVE_ERRORS} times in a row ` +
                `after ${entered} feature(s): ${message}`,
            );
          }
          if (staging) {
            await reopenWithWallet('recovering after a failed buy').catch(() => undefined);
          }
        }
      }

      const elapsedMin = ((Date.now() - startedAt) / 60_000).toFixed(1);
      const summary = {
        retriggered,
        attempts,
        featuresEntered: entered,
        freeSpinsPlayed,
        bestMaxScatter,
        walletRefills: refills,
        elapsedMinutes: Number(elapsedMin),
        retriggerSpinsLeft: retriggerSeries || undefined,
      };
      await testInfo.attach('fs-008-retrigger-hunt.json', {
        body: JSON.stringify(summary, null, 2),
        contentType: 'application/json',
      });

      verificationResults.push({
        kind: 'freeSpins',
        passed: retriggered,
        message: retriggered
          ? `Scatter retrigger observed on buy ${attempts} after ${entered} feature(s), ` +
            `${freeSpinsPlayed} free spins, ${elapsedMin} min (spinsLeft=${retriggerSeries})`
          : `No mid-feature retrigger after the SGAP_FS008_MAX_BUYS cap of ${MAX_BUYS} buy(s) ` +
            `(${entered} feature(s), ${freeSpinsPlayed} free spins, maxScattersOnItem=${bestMaxScatter})`,
        actual: { ...summary, entered: featureEnteredFromBody(lastBody) },
      });

      for (const result of verificationResults) {
        expect(result.passed, result.message).toBe(true);
      }

      await tracker.record({
        manualTestId: MANUAL_TEST_ID,
        status: 'passed',
        startedAt: (await tracker.get(MANUAL_TEST_ID))!.startedAt,
        finishedAt: new Date().toISOString(),
        browserProject: testInfo.project.name,
        verificationResults,
      });
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
  });
});
