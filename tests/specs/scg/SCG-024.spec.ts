/**
 * SCG-024 — Scratch Game
 *
 * Manual Test Case ID: SCG-024
 * Catalog: The scratch card background should be consistent with the Buy Feature
 *          background of the same slot game.
 * Intent (per QA): the reference backdrop is the slot's **Scatter Mode** (feature)
 *   screen — not the base game nor the buy-confirm modal. Enter Scatter Mode by
 *   buying the feature and capture its backdrop, then capture the scratch-card
 *   backdrop. Both overlay a different panel, so only the outer frame band (the
 *   themed backdrop in both states) is compared by colour histogram; the centre
 *   panels are ignored. Both screenshots are attached for manual confirmation.
 *   Skipped when the title cannot reach Scatter Mode (no Buy Feature / network).
 */

import { test } from '../../fixtures/index.js';
import { requireCapabilities } from '../../support/capabilities.js';
import { settleCanvasToBaseGame } from '../../../src/platform/index.js';
import { clearCanvasBlockers } from '../../../src/eye/canvas-blocker.js';
import { captureLocator } from '../../../src/platform/stable-screenshot.js';
import { buyFeatureForBet } from '../../support/canvas-bet-flow.js';
import {
  expectChecks,
  scratchCheck,
  startScratchCase,
} from '../../support/scratch-flow.js';
import {
  averageColourDistance,
  backgroundProfile,
  backgroundSimilarity,
  type BackgroundProfile,
} from '../../support/background-compare.js';

const MANUAL_TEST_ID = 'SCG-024' as const;
/**
 * Frame-band colour histograms must overlap at least this much to count as the
 * same theme. Calibrated from the staging sweep across every Scatter-Mode title:
 * genuine (consistent) matches scored Sugar 0.287, Beelze 0.351, Felice 0.772, so
 * the floor sits ~13% below the lowest genuine match (0.287). The raw `similarity`
 * is attached per game so the gate can be re-derived if the metric changes.
 */
const SIMILARITY_MIN = 0.25;
/** Scatter Mode frames sampled after the buy (window spans intro → free-spins play). */
const SCATTER_FRAMES = 8;

test.describe('SCG — Scratch Game', () => {
  requireCapabilities('scratchCard', 'buyFeature', 'scatterMode');

  test(`${MANUAL_TEST_ID} Scratch card background consistent with Scatter Mode background`, async ({
    sgapSession,
    sgapDriver,
    page,
  }, testInfo) => {
    test.setTimeout(420_000);
    const scratch = await startScratchCase({ sgapSession, sgapDriver, page, testInfo, manualTestId: MANUAL_TEST_ID });
    test.skip(
      sgapSession.manifest.network === undefined,
      `N/A — ${sgapSession.manifest.gameId} cannot reach Scatter Mode (no bet network config)`,
    );

    // Base-game reference (used to pick the true feature backdrop out of the
    // intro/award frames, which still sit on the base-game scene).
    const baseShot = await captureLocator(sgapDriver.gameCanvas(), { label: 'SCG-024 base' });
    const baseBg = backgroundProfile(baseShot);
    await testInfo.attach('base-game-background.png', { body: baseShot, contentType: 'image/png' });

    // 1) Scatter Mode backdrop — buy the feature to enter it, sample across the
    // feature, then keep the frame whose backdrop differs most from the base game
    // (the award dialogue sits on the base scene; the free-spins mode does not).
    let bought = false;
    for (let attempt = 1; attempt <= 3 && !bought; attempt += 1) {
      try {
        await buyFeatureForBet(sgapSession, sgapDriver, page, { settleAfter: false });
        bought = true;
      } catch (error) {
        console.log(`[scg] buy feature attempt ${attempt} failed: ${(error as Error).message}`);
        await settleCanvasToBaseGame(
          page,
          sgapDriver,
          sgapSession.manifest,
          sgapSession.platform.getInitializeBody(),
        ).catch(() => undefined);
      }
    }
    if (!bought) {
      throw new Error('Could not buy the feature to reach Scatter Mode after 3 attempts');
    }

    let scatterShot: Buffer | undefined;
    let scatterBg: BackgroundProfile | undefined;
    let scatterToBase = 1;
    for (let frame = 0; frame < SCATTER_FRAMES; frame += 1) {
      await page.waitForTimeout(frame === 0 ? 5_000 : 3_000);
      // A press-to-continue award intro holds the base scene until tapped.
      if (frame > 0) {
        await clearCanvasBlockers(page, sgapDriver, sgapSession.manifest, 1);
      }
      const shot = await captureLocator(sgapDriver.gameCanvas(), { label: 'SCG-024 scatter mode' });
      const profile = backgroundProfile(shot);
      const toBase = backgroundSimilarity(profile, baseBg);
      if (scatterShot === undefined || toBase < scatterToBase) {
        scatterShot = shot;
        scatterBg = profile;
        scatterToBase = toBase;
      }
    }
    await testInfo.attach('scatter-mode-background.png', { body: scatterShot!, contentType: 'image/png' });
    await settleCanvasToBaseGame(page, sgapDriver, sgapSession.manifest, sgapSession.platform.getInitializeBody());

    // 2) Scratch-card screen backdrop.
    await scratch.open();
    await page.waitForTimeout(1_000);
    const scratchShot = await scratch.screenshotDrawer();
    await testInfo.attach('scratch-background.png', { body: scratchShot, contentType: 'image/png' });

    const scratchBg = backgroundProfile(scratchShot);
    const similarity = backgroundSimilarity(scratchBg, scatterBg!);
    const colourDistance = averageColourDistance(scratchBg, scatterBg!);
    await testInfo.attach('background-compare.json', {
      body: JSON.stringify(
        {
          similarity,
          similarityMin: SIMILARITY_MIN,
          colourDistance,
          scatterFrames: SCATTER_FRAMES,
          scatterVsBase: scatterToBase,
          scratch: { average: scratchBg.average, samples: scratchBg.samples },
          scatterMode: { average: scatterBg!.average, samples: scatterBg!.samples },
          baseGame: { average: baseBg.average },
        },
        null,
        2,
      ),
      contentType: 'application/json',
    });

    await expectChecks(testInfo, [
      scratchCheck(scratchBg.samples > 0 && scatterBg!.samples > 0, 'Both backdrops were captured', '>0 samples', {
        scratch: scratchBg.samples,
        scatterMode: scatterBg!.samples,
      }),
      scratchCheck(
        similarity >= SIMILARITY_MIN,
        `Backdrop colour overlap ${similarity} ≥ ${SIMILARITY_MIN} (avg-colour distance ${colourDistance})`,
        `≥ ${SIMILARITY_MIN}`,
        similarity,
      ),
    ]);
  });
});
