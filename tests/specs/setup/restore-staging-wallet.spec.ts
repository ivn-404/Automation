/**
 * One-shot staging wallet restore — run before Wave 4 / buy specs when balance was lowered.
 */

import { test } from '../../fixtures/index.js';
import { getLauncherMode } from '../../fixtures/local-launcher-html.js';
import { restoreStagingWallet } from '../../support/launcher-balance.js';

test('restore staging wallet to default', async ({ page, sgapSession, sgapDriver }) => {
  test.skip(getLauncherMode() !== 'staging', 'staging only');
  await restoreStagingWallet({
    page,
    platform: sgapSession.platform,
    driver: sgapDriver,
    manifest: sgapSession.manifest,
  });
});
