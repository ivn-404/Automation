/**
 * Locator strategy for a named canvas HUD control.
 *
 * Order: Phaser scene graph → remembered vision/Phaser ratio from idle locate →
 * manifest pin. HUD art moves; a live or just-measured point beats the pin. A
 * miss is never silent — the fallback is journaled with why Phaser did not hit.
 */

import type { GameManifest, ObservableWaitOptions } from '../../core/models/index.js';
import type { PlaywrightGameDriver } from '../../driver/playwright-game-driver.js';
import { recallHealedRatio } from '../../eye/learned-ratios.js';
import { locateControlByPhaser, type PhaserLocateResult } from '../../runtime/phaser-locate.js';
import { phaserBand } from '../../surfaces/index.js';

/** A control mid-tween (press scale, row slide) can sit outside its band for a few frames. */
const RELOCATE_WINDOW_MS = 1_500;
const RELOCATE_POLL_MS = 250;

export interface ClickCanvasControlOptions {
  /** Store the located ratio so a later armed retry can reuse it. */
  readonly remember?: boolean;
}

export async function clickCanvasControl(
  driver: PlaywrightGameDriver,
  manifest: GameManifest,
  action: string,
  options?: ObservableWaitOptions,
  locate?: ClickCanvasControlOptions,
): Promise<void> {
  if (phaserBand(driver.surface, action) === undefined) {
    await driver.clickCanvas(action, options);
    return;
  }
  const page = driver.getPage();
  const deadline = Date.now() + RELOCATE_WINDOW_MS;
  let located: PhaserLocateResult;
  for (;;) {
    located = await locateControlByPhaser(page, manifest, driver.iframeSelector, action, {
      remember: locate?.remember ?? false,
    });
    if (located.hit !== undefined || Date.now() >= deadline) {
      break;
    }
    await page.waitForTimeout(RELOCATE_POLL_MS);
  }
  if (located.hit !== undefined) {
    await driver.clickCanvasAt(
      { x: located.hit.xRatio, y: located.hit.yRatio },
      { ...options, label: action, strategy: 'phaser' },
    );
    return;
  }
  const healed = recallHealedRatio(manifest.gameId, action);
  if (healed !== undefined) {
    await driver.clickCanvasAt(
      { x: healed.x, y: healed.y },
      {
        ...options,
        label: action,
        strategy: healed.source,
        fallback: true,
        detail: `${located.detail}; using ${healed.source} ${healed.x.toFixed(3)},${healed.y.toFixed(3)}`,
      },
    );
    return;
  }
  await driver.clickCanvas(action, { ...options, fallbackReason: located.detail });
}
