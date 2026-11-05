/**
 * BF-011 — Buy Feature, second option
 *
 * Manual Test Case ID: BF-011
 * Intent: when the manifest maps a second buy choice, selecting it charges
 * buyFeatureOption2Multiplier times the stake and the feature starts at
 * buyFeatureOption2StartMultiplier, or at the scatter-table start for the scatters dealt
 * (see tests/support/buy-tier-check.ts). Titles with one buy choice skip.
 * BF-012 runs the same check for every declared tier.
 */

import { test } from '../../fixtures/index.js';
import { requireCapabilities } from '../../support/capabilities.js';
import { buyTierSpec, runBuyTierCheck } from '../../support/buy-tier-check.js';

const MANUAL_TEST_ID = 'BF-011' as const;

test.describe('BF — Buy Feature', () => {
  requireCapabilities('buyFeature');

  test(`${MANUAL_TEST_ID} second buy option charges its multiplier and starts there`, async ({
    sgapSession,
    sgapDriver,
    page,
  }, testInfo) => {
    test.setTimeout(600_000);
    const spec = buyTierSpec(sgapSession.manifest, 2);
    test.skip(spec === undefined, 'Manifest has no second buy option');
    await runBuyTierCheck({ sgapSession, sgapDriver, page, testInfo }, MANUAL_TEST_ID, spec!);
  });
});
