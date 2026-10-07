/**
 * Fixture smoke — SGAP wiring + Spin controller (local launcher).
 */
import { test, expect } from '../fixtures/index.js';
import { getLauncherMode } from '../fixtures/local-launcher-html.js';

test.describe('SGAP fixtures', () => {
  test('sgapSession loads manifest and attaches game iframe', async ({ sgapSession, sgapDriver }) => {
    expect(sgapSession.manifest.gameId).toBe('sugar-wonderland');
    expect(sgapSession.manifest.metadata?.rendering).toBe('canvas');
    expect(sgapSession.environment.name).toBe('staging');
    expect(await sgapDriver.isAttached()).toBe(true);
    expect(sgapSession.ui.resolveIframe().selector).toBe('iframe[title="Game session"]');
  });

  test('sgapRegistry respects manifest controller enablement', async ({ sgapSession }) => {
    expect(sgapSession.registry.isEnabled('spin')).toBe(true);
    expect(sgapSession.registry.isEnabled('buyFeature')).toBe(true);
    expect(sgapSession.registry.has('spin')).toBe(true);
  });

  test('spin controller executes canvas spin via registry', async ({ sgapSession, page }) => {
    test.skip(getLauncherMode() === 'staging', 'Local launcher spin counter is not available on staging');

    expect(await sgapSession.spin.isAvailable()).toBe(true);
    await sgapSession.registry.getEnabled('spin').spin();

    const clicks = await page
      .frameLocator('iframe[title="Game session"]')
      .locator('body')
      .evaluate((body) => {
        const w = body.ownerDocument.defaultView as { __sgapSpinClicks?: number } | null;
        return w?.__sgapSpinClicks ?? 0;
      });
    expect(clicks).toBeGreaterThanOrEqual(1);
  });
});
