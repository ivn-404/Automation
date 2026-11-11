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
 * Always re-applies left/top/width/height. Launcher navigation can reset the
 * Chromium window; skipping after the first call left regression workers as
 * small floating windows instead of filling each half-monitor like capture.
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
    const applyBounds = async (): Promise<void> => {
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
    } else {
      const kept = page.viewportSize();
      console.log(
        `[sgap-tile] ${title} window=${bounds.width}x${bounds.height} inner=${inner.width}x${inner.height} syncViewport=false keptViewport=${kept?.width ?? '?'}x${kept?.height ?? '?'}`,
      );
    }
    const actual = (await session.send('Browser.getWindowBounds', { windowId }).catch(() => undefined)) as
      | { bounds?: { left?: number; top?: number; width?: number; height?: number } }
      | undefined;
    const got = actual?.bounds;
    if (
      got !== undefined &&
      (Math.abs((got.width ?? 0) - bounds.width) > 40 || Math.abs((got.height ?? 0) - bounds.height) > 40)
    ) {
      await applyBounds();
    }
  } catch {
    if (syncViewport) {
      await page.setViewportSize(inner).catch(() => undefined);
    }
  }

  await page.evaluate(`document.title = ${JSON.stringify(title)}`).catch(() => undefined);
}
