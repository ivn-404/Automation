/**
 * ES-008 — Edge & Stability
 *
 * Manual Test Case ID: ES-008
 * Intent: Max Win message displays correctly — the launch screen's Max Win message
 * ("Win up to N×") is shown on load, is well formatted (thousand separators, × suffix),
 * and states the same cap the server declares in initialize (`maxWin`).
 */

import { test, expect } from '../../fixtures/index.js';
import { requireCapabilities } from '../../support/capabilities.js';
import {
  InMemoryExecutionTracker,
  createDefaultExecutionReporters,
} from '../../../src/reporting/index.js';
import { primeCanvasSession, settleCanvasToBaseGame } from '../../../src/platform/index.js';
import { getByPath } from '../../../src/shared/json-path.js';
import { ensureBaseHud, waitForVisiblePhaserText } from '../../support/session-guard.js';
import { spinForBet } from '../../support/canvas-bet-flow.js';
import { verifyBetSpinOutcome } from '../../../src/verification/bet-response-verification.js';
import type { VerificationResult } from '../../../src/core/models/index.js';

const MANUAL_TEST_ID = 'ES-008' as const;
const MAX_WIN_MESSAGE = /win\s+up\s+to/iu;
const WELL_FORMED = /^win up to (\d{1,3}(?:,\d{3})*(?:\.\d+)?)\s*[x×]$/iu;
const LOAD_TIMEOUT_MS = 90_000;

test.describe('ES — Edge & Stability', () => {
  requireCapabilities('maxWin');
  test(`${MANUAL_TEST_ID} Max Win message displays correctly`, async ({
    sgapSession,
    sgapDriver,
    page,
  }, testInfo) => {
    test.setTimeout(420_000);

    const tracker = new InMemoryExecutionTracker();
    await tracker.start(MANUAL_TEST_ID, testInfo.project.name);

    testInfo.annotations.push(
      { type: 'manualTestId', description: MANUAL_TEST_ID },
      { type: 'category', description: 'ES' },
      { type: 'gameId', description: sgapSession.manifest.gameId },
    );

    let verificationResults: VerificationResult[] = [];

    try {
      await expect(sgapDriver.isAttached()).resolves.toBe(true);

      // Fresh load so the launch screen (where the message lives) is on screen.
      await page.reload({ waitUntil: 'domcontentloaded', timeout: LOAD_TIMEOUT_MS });
      await sgapSession.platform.openGameHost({ timeoutMs: LOAD_TIMEOUT_MS });
      await sgapSession.platform.openGame({ timeoutMs: LOAD_TIMEOUT_MS });
      await sgapSession.platform.prepareActiveGameView({ timeoutMs: LOAD_TIMEOUT_MS });
      await sgapDriver.attach();

      const { hit: message, uncovered, coveredBy } = await waitForVisiblePhaserText(
        page,
        sgapDriver.iframeSelector,
        MAX_WIN_MESSAGE,
        45_000,
      );
      await testInfo.attach('launch-screen.png', { body: await page.screenshot(), contentType: 'image/png' });
      const shown = message?.text.replace(/\s+/gu, ' ').trim();
      verificationResults.push({
        kind: 'bet',
        passed: shown !== undefined && uncovered,
        message:
          shown === undefined
            ? 'No Max Win message on the launch screen'
            : uncovered
              ? `Launch screen shows "${shown}"`
              : `Max Win message "${shown}" exists but stays covered (${coveredBy ?? 'unknown'})`,
        actual: shown,
      });

      const match = shown?.match(WELL_FORMED);
      verificationResults.push({
        kind: 'bet',
        passed: match !== null && match !== undefined,
        message:
          match
            ? `Max Win message is well formatted ("${shown}")`
            : `Max Win message is malformed: "${shown}" (expected "Win up to N,NNN×")`,
        actual: shown,
      });

      const declared = Number(
        getByPath(sgapSession.platform.getInitializeBody(), 'data.maxWin') ??
          getByPath(sgapSession.platform.getInitializeBody(), 'maxWin'),
      );
      const displayed = match ? Number(match[1]!.replace(/,/gu, '')) : Number.NaN;
      verificationResults.push({
        kind: 'bet',
        passed: Number.isFinite(declared) && declared > 0 && displayed === declared,
        message:
          displayed === declared
            ? `Displayed cap ${displayed}× matches initialize maxWin ${declared}×`
            : `Displayed cap ${displayed}× does not match initialize maxWin ${declared}×`,
        expected: declared,
        actual: displayed,
      });

      // The message must not block play: continue past it and confirm a verifiable spin.
      await ensureBaseHud(sgapSession, sgapDriver, page);
      await primeCanvasSession({
        page,
        driver: sgapDriver,
        manifest: sgapSession.manifest,
        initializeBody: sgapSession.platform.getInitializeBody(),
      });
      await settleCanvasToBaseGame(
        page,
        sgapDriver,
        sgapSession.manifest,
        sgapSession.platform.getInitializeBody(),
      );
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
