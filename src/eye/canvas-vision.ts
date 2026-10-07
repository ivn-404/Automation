/**
 * Locate canvas controls by their colour signature instead of fixed manifest ratios.
 *
 * Canvas games expose no DOM, so every control is a hard-coded 0–1 ratio in the
 * manifest. When the game re-lays out (portrait/landscape swap, modal open, HUD
 * shift) those ratios point at empty pixels and every tap silently misses. The
 * controls themselves stay visually distinctive — Sugar's spin and dialog OK are
 * saturated green, buy is red — so a colour-blob scan recovers where they really are.
 *
 * Ratios returned are relative to the image passed in, not to the portrait hit area.
 */

import { loadSurfaceProfileById, visionSignature } from '../surfaces/load-surface-profile.js';
import type { SurfaceProfile } from '../surfaces/types.js';
import { decodePng, resizeNearest, type RgbaImage } from '../verification/reel/image-match.js';

/** Controls are flat saturated fills, so a coarse hue bucket is enough to isolate them. */
export type ControlHue = 'green' | 'red' | 'amber' | 'pink';

export interface ControlSignature {
  readonly id: string;
  readonly hue: ControlHue;
  /** Restrict the search to a vertical band (0–1 of image height). Optional x0/x1 keep HUD spin off scenery. */
  readonly band?: { readonly y0: number; readonly y1: number; readonly x0?: number; readonly x1?: number };
  /** Reject blobs smaller than this fraction of the image (noise, icon glyphs). */
  readonly minAreaRatio?: number;
  /** Reject blobs larger than this fraction (background art, win banners). */
  readonly maxAreaRatio?: number;
  /** Default is the largest qualifying blob. Bet +/− must pick by x, not area. */
  readonly pick?: 'largest' | 'leftmost' | 'rightmost';
  /** Label only pixels inside the band window, so same-hue scenery touching the control
   *  from outside is cut off (Felice's portal glow merges with its spin button). */
  readonly clip?: boolean;
}

export interface DetectedControl {
  readonly id: string;
  /** Blob centroid as a 0–1 ratio of the source image. */
  readonly center: { readonly x: number; readonly y: number };
  readonly box: {
    readonly x0: number;
    readonly y0: number;
    readonly x1: number;
    readonly y1: number;
  };
  /** Blob pixels as a fraction of the whole image. */
  readonly areaRatio: number;
  /** Blob pixels / bounding-box pixels. Near 1 is a solid rect, ~0.78 a circle. */
  readonly fill: number;
}

/** Analysis width; the scan is O(pixels) so downsampling keeps it well under a frame. */
const SCAN_WIDTH = 180;
const MIN_BLOB_PIXELS = 12;

function isGreen(r: number, g: number, b: number): boolean {
  return g > 80 && g - r > 30 && g - b > 30;
}

function isRed(r: number, g: number, b: number): boolean {
  return r > 90 && r - g > 45 && r - b > 25;
}

function isAmber(r: number, g: number, b: number): boolean {
  return r > 140 && g > 90 && b < 90 && r - b > 70 && g - b > 30;
}

/** Sugar BUY pill — hot pink, not the darker candy-stripe red behind the HUD. */
function isPink(r: number, g: number, b: number): boolean {
  return r > 200 && g < 120 && b > 50 && b < 160 && r - g > 100;
}

function huePredicate(hue: ControlHue): (r: number, g: number, b: number) => boolean {
  if (hue === 'green') {
    return isGreen;
  }
  if (hue === 'red') {
    return isRed;
  }
  if (hue === 'amber') {
    return isAmber;
  }
  return isPink;
}

/** Fraction (0–1) of the PNG's pixels that fall in `hue`. */
export function hueShareInPng(png: Buffer, hue: ControlHue): number {
  const image = decodePng(png);
  const test = huePredicate(hue);
  let hits = 0;
  for (let offset = 0; offset < image.data.length; offset += 4) {
    if (test(image.data[offset]!, image.data[offset + 1]!, image.data[offset + 2]!)) {
      hits += 1;
    }
  }
  return hits / Math.max(1, image.width * image.height);
}

