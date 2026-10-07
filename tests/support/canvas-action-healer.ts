/**
 * Canvas healer for controller actions: the eye gate + idle-HUD readiness before
 * the click, and the logged recovery (overlay dismissal, vision re-locate) after a
 * miss. Installed on the session's controllers by the fixture for canvas games.
 */

import type { ActionHealer, HealableAction } from '../../src/controllers/index.js';
import { observationFor } from '../../src/observability/index.js';
import type { SgapSession } from '../fixtures/index.js';
import { getLauncherMode } from '../fixtures/local-launcher-html.js';
import { prepareCanvasSpin } from './canvas-bet-control.js';
import { waitForBetQuiet, waitForIdleHud } from './canvas-healing.js';
import { recoverMissedCanvasClick } from './click-recovery.js';

const IDLE_TIMEOUT_MS = 12_000;

export function createCanvasActionHealer(session: SgapSession): ActionHealer {
  const { driver, manifest, platform } = session;

  return {
    async prepare(action: HealableAction): Promise<void> {
      if (action !== 'spin') {
        return;
      }
      if (!(await prepareCanvasSpin(session, driver))) {
        throw new Error('spin control not visible after splash/idle wait');
      }
      // A /bet during locate means the circle was already shrinking. Wait it
      // out, then re-check idle so the waiter is armed on a still button.
      await waitForBetQuiet(driver.getPage(), 1_000, 5_000);
      const idle = await waitForIdleHud(driver.getPage(), driver, manifest, IDLE_TIMEOUT_MS);
      if (!idle.healed) {
        throw new Error(`HUD not idle before armed spin: ${idle.detail}`);
      }
    },

    async settle(): Promise<void> {
      await waitForIdleHud(driver.getPage(), driver, manifest, IDLE_TIMEOUT_MS);
    },

    async recover(action: HealableAction, error: unknown): Promise<void> {
      const reason = error instanceof Error ? error.message.split('\n')[0] : String(error);
      observationFor(driver.getPage())?.event('recovery-attempt', `${action}: ${reason}`, { severity: 'warn' });
      await recoverMissedCanvasClick(driver.getPage(), driver, manifest, action, error, platform);
    },
  };
}

/** /bet wait per spin: staging round-trips are slower than the local mock. */
export function spinTimeoutMs(): number {
  return getLauncherMode() === 'staging' ? 45_000 : 30_000;
}
