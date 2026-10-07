/**
 * Keep the game iframe portrait, and put it back when it slips.
 *
 * The DiJoker shell gates on `innerWidth > innerHeight` and paints a
 * "Rotate to portrait" blocker over the whole canvas. The blocker swallows every
 * tap, so a spin that lands on it fails with a timeout that looks like a missed
 * click. `prepareGameView` sizes the iframe correctly at setup, but it does so
 * with inline styles — any host re-render (live-history panel, socket update,
 * balance refresh) drops them and the game flips to landscape mid-test.
 *
 * Two parts:
 *  - Detection is geometric, never textual. The blocker's caption is painted into
 *    the canvas, so `getByText(/rotate to portrait/)` never matches it; reading
 *    the frame's own innerWidth/innerHeight is what the game itself gates on.
 *  - The lock is a stylesheet rule rather than inline styles. Host re-renders
 *    reset the `style` attribute but do not touch an injected stylesheet, and a
 *    selector-based rule keeps applying even if the iframe node is replaced.
 */

import type { Frame, Page } from 'playwright';

import type { GameManifest } from '../core/models/index.js';
import { fitPortraitSize, portraitAspectFor } from './game-view-layout.js';

export interface OrientationState {
  readonly frameFound: boolean;
  /** False when the size probe timed out — "unknown", which is not the same as landscape. */
  readonly readable: boolean;
  readonly innerWidth: number;
  readonly innerHeight: number;
  readonly portrait: boolean;
}

/** True only when the frame was actually measured and came back wider than tall. */
export function isBlockedByRotation(state: OrientationState): boolean {
  return state.frameFound && state.readable && !state.portrait;
}

export type PortraitHealOutcome =
  | 'already-portrait'
  | 'healed-by-lock'
  | 'healed-by-viewport'
  | 'frame-missing'
  | 'still-landscape';

export interface PortraitHealResult {
  readonly outcome: PortraitHealOutcome;
  readonly before: OrientationState;
  readonly after: OrientationState;
  readonly healed: boolean;
}

const LOCK_POLL_INTERVAL_MS = 250;
const LOCK_POLL_TIMEOUT_MS = 3_000;
const ORIENTATION_PROBE_TIMEOUT_MS = 2_000;

function gameFrameKey(manifest: GameManifest): string {
  const key = manifest.metadata?.launcherGameKey ?? manifest.gameId.replace(/-/gu, '_');
  return key.toLowerCase();
}

export function findGameFrame(page: Page, manifest: GameManifest): Frame | undefined {
  const key = gameFrameKey(manifest);
  return page.frames().find((frame) => frame.url().toLowerCase().includes(key));
}

export async function readOrientation(
  page: Page,
  manifest: GameManifest,
): Promise<OrientationState> {
  const frame = findGameFrame(page, manifest);
  if (frame === undefined) {
    return { frameFound: false, readable: false, innerWidth: 0, innerHeight: 0, portrait: false };
  }

  // `frame.evaluate` waits indefinitely while the frame navigates or blocks on a
  // busy render loop; this probe runs on a recovery path and must never be the
  // thing that hangs it.
  const probe = frame
    .evaluate(() => {
      const view = globalThis as unknown as { innerWidth: number; innerHeight: number };
      return { width: view.innerWidth, height: view.innerHeight };
    })
    .catch(() => undefined);
  const size = await Promise.race([
    probe,
    new Promise<undefined>((resolve) => {
      setTimeout(() => resolve(undefined), ORIENTATION_PROBE_TIMEOUT_MS);
    }),
  ]);

  if (size === undefined) {
    return { frameFound: true, readable: false, innerWidth: 0, innerHeight: 0, portrait: false };
  }

  return {
    frameFound: true,
    readable: true,
    innerWidth: size.width,
    innerHeight: size.height,
    portrait: size.height > size.width,
  };
}

/** Minimal shape of the pieces of `document` the lock touches; this project builds without the DOM lib. */
interface StyleHostNode {
  id: string;
  textContent: string;
  remove(): void;
}

