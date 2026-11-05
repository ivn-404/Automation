/**
 * Canvas healer for controller actions: the eye gate + idle-HUD readiness before
 * the click, and the logged recovery (overlay dismissal, vision re-locate) after a
 * miss. Installed on the session's controllers by the fixture for canvas games.
 */

import { GameDefectError, failureKind, type ActionHealer, type HealableAction } from '../../src/controllers/index.js';
import { observationFor } from '../../src/observability/index.js';
import type { SgapSession } from '../fixtures/index.js';
import { getLauncherMode } from '../fixtures/local-launcher-html.js';
import { prepareCanvasSpin } from './canvas-bet-control.js';
import { waitForBetQuiet, waitForIdleHud } from './canvas-healing.js';
import { recoverMissedCanvasClick } from './click-recovery.js';
import { betTrafficFor } from './failure-report.js';

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
      const quietStarted = Date.now();
      await waitForBetQuiet(driver.getPage(), 200, 2_000);
      if (Date.now() - quietStarted > 250) {
        const idle = await waitForIdleHud(driver.getPage(), driver, manifest, IDLE_TIMEOUT_MS);
        if (!idle.healed) {
          throw new Error(`HUD not idle before armed spin: ${idle.detail}`);
        }
      }
    },

    async settle(): Promise<void> {
      await waitForIdleHud(driver.getPage(), driver, manifest, IDLE_TIMEOUT_MS);
    },

    async recover(action: HealableAction, error: unknown): Promise<void> {
      const page = driver.getPage();
      const reason = error instanceof Error ? error.message.split('\n')[0] : String(error);
      if (failureKind(error) === 'defect') {
        observationFor(page)?.event('game-defect', `${action}: ${reason}`, { severity: 'warn' });
        return;
      }
      const clickAt = driver.lastCanvasHit?.at ?? 0;
      const rejected = betTrafficFor(page)
        ?.entries()
        .find((entry) => !entry.ok && entry.at >= clickAt - 500);
      if (rejected !== undefined) {
        throw new GameDefectError(
          `server answered /bet HTTP ${rejected.status}; not healing ${action}`,
        );
      }
      observationFor(page)?.event('recovery-attempt', `${action}: ${reason}`, { severity: 'warn' });
      await recoverMissedCanvasClick(page, driver, manifest, action, error, platform);
    },
  };
}

/** /bet wait per spin: staging round-trips are slower than the local mock. */
export function spinTimeoutMs(): number {
  return getLauncherMode() === 'staging' ? 45_000 : 30_000;
}
