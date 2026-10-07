/**
 * PROBE-001 — per-game control contracts.
 *
 * Not a QA catalog ID. Run this before the catalog suite: one accurate click
 * per control, pass only if the /bet (or buy) payload matches. Fail closed.
 * Maps which control owns isEnhancedBet (Amplify vs Turbo). Catalog TM-* must
 * not assert that field after lightning — Amplify/BF/AT amplify paths may.
 */

import { test, expect } from '../../fixtures/index.js';
import { settleCanvasToBaseGame } from '../../../src/platform/index.js';
import { verifyBetSpinOutcome, verifyIsEnhancedBet } from '../../../src/verification/bet-response-verification.js';
import {
  InMemoryExecutionTracker,
  createDefaultExecutionReporters,
} from '../../../src/reporting/index.js';
import { expectNoBetWithin, spinForBet } from '../../support/canvas-bet-flow.js';
import {
  prepareBetNudge,
  prepareCanvasAmplify,
  prepareCanvasTurbo,
} from '../../support/canvas-bet-control.js';
import { waitForIdleHud } from '../../support/canvas-healing.js';
import type { BetResponseSnapshot, VerificationResult } from '../../../src/core/models/index.js';
import { matchesBetUrl } from '../../../src/network/bet-url.js';

const MANUAL_TEST_ID = 'PROBE-001' as const;