interface StyleHostDocument {
  getElementById(id: string): StyleHostNode | null;
  createElement(tag: string): StyleHostNode;
  head: { appendChild(node: StyleHostNode): void } | null;
  documentElement: { appendChild(node: StyleHostNode): void };
}

/**
 * Pin the iframe to `size` with a stylesheet rule that survives host re-renders.
 * Idempotent — repeated calls only rewrite the rule text.
 */
export async function installPortraitLock(
  page: Page,
  iframeSelector: string,
  size: { readonly width: number; readonly height: number },
): Promise<void> {
  await page
    .evaluate(
      ({ selector, width, height }) => {
        const STYLE_ID = 'sgap-portrait-lock';
        const doc = (globalThis as unknown as { document: StyleHostDocument }).document;
        let style = doc.getElementById(STYLE_ID);
        if (style === null) {
          style = doc.createElement('style');
          style.id = STYLE_ID;
          (doc.head ?? doc.documentElement).appendChild(style);
        }
        const dimensions = [
          `width:${width}px !important`,
          `height:${height}px !important`,
          `min-width:${width}px !important`,
          `min-height:${height}px !important`,
          `max-width:${width}px !important`,
          `max-height:${height}px !important`,
        ].join(';');
        style.textContent = `${selector}{${dimensions};}`;
      },
      { selector: iframeSelector, width: size.width, height: size.height },
    )
    .catch(() => undefined);
}

export async function removePortraitLock(page: Page): Promise<void> {
  await page
    .evaluate(() => {
      const doc = (globalThis as unknown as { document: StyleHostDocument }).document;
      doc.getElementById('sgap-portrait-lock')?.remove();
    })
    .catch(() => undefined);
}

function portraitTargetFor(
  page: Page,
  manifest: GameManifest,
): { readonly width: number; readonly height: number } {
  const preferred = portraitAspectFor(manifest);
  const viewport = page.viewportSize() ?? { width: 1400, height: 900 };
  return fitPortraitSize(viewport, preferred);
}

interface RoomBox {
  readonly top: number;
  readonly left: number;
  readonly bottom: number;
  readonly right: number;
}

interface RoomNode {
  getBoundingClientRect(): RoomBox;
  readonly parentElement: RoomNode | null;
}

/**
 * Room the host actually shows for the iframe: from its top-left corner to the
 * nearest clipping ancestor (launcher modal body) or the viewport edge.
 * `overflowY` > 0 means the bottom of the game is cut off.
 */
export async function measureIframeRoom(
  page: Page,
  iframeSelector: string,
): Promise<{ readonly width: number; readonly height: number; readonly overflowY: number } | undefined> {
  return page
    .locator(iframeSelector)
    .first()
    .evaluate((el) => {
      const g = globalThis as unknown as {
        innerWidth: number;
        innerHeight: number;
        getComputedStyle(node: RoomNode): {
          overflow: string;
          overflowX: string;
          overflowY: string;
          paddingBottom: string;
          paddingRight: string;
        };
      };
      const self = el as unknown as RoomNode;
      const box = self.getBoundingClientRect();
      let bottom = g.innerHeight;
      let right = g.innerWidth;
      for (let node = self.parentElement; node !== null; node = node.parentElement) {
        const cs = g.getComputedStyle(node);
        const nodeBox = node.getBoundingClientRect();
        if (/hidden|auto|scroll|clip/u.test(`${cs.overflowY} ${cs.overflow}`)) {
          bottom = Math.min(bottom, nodeBox.bottom - (Number.parseFloat(cs.paddingBottom) || 0));
        }
        if (/hidden|auto|scroll|clip/u.test(`${cs.overflowX} ${cs.overflow}`)) {
          right = Math.min(right, nodeBox.right - (Number.parseFloat(cs.paddingRight) || 0));
        }
      }
      return {
        width: Math.floor(right - box.left),
        height: Math.floor(bottom - box.top),
        overflowY: Math.ceil(box.bottom - bottom),
      };
    })
    .catch(() => undefined);
}

