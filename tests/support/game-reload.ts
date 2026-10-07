/**
 * Reload the DiJoker host and reopen the active game (ES-010 pattern).
 */

import type { Page } from 'playwright';

import {
  primeCanvasSession,
  settleCanvasToBaseGame,
} from '../../src/platform/index.js';
import { clearInterferingScreens } from '../../src/eye/index.js';
import type { PlaywrightGameDriver } from '../../src/driver/playwright-game-driver.js';
import type { SgapSession } from '../fixtures/index.js';

export const GAME_RELOAD_TIMEOUT_MS = 90_000;

export async function reloadAndReopenGame(options: {
  readonly sgapSession: SgapSession;
  readonly sgapDriver: PlaywrightGameDriver;
  readonly page: Page;
  readonly timeoutMs?: number;
  /** Keep an in-progress free-spin session — do not drain leftover FS. */
  readonly preserveFeatureSession?: boolean;
}): Promise<void> {
  const timeoutMs = options.timeoutMs ?? GAME_RELOAD_TIMEOUT_MS;
  const { sgapSession, sgapDriver, page } = options;

  if (options.preserveFeatureSession === true) {
    await sgapSession.platform.reloadActiveGameSession({ timeoutMs });
    await sgapDriver.attach();
    await sgapDriver.gameCanvas().waitFor({
      state: 'visible',
      timeout: timeoutMs,
    });
    await clearInterferingScreens({
      page,
      driver: sgapDriver,
      manifest: sgapSession.manifest,
      platform: sgapSession.platform,
      intent: 'resumeFeature',
    });
    return;
  }

  await page.reload({ waitUntil: 'domcontentloaded', timeout: timeoutMs });
  await sgapSession.platform.openGameHost({ timeoutMs });
  await sgapSession.platform.openGame({ timeoutMs });
  await sgapSession.platform.prepareActiveGameView({ timeoutMs });
  await sgapDriver.attach();

  await primeCanvasSession({
    page,
    driver: sgapDriver,
    manifest: sgapSession.manifest,
    initializeBody: sgapSession.platform.getInitializeBody(),
  });
  await sgapDriver.gameCanvas().waitFor({
    state: 'visible',
    timeout: timeoutMs,
  });
  await settleCanvasToBaseGame(
    page,
    sgapDriver,
    sgapSession.manifest,
    sgapSession.platform.getInitializeBody(),
  );
}
