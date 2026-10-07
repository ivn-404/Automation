/**
 * Grid spam click rule (Sugar / DiJoker canvas package).
 *
 * Flow: Spin Button | Autoplay | Buy Feature → spin trigger → grid / skip spam.
 * Never: Game load → spam click the reel grid.
 *
 * - Grid spam: acknowledge / dismiss coords on the reel (red area in QA diagram).
 * - Skip spam: only the configured skip point (yellow circle).
 * - Non-grid dismiss: never closeOverlay (that hit is Game Player Close / panel X / paytable).
 */

import type { GameManifest } from '../core/models/index.js';
import type { PlaywrightGameDriver } from '../driver/playwright-game-driver.js';
import {
  dismissCanvasBlocker,
  isDismissableBlocker,
  readHudState,
  settleHudState,
} from '../eye/canvas-blocker.js';
import { observationFor } from '../observability/index.js';

const spinTriggeredDrivers = new WeakSet<PlaywrightGameDriver>();

const DEFAULT_GRID_SPAM_ACTIONS = ['acknowledge', 'acknowledgeAlt', 'dismiss'] as const;
const DEFAULT_NON_GRID_DISMISS_ACTIONS: readonly string[] = [];
const BLOCKED_DISMISS_ACTIONS = new Set(['closeOverlay']);
const DEFAULT_SKIP_ACTION = 'skip';

export function markSpinTriggered(driver: PlaywrightGameDriver): void {
  spinTriggeredDrivers.add(driver);
}

export function resetSpinTrigger(driver: PlaywrightGameDriver): void {
  spinTriggeredDrivers.delete(driver);
}

export function hasSpinTrigger(driver: PlaywrightGameDriver): boolean {
  return spinTriggeredDrivers.has(driver);
}

function parseActionList(manifest: GameManifest, metadataKey: string, fallback: readonly string[]): string[] {
  const raw = manifest.metadata?.[metadataKey];
  if (raw === undefined || raw.trim().length === 0) {
    return [...fallback];
  }
  return raw
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

export function gridSpamActionNames(manifest: GameManifest): string[] {
  return parseActionList(manifest, 'gridSpamActions', DEFAULT_GRID_SPAM_ACTIONS);
}

export function nonGridDismissActionNames(manifest: GameManifest): string[] {
  return parseActionList(manifest, 'nonGridDismissActions', DEFAULT_NON_GRID_DISMISS_ACTIONS).filter(
    (name) => !BLOCKED_DISMISS_ACTIONS.has(name),
  );
}

export function skipActionName(manifest: GameManifest): string {
  return manifest.metadata?.skipAction?.trim() || DEFAULT_SKIP_ACTION;
}

async function spamActions(
  driver: PlaywrightGameDriver,
  manifest: GameManifest,
  actionNames: readonly string[],
  rounds: number,
): Promise<void> {
  if (manifest.canvasActions === undefined) {
    return;
  }
  for (let round = 0; round < rounds; round += 1) {
    for (const actionName of actionNames) {
      if (manifest.canvasActions.actions[actionName] === undefined) {
        continue;
      }
      await driver.clickCanvas(actionName, { singleInput: true }).catch(() => undefined);
    }
  }
}

/** Top/side chrome dismiss — allowed before any spin trigger. */
export async function clearNonGridOverlays(
  driver: PlaywrightGameDriver,
  manifest: GameManifest,
  rounds = 1,
): Promise<void> {
  await spamActions(driver, manifest, nonGridDismissActionNames(manifest), rounds);
}

/**
 * Spam-click reel grid overlay coords. Requires a prior spin trigger unless forced.
 */
export async function spamClickGridOverlays(
  driver: PlaywrightGameDriver,
  manifest: GameManifest,
  rounds = 2,
  options?: { readonly force?: boolean },
): Promise<void> {
  if (!options?.force && !hasSpinTrigger(driver)) {
    return;
  }
  await spamActions(driver, manifest, gridSpamActionNames(manifest), rounds);
}

/**
 * Spam-click the skip zone only (yellow circle). Requires a prior spin trigger unless forced.
 */
export async function spamClickSkip(
  driver: PlaywrightGameDriver,
  manifest: GameManifest,
  rounds = 2,
  options?: { readonly force?: boolean },
): Promise<void> {
  if (!options?.force && !hasSpinTrigger(driver)) {
    return;
  }
  const skip = skipActionName(manifest);
  await spamActions(driver, manifest, [skip], rounds);
}

export interface ClearCanvasOverlaysOptions {
  /** When true, grid + skip spam even without a recorded spin trigger (calibration only). */
  readonly forceGridSpam?: boolean;
  /** When false, never grid/skip spam this call (non-grid dismiss still runs). */
  readonly allowGridSpam?: boolean;
}

/**
 * Dismiss overlays: non-grid always; grid + skip only after spin | autoplay | buy trigger,
 * and only while the eye does not see an idle, unobstructed HUD.
 * `SGAP_BLIND_OVERLAY_TAPS=1` restores the ungated taps for A/B comparison.
 */
export async function clearCanvasOverlaysWithSpinGate(
  driver: PlaywrightGameDriver,
  manifest: GameManifest,
  rounds = 2,
  options?: ClearCanvasOverlaysOptions,
): Promise<void> {
  await clearNonGridOverlays(driver, manifest, Math.max(1, Math.min(rounds, 2)));

  const maySpamGrid =
    options?.forceGridSpam === true ||
    (options?.allowGridSpam !== false && hasSpinTrigger(driver));

  if (!maySpamGrid) {
    return;
  }

  const total = Math.min(rounds, 2);
  if (process.env.SGAP_BLIND_OVERLAY_TAPS === '1') {
    await spamClickGridOverlays(driver, manifest, total, { force: options?.forceGridSpam });
    await spamClickSkip(driver, manifest, total, { force: options?.forceGridSpam });
    return;
  }

  // Eye gate: tap only while something is on top of the HUD, and prefer a targeted
  // dismiss of a recognised blocker over the grid points.
  for (let round = 0; round < total; round += 1) {
    const state = round === 0 ? await settleHudState(driver, 1_500) : await readHudState(driver);
    if (state.idle) {
      if (round === 0) {
        observationFor(driver.getPage())?.event('overlay-gate', `HUD idle — no overlay taps (${state.detail})`);
      }
      return;
    }
    if (isDismissableBlocker(state.blocker.kind)) {
      await dismissCanvasBlocker(driver, manifest, state.blocker);
      continue;
    }
    if (round === 0) {
      observationFor(driver.getPage())?.event('overlay-gate', `HUD not idle — overlay taps (${state.detail})`);
    }
    await spamClickGridOverlays(driver, manifest, 1, { force: options?.forceGridSpam });
    await spamClickSkip(driver, manifest, 1, { force: options?.forceGridSpam });
  }
}
