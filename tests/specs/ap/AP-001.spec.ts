/**

 * AP-001 — Autoplay

 *

 * Manual Test Case ID: AP-001

 * Intent: player can start autoplay; multiple bets fire; stop halts further bets.

 */



import { test, expect } from '../../fixtures/index.js';
import { requireCapabilities } from '../../support/capabilities.js';

import { parseBetResponseBody } from '../../../src/data/parse-bet-response.js';

import { verifyBetSpinOutcome } from '../../../src/verification/bet-response-verification.js';

import {

  InMemoryExecutionTracker,

  createDefaultExecutionReporters,

} from '../../../src/reporting/index.js';

import {

  prepareAutoplayCanvas,

  startAutoplayCollectingBets,

  stopAutoplayQuietly,

} from '../../support/autoplay-flow.js';

import type { VerificationResult } from '../../../src/core/models/index.js';



const MANUAL_TEST_ID = 'AP-001' as const;



test.describe('AP — Autoplay', () => {
  requireCapabilities('autoplay');


  test(`${MANUAL_TEST_ID} player can start autoplay, receive bets, and stop`, async ({

    sgapSession,

    sgapDriver,

    page,

  }, testInfo) => {

    test.setTimeout(420_000);



    const tracker = new InMemoryExecutionTracker();

    await tracker.start(MANUAL_TEST_ID, testInfo.project.name);



    testInfo.annotations.push(

      { type: 'manualTestId', description: MANUAL_TEST_ID },

      { type: 'category', description: 'AP' },

      { type: 'gameId', description: sgapSession.manifest.gameId },

    );



    let verificationResults: VerificationResult[] = [];



    try {

      await expect(sgapDriver.isAttached()).resolves.toBe(true);

      await expect(sgapSession.autoplay.isAvailable()).resolves.toBe(true);

      expect(sgapSession.manifest.network).toBeDefined();



      await sgapDriver.gameCanvas().waitFor({ state: 'visible' });

      await prepareAutoplayCanvas(sgapSession, sgapDriver, page);



      const betResponses = await startAutoplayCollectingBets({

        sgapSession,

        sgapDriver,

        page,

        betCount: 2,

        perBetTimeoutMs: 90_000,

      });



      const lastResponse = betResponses.at(-1)!;

      const lastBet = parseBetResponseBody(

        await lastResponse.json(),

        sgapSession.manifest.network!.fields,

      );

      verificationResults = verifyBetSpinOutcome(lastBet, { requireCompleted: true });



      await stopAutoplayQuietly(sgapSession, page);

      expect(sgapSession.autoplay.isAutoplayActive()).toBe(false);



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

      await stopAutoplayQuietly(sgapSession, page).catch(() => undefined);

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