interface Blob {
  readonly pixels: number;
  readonly sumX: number;
  readonly sumY: number;
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

/** Flood-fill 4-connected regions of the mask. Iterative — canvases can be tall. */
function labelBlobs(mask: Uint8Array, width: number, height: number): Blob[] {
  const seen = new Uint8Array(mask.length);
  const blobs: Blob[] = [];
  const stack: number[] = [];

  for (let start = 0; start < mask.length; start += 1) {
    if (mask[start] === 0 || seen[start] === 1) {
      continue;
    }

    seen[start] = 1;
    stack.push(start);

    let pixels = 0;
    let sumX = 0;
    let sumY = 0;
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;

    while (stack.length > 0) {
      const index = stack.pop()!;
      const x = index % width;
      const y = (index - x) / width;

      pixels += 1;
      sumX += x;
      sumY += y;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);

      if (x > 0) {
        const left = index - 1;
        if (mask[left] === 1 && seen[left] === 0) {
          seen[left] = 1;
          stack.push(left);
        }
      }
      if (x + 1 < width) {
        const right = index + 1;
        if (mask[right] === 1 && seen[right] === 0) {
          seen[right] = 1;
          stack.push(right);
        }
      }
      if (y > 0) {
        const up = index - width;
        if (mask[up] === 1 && seen[up] === 0) {
          seen[up] = 1;
          stack.push(up);
        }
      }
      if (y + 1 < height) {
        const down = index + width;
        if (mask[down] === 1 && seen[down] === 0) {
          seen[down] = 1;
          stack.push(down);
        }
      }
    }

    if (pixels >= MIN_BLOB_PIXELS) {
      blobs.push({ pixels, sumX, sumY, minX, minY, maxX, maxY });
    }
  }

  return blobs;
}

type ScanWindow = ControlSignature['band'];

function scanHue(
  image: RgbaImage,
  hue: ControlHue,
  window?: ScanWindow,
): { blobs: Blob[]; width: number; height: number } {
  const height = Math.max(1, Math.round((image.height / image.width) * SCAN_WIDTH));
  const small = resizeNearest(image, SCAN_WIDTH, height);
  const test = huePredicate(hue);
  const mask = new Uint8Array(SCAN_WIDTH * height);
  const wx0 = (window?.x0 ?? 0) * SCAN_WIDTH;
  const wx1 = (window?.x1 ?? 1) * SCAN_WIDTH;
  const wy0 = (window?.y0 ?? 0) * height;
  const wy1 = (window?.y1 ?? 1) * height;

  for (let i = 0, p = 0; i < small.data.length; i += 4, p += 1) {
    if (small.data[i + 3]! < 40) {
      continue;
    }
    if (window !== undefined) {
      const x = p % SCAN_WIDTH;
      const y = Math.floor(p / SCAN_WIDTH);
      if (x < wx0 || x >= wx1 || y < wy0 || y >= wy1) {
        continue;
      }
    }
    if (test(small.data[i]!, small.data[i + 1]!, small.data[i + 2]!)) {
      mask[p] = 1;
    }
  }

  return { blobs: labelBlobs(mask, SCAN_WIDTH, height), width: SCAN_WIDTH, height };
}

function toDetected(id: string, blob: Blob, width: number, height: number): DetectedControl {
  const boxW = blob.maxX - blob.minX + 1;
  const boxH = blob.maxY - blob.minY + 1;
  return {
    id,
    center: { x: blob.sumX / blob.pixels / width, y: blob.sumY / blob.pixels / height },
    box: {
      x0: blob.minX / width,
      y0: blob.minY / height,
      x1: (blob.maxX + 1) / width,
      y1: (blob.maxY + 1) / height,
    },
    areaRatio: blob.pixels / (width * height),
    fill: blob.pixels / (boxW * boxH),
  };
}

/** Every blob of a hue, largest first — the raw material for locator diagnostics. */
export function scanControls(image: RgbaImage, hue: ControlHue, window?: ScanWindow): DetectedControl[] {
  const { blobs, width, height } = scanHue(image, hue, window);
  return blobs
    .map((blob) => toDetected(hue, blob, width, height))
    .sort((left, right) => right.areaRatio - left.areaRatio);
}