test.describe('PROBE — control contracts', () => {
  test(`${MANUAL_TEST_ID} idle controls map to /bet payload fields`, async ({
    sgapSession,
    sgapDriver,
    page,
  }, testInfo) => {
    test.setTimeout(300_000);

    const tracker = new InMemoryExecutionTracker();
    await tracker.start(MANUAL_TEST_ID, testInfo.project.name);

    testInfo.annotations.push(
      { type: 'manualTestId', description: MANUAL_TEST_ID },
      { type: 'category', description: 'PROBE' },
      { type: 'gameId', description: sgapSession.manifest.gameId },
    );

    const verificationResults: VerificationResult[] = [];

    try {
      await expect(sgapDriver.isAttached()).resolves.toBe(true);
      expect(sgapSession.betWatcher).toBeDefined();
      await sgapDriver.gameCanvas().waitFor({ state: 'visible' });
      await settleCanvasToBaseGame(
        page,
        sgapDriver,
        sgapSession.manifest,
        sgapSession.platform.getInitializeBody(),
      );

      await sgapSession.turbo.disable({ timeoutMs: 8_000 }).catch(() => undefined);
      await sgapSession.amplifyBet.disable({ timeoutMs: 8_000 }).catch(() => undefined);

      const idle = await waitForIdleHud(page, sgapDriver, sgapSession.manifest, 12_000);
      expect(idle.healed, idle.detail).toBe(true);

      const baseline = await spinForBet(sgapSession, sgapDriver, page);
      logBetRequest('baseline', baseline);
      verificationResults.push(...verifyBetSpinOutcome(baseline, { requireCompleted: true }));
      const baselineStake = Number(baseline.bet?.amount ?? '0');
      expect(baselineStake, 'baseline spin stake').toBeGreaterThan(0);

      await prepareBetNudge(sgapSession, sgapDriver, page);
      await sgapSession.bet.increase({ timeoutMs: 10_000 });
      const plusBet = await spinForBet(sgapSession, sgapDriver, page);
      logBetRequest('bet+', plusBet);
      const plusStake = Number(plusBet.bet?.amount ?? '0');
      verificationResults.push({
        kind: 'bet',
        passed: plusStake > baselineStake + 0.0001,
        message:
          plusStake > baselineStake + 0.0001
            ? `Bet + changed stake ${baselineStake} → ${plusStake}`
            : `Bet + did not change stake (still ${plusStake})`,
        expected: `> ${baselineStake}`,
        actual: plusStake,
      });

      // Isolated HUD taps — clickCanvas, not enable(), so a miss cannot poison the local flag.
      await prepareCanvasTurbo(sgapSession, sgapDriver, page);
      await sgapDriver.clickCanvas('turbo', { timeoutMs: 10_000, singleInput: true });
      const turboOn = await spinForBet(sgapSession, sgapDriver, page);
      logBetRequest('turbo', turboOn);

      await prepareCanvasAmplify(sgapSession, sgapDriver, page);
      await sgapDriver.clickCanvas('amplifyBet', { timeoutMs: 10_000, singleInput: true });
      const amplifyOn = await spinForBet(sgapSession, sgapDriver, page);
      logBetRequest('amplify', amplifyOn);

      const turboSetsEnhanced = turboOn.isEnhancedBet === true;
      const amplifySetsEnhanced = amplifyOn.isEnhancedBet === true;
      const owner = turboSetsEnhanced
        ? 'turbo'
        : amplifySetsEnhanced
          ? 'amplifyBet'
          : 'none';
      verificationResults.push({
        kind: 'bet',
        passed: owner !== 'none',
        message:
          owner === 'turbo'
            ? 'isEnhancedBet follows Turbo lightning'
            : owner === 'amplifyBet'
              ? 'isEnhancedBet follows Amplify (not Turbo lightning)'
              : `Neither Turbo nor Amplify set isEnhancedBet (turbo=${String(turboOn.isEnhancedBet)} amplify=${String(amplifyOn.isEnhancedBet)})`,
        expected: true,
        actual: {
          owner,
          turbo: turboOn.isEnhancedBet,
          amplify: amplifyOn.isEnhancedBet,
          turboStake: turboOn.bet?.amount,
          amplifyStake: amplifyOn.bet?.amount,
        },
      });

      if (owner === 'turbo') {
        await prepareCanvasTurbo(sgapSession, sgapDriver, page);
        await sgapDriver.clickCanvas('turbo', { timeoutMs: 10_000, singleInput: true });
        const turboOff = await spinForBet(sgapSession, sgapDriver, page);
        logBetRequest('turbo-off', turboOff);
        verificationResults.push(verifyIsEnhancedBet(turboOff.isEnhancedBet, false));
      } else if (owner === 'amplifyBet') {
        await prepareCanvasAmplify(sgapSession, sgapDriver, page);
        await sgapDriver.clickCanvas('amplifyBet', { timeoutMs: 10_000, singleInput: true });
        const amplifyOff = await spinForBet(sgapSession, sgapDriver, page);
        logBetRequest('amplify-off', amplifyOff);
        verificationResults.push(verifyIsEnhancedBet(amplifyOff.isEnhancedBet, false));
      }

      await waitForIdleHud(page, sgapDriver, sgapSession.manifest, 8_000);
      const autoplayBet = page.waitForResponse(
        (response) => response.ok() && matchesBetUrl(response.url()),
        { timeout: 25_000 },
      );
      await sgapSession.autoplay.start({ timeoutMs: 20_000 });
      await autoplayBet;
      verificationResults.push({
        kind: 'bet',
        passed: true,
        message: 'Autoplay confirm produced a /bet',
      });
      await sgapSession.autoplay.stop({ timeoutMs: 12_000 });
      sgapSession.autoplay.acknowledgeStopped();
      await expectNoBetWithin(page, 2_500);
      verificationResults.push({
        kind: 'bet',
        passed: true,
        message: 'Autoplay stop — no further /bet',
      });

      await waitForIdleHud(page, sgapDriver, sgapSession.manifest, 8_000);
      await sgapSession.buyFeature.openPanel({ timeoutMs: 15_000 });
      await sgapDriver
        .clickCanvas('buyFeatureCancel', { timeoutMs: 10_000, singleInput: true })
        .catch(() => undefined);
      await sgapDriver
        .clickCanvas('closeOverlay', { timeoutMs: 6_000, singleInput: true })
        .catch(() => undefined);
      await expectNoBetWithin(page, 2_000);
      verificationResults.push({
        kind: 'bet',
        passed: true,
        message: 'Buy panel opened and cancelled without a purchase',
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
      await sgapSession.autoplay.stop({ timeoutMs: 8_000 }).catch(() => undefined);
      await tracker.finish(MANUAL_TEST_ID, 'failed', message);
      const failed = await tracker.get(MANUAL_TEST_ID);
      if (failed !== undefined && verificationResults.length > 0) {
        await tracker.record({ ...failed, verificationResults });
      }
      throw error;
    } finally {
      await createDefaultExecutionReporters().publish(await tracker.list());
    }
  });
});

function logBetRequest(label: string, bet: BetResponseSnapshot): void {
  const body = bet.betRequest ?? {};
  console.log(
    `[PROBE-001] ${label} /bet isEnhancedBet=${String(bet.isEnhancedBet)} stake=${bet.bet?.amount ?? '?'} body=${JSON.stringify(body)}`,
  );
}