/**
 * Shrink an already-locked portrait iframe until its bottom HUD row is inside the
 * host's visible area. Launcher chrome (modal header, live-history panel) can
 * leave less room than the viewport, which hides Spin/Menu below the fold.
 */
export async function shrinkIframeToVisibleRoom(
  page: Page,
  iframeSelector: string,
  locked: { readonly width: number; readonly height: number },
  preferred: { readonly width: number; readonly height: number },
  lock: (size: { readonly width: number; readonly height: number }) => Promise<void>,
): Promise<{ readonly width: number; readonly height: number }> {
  let current = locked;
  for (let pass = 0; pass < 3; pass += 1) {
    const room = await measureIframeRoom(page, iframeSelector);
    if (room === undefined || room.overflowY <= 1) {
      break;
    }
    const next = fitPortraitSize(
      { width: Math.max(1, room.width), height: Math.max(1, current.height - room.overflowY) },
      preferred,
    );
    if (next.height >= current.height) {
      break;
    }
    current = next;
    await lock(current);
  }
  return current;
}

async function waitForPortrait(
  page: Page,
  manifest: GameManifest,
): Promise<OrientationState> {
  const deadline = Date.now() + LOCK_POLL_TIMEOUT_MS;
  let state = await readOrientation(page, manifest);
  while (!state.portrait && Date.now() < deadline) {
    await page.waitForTimeout(LOCK_POLL_INTERVAL_MS);
    state = await readOrientation(page, manifest);
  }
  return state;
}

/**
 * Restore portrait without reloading, cheapest remedy first: re-pin the iframe,
 * then shrink the layout viewport. The game clears its own blocker on resize, so
 * neither step costs the round in progress. Callers escalate to a frame reload
 * only when this returns `still-landscape`.
 */
export async function healPortraitOrientation(
  page: Page,
  manifest: GameManifest,
  iframeSelector: string,
  options?: { readonly allowViewportResize?: boolean },
): Promise<PortraitHealResult> {
  const before = await readOrientation(page, manifest);

  if (!before.frameFound) {
    return { outcome: 'frame-missing', before, after: before, healed: false };
  }
  if (!isBlockedByRotation(before)) {
    return { outcome: 'already-portrait', before, after: before, healed: true };
  }

  const target = portraitTargetFor(page, manifest);

  await installPortraitLock(page, iframeSelector, target);
  await shrinkIframeToVisibleRoom(
    page,
    iframeSelector,
    target,
    portraitAspectFor(manifest),
    (size) => installPortraitLock(page, iframeSelector, size),
  );
  let after = await waitForPortrait(page, manifest);
  if (after.portrait) {
    return { outcome: 'healed-by-lock', before, after, healed: true };
  }

  // Resizing the layout viewport re-lays out the whole host and can disturb a
  // round in flight, so it stays opt-in and the lock alone is the default remedy.
  const preferred = portraitAspectFor(manifest);
  const viewport = page.viewportSize();
  if (options?.allowViewportResize === true && viewport !== null && viewport.width > viewport.height) {
    await page.setViewportSize(fitPortraitSize(viewport, preferred)).catch(() => undefined);
    await installPortraitLock(page, iframeSelector, portraitTargetFor(page, manifest));
    after = await waitForPortrait(page, manifest);
    if (after.portrait) {
      return { outcome: 'healed-by-viewport', before, after, healed: true };
    }
  }

  return { outcome: 'still-landscape', before, after, healed: false };
}

export function describeOrientation(state: OrientationState): string {
  if (!state.frameFound) {
    return 'game frame not found';
  }
  if (!state.readable) {
    return 'size unreadable (frame busy)';
  }
  const shape = state.portrait ? 'portrait' : 'LANDSCAPE (rotate blocker)';
  return `${state.innerWidth}x${state.innerHeight} ${shape}`;
}
