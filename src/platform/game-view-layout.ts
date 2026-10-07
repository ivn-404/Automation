/**
 * Dynamic portrait-in-desktop layout.
 *
 * Sugar Wonderland (and other DiJoker mobile shells) gate on iframe
 * innerWidth > innerHeight and show "Rotate to portrait". The host window
 * stays desktop-sized; the game iframe is fitted to a portrait rectangle
 * that fits the current window.
 */
import type { GameManifest } from '../core/models/index.js';
import { loadSurfaceProfile, loadSurfaceProfileById } from '../surfaces/load-surface-profile.js';

/**
 * Portrait shape when nothing else is known. Real values live in
 * `config/surfaces/<profile>.json`; prefer `portraitAspectFor(manifest)`.
 */
export const PORTRAIT_ASPECT = loadSurfaceProfileById('base').portraitAspect;

/**
 * The portrait rectangle to fit this game into: an explicit manifest override
 * first, then the game's surface profile.
 */
export function portraitAspectFor(manifest: GameManifest): {
  readonly width: number;
  readonly height: number;
} {
  return parseWxH(manifest.metadata?.portraitViewport, loadSurfaceProfile(manifest).portraitAspect);
}

/** Typical Chromium window chrome on Windows (outer size − layout viewport). */
export const WINDOW_CHROME = { width: 16, height: 88 } as const;

export function parseWxH(
  raw: string | undefined,
  fallback: { readonly width: number; readonly height: number },
): { readonly width: number; readonly height: number } {
  if (raw === undefined) {
    return fallback;
  }
  const [widthRaw, heightRaw] = raw.split('x');
  const width = Number(widthRaw);
  const height = Number(heightRaw);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return fallback;
  }
  return { width, height };
}

export function innerViewportForWindow(outer: {
  readonly width: number;
  readonly height: number;
}): { readonly width: number; readonly height: number } {
  return {
    width: Math.max(320, Math.floor(outer.width - WINDOW_CHROME.width)),
    height: Math.max(360, Math.floor(outer.height - WINDOW_CHROME.height)),
  };
}

/**
 * Largest portrait rectangle that fits in `container`, keeping the preferred
 * aspect (default 390×844). Always returns width < height.
 */
export function fitPortraitSize(
  container: { readonly width: number; readonly height: number },
  preferred: { readonly width: number; readonly height: number } = PORTRAIT_ASPECT,
): { readonly width: number; readonly height: number } {
  const aspect = preferred.width / preferred.height;
  let height = Math.min(container.height, preferred.height);
  let width = Math.round(height * aspect);
  if (width > container.width) {
    width = container.width;
    height = Math.round(width / aspect);
  }
  width = Math.max(200, width);
  height = Math.max(320, height);
  if (width >= height) {
    width = Math.max(200, height - 1);
  }
  return { width, height };
}
