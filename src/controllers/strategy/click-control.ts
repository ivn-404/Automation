/**
 * Locator strategy for a named canvas HUD control.
 *
 * Order: the Phaser scene graph (when the surface profile has a band for the action),
 * then the manifest ratio. HUD art moves with layout; manifest points do not, so a
 * located object beats a stored ratio. A miss is never silent — the manifest click is
 * journaled as a fallback with the reason the scene graph gave.
 */

import type { GameManifest, ObservableWaitOptions } from '../../core/models/index.js';
import type { PlaywrightGameDriver } from '../../driver/playwright-game-driver.js';
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
  await driver.clickCanvas(action, { ...options, fallbackReason: located.detail });
}
