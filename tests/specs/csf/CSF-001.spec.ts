/**

 * CSF-001 — Core Spin Flow

 *

 * Manual Test Case ID: CSF-001

 * Flow: wait init → spin → read bet response → verify → report.

 */



import { test, expect } from '../../fixtures/index.js';

import { settleCanvasToBaseGame } from '../../../src/platform/index.js';

import { getLauncherMode } from '../../fixtures/local-launcher-html.js';

import { verifyBetSpinOutcome } from '../../../src/verification/bet-response-verification.js';

import {

  InMemoryExecutionTracker,

  createDefaultExecutionReporters,

} from '../../../src/reporting/index.js';

import { spinForBet } from '../../support/canvas-bet-flow.js';

import type { VerificationResult } from '../../../src/core/models/index.js';



const MANUAL_TEST_ID = 'CSF-001' as const;



test.describe('CSF — Core Spin Flow', () => {

  test(`${MANUAL_TEST_ID} player can trigger a spin and bet response is verifiable`, async ({

    sgapSession,

    sgapDriver,

    page,

  }, testInfo) => {

    test.setTimeout(300_000);



    const tracker = new InMemoryExecutionTracker();

    await tracker.start(MANUAL_TEST_ID, testInfo.project.name);



    testInfo.annotations.push(

      { type: 'manualTestId', description: MANUAL_TEST_ID },

      { type: 'category', description: 'CSF' },

      { type: 'gameId', description: sgapSession.manifest.gameId },

    );



    let verificationResults: VerificationResult[] = [];



    try {

      await expect(sgapDriver.isAttached()).resolves.toBe(true);

      await expect(sgapSession.spin.isAvailable()).resolves.toBe(true);

      expect(sgapSession.betWatcher).toBeDefined();



      await sgapDriver.gameCanvas().waitFor({ state: 'visible' });

      await settleCanvasToBaseGame(

        page,

        sgapDriver,

        sgapSession.manifest,

        sgapSession.platform.getInitializeBody(),

      );

      await sgapSession.turbo.enable({ timeoutMs: 15_000 }).catch(() => undefined);



      const bet = await spinForBet(sgapSession, sgapDriver, page);



      const beforeBalance =

        getLauncherMode() === 'local'

          ? { amount: '9721.85' }

          : sgapSession.initializeBalance;



      const stakeAmount =

        getLauncherMode() === 'local' ? '0' : bet.bet?.amount;



      verificationResults = verifyBetSpinOutcome(bet, {

        requireCompleted: true,

        ...(beforeBalance !== undefined ? { beforeBalance } : {}),

        ...(stakeAmount !== undefined ? { stakeAmount } : {}),

      });



      for (const result of verificationResults) {

        expect(result.passed, result.message).toBe(true);

      }



      expect(bet.balance).toBeDefined();

      expect(bet.win).toBeDefined();



      if (getLauncherMode() === 'local') {

        expect(bet.balance?.amount).toBe('9721.85');

        expect(bet.win?.amount).toBe('0');

      }



      const lock = await sgapSession.spin.getLockState();

      expect(lock.locked).toBe(false);



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


