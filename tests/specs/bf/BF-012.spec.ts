/**
 * BF-012 — Buy Feature, every tier
 *
 * Manual Test Case ID: BF-012
 * Intent: each buy choice the manifest declares (metadata.buyFeatureSelections, up to 4)
 * charges its own cost multiplier and starts at its own multiplier. Tier N reads
 * buyFeatureOptionNMultiplier / StartMultiplier / Scatters (see tests/support/buy-tier-check.ts).
 * Tiers beyond the declared count skip.
 */

import { test } from '../../fixtures/index.js';
import { requireCapabilities } from '../../support/capabilities.js';
import { buyTierSpec, runBuyTierCheck } from '../../support/buy-tier-check.js';

const MANUAL_TEST_ID = 'BF-012' as const;
const MAX_TIERS = 4;

test.describe('BF — Buy Feature', () => {
  requireCapabilities('buyFeature');

  for (let tier = 1; tier <= MAX_TIERS; tier += 1) {
    test(`${MANUAL_TEST_ID} buy tier ${tier} charges its multiplier and starts there`, async ({
      sgapSession,
      sgapDriver,
      page,
    }, testInfo) => {
      test.setTimeout(600_000);
      const spec = buyTierSpec(sgapSession.manifest, tier);
      test.skip(spec === undefined, `Manifest declares no buy tier ${tier}`);
      await runBuyTierCheck({ sgapSession, sgapDriver, page, testInfo }, MANUAL_TEST_ID, spec!);
    });
  }
});
