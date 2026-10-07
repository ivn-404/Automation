/**
 * Place the headed Chromium window into its parallel-lane cell.
 *
 * Dual-monitor row (`1 2 | 3 4`):
 *
 *   [1] [2]  |  [3] [4]
 *
 * Single-monitor fallback:
 *
 *   [1] [2]
 *   [3] [4]
 *
 * Sets left/top/width/height from the detected screens so each worker fills
 * its cell. Syncs the layout viewport to the window inner size (dynamic).
 * Does not force a landscape 1400×900 viewport — that brings back
 * "Rotate to portrait" inside the game iframe.
 */

import type { Page } from 'playwright';

import { innerViewportForWindow } from '../../src/platform/game-view-layout.js';
import { windowBoundsForLane, workerTag, type ParallelLaneRuntime } from './parallel-lanes.js';

export async function tileLaneWindow(
  page: Page,
  lane: Pick<ParallelLaneRuntime, 'col' | 'row' | 'id' | 'category' | 'playerId'>,
  options?: { readonly syncViewport?: boolean },
): Promise<void> {
  const bounds = windowBoundsForLane(lane);
  const title = workerTag(lane);
  const inner = innerViewportForWindow(bounds);
  const syncViewport = options?.syncViewport !== false;

  try {
    const session = await page.context().newCDPSession(page);
    const { windowId } = await session.send('Browser.getWindowForTarget');
    const applyBounds = async () => {
      await session.send('Browser.setWindowBounds', {
        windowId,
        bounds: {
          left: bounds.left,
          top: bounds.top,
          width: bounds.width,
          height: bounds.height,
          windowState: 'normal',
        },
      });
    };

    await applyBounds();
    if (syncViewport) {
      await page.setViewportSize(inner);
      await applyBounds();
    }
  } catch {
    if (syncViewport) {
      await page.setViewportSize(inner).catch(() => undefined);
    }
  }

  await page.evaluate(`document.title = ${JSON.stringify(title)}`).catch(() => undefined);
}
