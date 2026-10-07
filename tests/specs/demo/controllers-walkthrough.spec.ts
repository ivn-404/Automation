/**
 * CTRL-DEMO — one browser session, all new controllers + click tracker.
 *
 * Run headed with click tracker (no restart between steps):
 *   npx pnpm demo:controllers:staging
 */

import { test, expect } from '../../fixtures/index.js';
import { clearCanvasOverlays } from '../../../src/platform/index.js';
import { spinForBet } from '../../support/canvas-bet-flow.js';

async function settleBaseGame(
  sgapSession: import('../../fixtures/index.js').SgapSession,
  sgapDriver: import('../../fixtures/index.js').SgapSession['driver'],
): Promise<void> {
  await sgapDriver.gameCanvas().waitFor({ state: 'visible' });
  await clearCanvasOverlays(sgapDriver, sgapSession.manifest, 6);
  if (sgapSession.manifest.canvasActions?.actions.enter !== undefined) {
    await sgapDriver.clickCanvas('enter').catch(() => undefined);
    await sgapDriver.clickCanvas('acknowledge').catch(() => undefined);
    await sgapDriver.clickCanvas('acknowledgeAlt').catch(() => undefined);
  }
  await clearCanvasOverlays(sgapDriver, sgapSession.manifest, 4);
}

test.describe('CTRL — Controller walkthrough', () => {
  test('CTRL-DEMO amplify, settings, and fullscreen in one session', async ({
    sgapSession,
    sgapDriver,
  }, testInfo) => {
    test.setTimeout(300_000);
    testInfo.setTimeout(300_000);

    await expect(sgapDriver.isAttached()).resolves.toBe(true);
    await settleBaseGame(sgapSession, sgapDriver);

    // --- Amplify bet (toggle on → off; no spin while toggling) ---
    await expect(sgapSession.amplifyBet.isAvailable()).resolves.toBe(true);
    expect(sgapSession.amplifyBet.isAmplifyEnabled()).toBe(false);
    await sgapSession.amplifyBet.enable({ timeoutMs: 15_000 });
    expect(sgapSession.amplifyBet.isAmplifyEnabled()).toBe(true);
    await sgapSession.amplifyBet.disable({ timeoutMs: 15_000 });
    expect(sgapSession.amplifyBet.isAmplifyEnabled()).toBe(false);

    await settleBaseGame(sgapSession, sgapDriver);

    // --- Settings (open → close, same session) ---
    await expect(sgapSession.settings.isAvailable()).resolves.toBe(true);
    expect(sgapSession.settings.isSettingsOpen()).toBe(false);
    await sgapSession.settings.open({ timeoutMs: 15_000 });
    expect(sgapSession.settings.isSettingsOpen()).toBe(true);
    await sgapSession.settings.close({ timeoutMs: 15_000 });
    expect(sgapSession.settings.isSettingsOpen()).toBe(false);

    await settleBaseGame(sgapSession, sgapDriver);

    // --- Fullscreen (enter → exit, same session) ---
    await expect(sgapSession.fullscreen.isAvailable()).resolves.toBe(true);
    expect(sgapSession.fullscreen.isFullscreen()).toBe(false);
    await sgapSession.fullscreen.enter({ timeoutMs: 15_000 });
    expect(sgapSession.fullscreen.isFullscreen()).toBe(true);
    await sgapSession.fullscreen.exit({ timeoutMs: 15_000 });
    expect(sgapSession.fullscreen.isFullscreen()).toBe(false);

    // Sanity: base game still spins after all controller actions.
    await settleBaseGame(sgapSession, sgapDriver);
    await spinForBet(sgapSession, sgapDriver);
  });
});
