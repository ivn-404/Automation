/**
 * AP-004 — Autoplay
 *
 * Manual Test Case ID: AP-004
 * Intent: Autoplay stops when balance is insufficient for further spins.
 *
 * Setup: launcher balance → 3 USD, autoplay 10 spins — must stop before completing all.
 */

import { test, expect } from '../../fixtures/index.js';
import { requireCapabilities } from '../../support/capabilities.js';
import { clearNonGridOverlays, settleCanvasToBaseGame } from '../../../src/platform/index.js';
import {
  InMemoryExecutionTracker,
  createDefaultExecutionReporters,
} from '../../../src/reporting/index.js';
import { setLauncherBalanceAndRefreshGame, restoreStagingWallet } from '../../support/launcher-balance.js';
import { getLauncherMode } from '../../fixtures/local-launcher-html.js';
import {
  resolveBetLevels,
  walkStakeToBoundary,
  spinForStake,
} from '../../support/canvas-bet-control.js';
import {
  startAutoplayCountingUntilIdle,
  stopAutoplayQuietly,
} from '../../support/autoplay-flow.js';
import type { VerificationResult } from '../../../src/core/models/index.js';

const MANUAL_TEST_ID = 'AP-004' as const;

test.describe('AP — Autoplay', () => {
  requireCapabilities('autoplay');

  test(`${MANUAL_TEST_ID} autoplay stops on insufficient balance`, async ({
    sgapSession,
    sgapDriver,
    page,
  }, testInfo) => {
    test.setTimeout(600_000);

    const tracker = new InMemoryExecutionTracker();
    await tracker.start(MANUAL_TEST_ID, testInfo.project.name);

    testInfo.annotations.push(
      { type: 'manualTestId', description: MANUAL_TEST_ID },
      { type: 'category', description: 'AP' },
      { type: 'launcherBalance', description: '3' },
      { type: 'gameId', description: sgapSession.manifest.gameId },
    );

    let verificationResults: VerificationResult[] = [];

    try {
      await expect(sgapDriver.isAttached()).resolves.toBe(true);
      await expect(sgapSession.autoplay.isAvailable()).resolves.toBe(true);

      await sgapDriver.gameCanvas().waitFor({ state: 'visible' });
      await settleCanvasToBaseGame(
        page,
        sgapDriver,
        sgapSession.manifest,
        sgapSession.platform.getInitializeBody(),
      );

      // Reach min stake while wallet is still funded — low balance cannot afford ladder walks.
      const { levels } = resolveBetLevels(sgapSession);
      const startStake = await spinForStake(sgapSession, sgapDriver, page);
      sgapSession.bet.observeBet(startStake);
      await walkStakeToBoundary(sgapSession, sgapDriver, 'min', startStake, levels, page);
      await settleCanvasToBaseGame(
        page,
        sgapDriver,
        sgapSession.manifest,
        sgapSession.platform.getInitializeBody(),
      );

      if (getLauncherMode() === 'staging') {
        await setLauncherBalanceAndRefreshGame({
          page,
          platform: sgapSession.platform,
          driver: sgapDriver,
          manifest: sgapSession.manifest,
          amount: 3,
        });
        if (!(await sgapDriver.isAttached())) {
          await sgapDriver.attach();
        }
      }

      await settleCanvasToBaseGame(
        page,
        sgapDriver,
        sgapSession.manifest,
        sgapSession.platform.getInitializeBody(),
      );

      await clearNonGridOverlays(sgapDriver, sgapSession.manifest, 2);
      await sgapSession.turbo.enable({ timeoutMs: 15_000 }).catch(() => undefined);

      const selectedSpins = Number(sgapSession.manifest.metadata?.autoplaySelectedSpins ?? '10');
      const betCount = await startAutoplayCountingUntilIdle({
        sgapSession,
        sgapDriver,
        page,
        spinCountAction: sgapSession.manifest.metadata?.autoplaySpinCountAction,
        countOptions: {
          maxBets: selectedSpins,
          idleMs: 6_000,
          firstBetTimeoutMs: 90_000,
          overallTimeoutMs: 120_000,
        },
      });

      await stopAutoplayQuietly(sgapSession, page);

      verificationResults = [
        {
          kind: 'balance',
          passed: betCount >= 1,
          message:
            betCount >= 1
              ? `Autoplay fired ${betCount} bet(s) before stopping`
              : 'Autoplay never fired a bet',
          expected: '>= 1',
          actual: betCount,
        },
        {
          kind: 'stateManagement',
          passed: betCount < selectedSpins,
          message:
            betCount < selectedSpins
              ? `Autoplay stopped early (${betCount}/${selectedSpins}) — insufficient balance`
              : `Autoplay completed all ${selectedSpins} spins on low balance (expected early stop)`,
          expected: `< ${selectedSpins}`,
          actual: betCount,
        },
        {
          kind: 'stateManagement',
          passed: !sgapSession.autoplay.isAutoplayActive(),
          message: sgapSession.autoplay.isAutoplayActive()
            ? 'Autoplay still marked active after low balance'
            : 'Autoplay inactive after insufficient balance stop',
          expected: false,
          actual: sgapSession.autoplay.isAutoplayActive(),
        },
      ];

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
      await sgapSession.autoplay.stop({ timeoutMs: 10_000 }).catch(() => undefined);
      sgapSession.autoplay.acknowledgeStopped();
      await tracker.finish(MANUAL_TEST_ID, 'failed', message);
      const failed = await tracker.get(MANUAL_TEST_ID);
      if (failed !== undefined && verificationResults.length > 0) {
        await tracker.record({ ...failed, verificationResults });
      }
      throw error;
    } finally {
      if (getLauncherMode() === 'staging') {
        await restoreStagingWallet({
          page,
          platform: sgapSession.platform,
          driver: sgapDriver,
          manifest: sgapSession.manifest,
        }).catch(() => undefined);
      }
      await createDefaultExecutionReporters().publish(await tracker.list());
    }
  });
});
