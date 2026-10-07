/**
 * ES-012 — Edge & Stability
 *
 * Manual Test Case ID: ES-012
 * Intent: Screen orientation handling — mobile portrait session is playable
 * (no "Rotate to portrait" gate). Default specs keep a desktop host window
 * and lock the game iframe to portrait.
 */

import { test, expect } from '../../fixtures/index.js';
import { settleCanvasToBaseGame } from '../../../src/platform/index.js';
import {
  InMemoryExecutionTracker,
  createDefaultExecutionReporters,
} from '../../../src/reporting/index.js';
import { spinForBet } from '../../support/canvas-bet-flow.js';
import { ensurePortrait, waitForIdleHud } from '../../support/canvas-healing.js';
import { verifyBetSpinOutcome } from '../../../src/verification/bet-response-verification.js';
import { getLauncherMode } from '../../fixtures/local-launcher-html.js';
import type { VerificationResult } from '../../../src/core/models/index.js';

const MANUAL_TEST_ID = 'ES-012' as const;

function parseViewport(raw: string): { readonly width: number; readonly height: number } {
  const [widthRaw, heightRaw] = raw.split('x');
  return { width: Number(widthRaw), height: Number(heightRaw) };
}

test.describe('ES — Edge & Stability', () => {
  test.use({ sgapView: 'mobile' });
  test.skip(
    getLauncherMode() !== 'staging',
    'Mobile portrait needs the DiJoker staging iframe (device=mobile)',
  );

  test(`${MANUAL_TEST_ID} screen orientation handling`, async ({
    sgapSession,
    sgapDriver,
    page,
  }, testInfo) => {
    test.setTimeout(240_000);

    const tracker = new InMemoryExecutionTracker();
    await tracker.start(MANUAL_TEST_ID, testInfo.project.name);

    testInfo.annotations.push(
      { type: 'manualTestId', description: MANUAL_TEST_ID },
      { type: 'category', description: 'ES' },
      { type: 'gameId', description: sgapSession.manifest.gameId },
      { type: 'sgapView', description: 'mobile' },
    );

    let verificationResults: VerificationResult[] = [];

    try {
      const expected = parseViewport(
        sgapSession.manifest.metadata?.portraitViewport ?? '390x844',
      );
      const viewport = page.viewportSize();
      verificationResults.push({
        kind: 'stateManagement',
        passed:
          viewport?.width === expected.width && viewport?.height === expected.height,
        message: `Page viewport is mobile portrait ${expected.width}x${expected.height}`,
        expected: `${expected.width}x${expected.height}`,
        actual: viewport ? `${viewport.width}x${viewport.height}` : 'none',
      });

      const gameKey = (
        sgapSession.manifest.metadata?.launcherGameKey ??
        sgapSession.manifest.gameId.replace(/-/gu, '_')
      ).toLowerCase();
      const frameUrl =
        page.frames().find((frame) => frame.url().toLowerCase().includes(gameKey))?.url() ??
        '';
      verificationResults.push({
        kind: 'stateManagement',
        passed: /[?&]device=mobile(?:&|$)/iu.test(frameUrl),
        message: 'Game iframe loaded with device=mobile',
        expected: 'device=mobile',
        actual: frameUrl,
      });

      const rotateInFrame = await sgapDriver
        .getFrame()
        .getByText(/rotate to portrait/i)
        .isVisible()
        .catch(() => false);
      const rotateOnPage = await page
        .getByText(/rotate to portrait/i)
        .isVisible()
        .catch(() => false);
      verificationResults.push({
        kind: 'stateManagement',
        passed: !rotateInFrame && !rotateOnPage,
        message: 'Portrait session is not blocked by a rotate overlay',
        expected: 'overlay hidden',
        actual: rotateInFrame || rotateOnPage ? 'visible' : 'hidden',
      });

      await expect(sgapDriver.isAttached()).resolves.toBe(true);
      await expect(sgapSession.spin.isAvailable()).resolves.toBe(true);
      await sgapDriver.gameCanvas().waitFor({ state: 'visible' });

      await ensurePortrait(page, sgapSession.manifest, sgapDriver.iframeSelector);
      await settleCanvasToBaseGame(
        page,
        sgapDriver,
        sgapSession.manifest,
        sgapSession.platform.getInitializeBody(),
      );
      await waitForIdleHud(page, sgapDriver, sgapSession.manifest, 16_000);

      const bet = await spinForBet(sgapSession, sgapDriver, page);
      verificationResults.push(...verifyBetSpinOutcome(bet, { requireCompleted: true }));

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