/** Best match for a signature, or undefined when nothing in the band qualifies. */
export function findControl(
  image: RgbaImage,
  signature: ControlSignature,
): DetectedControl | undefined {
  const minArea = signature.minAreaRatio ?? 0.0008;
  const maxArea = signature.maxAreaRatio ?? 0.25;

  const candidates = scanControls(image, signature.hue, signature.clip === true ? signature.band : undefined).filter((control) => {
    if (control.areaRatio < minArea || control.areaRatio > maxArea) {
      return false;
    }
    if (signature.band === undefined) {
      return true;
    }
    if (control.center.y < signature.band.y0 || control.center.y > signature.band.y1) {
      return false;
    }
    if (signature.band.x0 !== undefined && control.center.x < signature.band.x0) {
      return false;
    }
    if (signature.band.x1 !== undefined && control.center.x > signature.band.x1) {
      return false;
    }
    return true;
  });

  const picked = pickCandidate(candidates, signature.pick);
  return picked === undefined ? undefined : { ...picked, id: signature.id };
}

function pickCandidate(
  candidates: DetectedControl[],
  pick: ControlSignature['pick'],
): DetectedControl | undefined {
  if (candidates.length === 0) {
    return undefined;
  }
  if (pick === 'leftmost') {
    return [...candidates].sort((left, right) => left.center.x - right.center.x)[0];
  }
  if (pick === 'rightmost') {
    return [...candidates].sort((left, right) => right.center.x - left.center.x)[0];
  }
  return candidates[0];
}

export function findControlInPng(
  png: Buffer,
  signature: ControlSignature,
): DetectedControl | undefined {
  try {
    return findControl(decodePng(png), signature);
  } catch {
    return undefined;
  }
}

/**
 * The idle HUD spin, retrying clipped to its band when scenery of the same hue has
 * merged into the button. Geometry comes from the surface profile, not from here.
 */
export function findIdleSpinInPng(
  png: Buffer,
  profile: SurfaceProfile = loadSurfaceProfileById('base'),
): DetectedControl | undefined {
  const signature = visionSignature(profile, 'spin');
  if (signature === undefined) {
    return undefined;
  }
  try {
    const image = decodePng(png);
    const strict = findControl(image, signature);
    if (strict !== undefined) {
      return strict;
    }
    const band = signature.band;
    const clip = profile.idleSpinClip;
    if (band?.x0 === undefined || band.x1 === undefined || clip === undefined) {
      return undefined;
    }
    // A solid clipped blob spanning the whole window is a wide pill (Scratch BUY CARD, fill
    // ≈0.85); the spin is a hollow ring with arrows (fill ≈0.6) that can pulse to the edges.
    const edge = 2 / SCAN_WIDTH;
    const clipped = findControl(image, {
      ...signature,
      clip: true,
      maxAreaRatio: clip.maxAreaRatio,
    });
    if (clipped === undefined) {
      return undefined;
    }
    const spansWindow = clipped.box.x0 <= band.x0 + edge && clipped.box.x1 >= band.x1 - edge;
    return spansWindow && clipped.fill >= clip.solidFill ? undefined : clipped;
  } catch {
    return undefined;
  }
}

/** One-line-per-blob dump used by the failure report to suggest manifest ratios. */
export function describeControlScan(png: Buffer, hues: readonly ControlHue[]): string {
  let image: RgbaImage;
  try {
    image = decodePng(png);
  } catch {
    return 'control scan unavailable (image could not be decoded)';
  }

  const lines: string[] = [];
  for (const hue of hues) {
    const found = scanControls(image, hue).slice(0, 6);
    if (found.length === 0) {
      lines.push(`${hue}: none`);
      continue;
    }
    for (const control of found) {
      lines.push(
        `${hue}: center=${control.center.x.toFixed(3)},${control.center.y.toFixed(3)} ` +
          `area=${(control.areaRatio * 100).toFixed(2)}% fill=${control.fill.toFixed(2)}`,
      );
    }
  }
  return lines.join('\n');
}
