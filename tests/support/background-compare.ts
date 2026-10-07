/**
 * Colour-consistency comparison for two canvas screenshots.
 *
 * Used by SCG-024 to check that the scratch-card screen and the Buy Feature screen
 * of the same title share a backdrop theme. Both screens overlay a different panel
 * on top, so the comparison samples only the outer frame band (edges of the canvas),
 * which is the themed backdrop in both states, and ignores the centre panels.
 */

import { decodePng } from '../../src/verification/reel/image-match.js';

/** Coarse RGB histogram: 4 bins per channel → 64 buckets. */
const BINS_PER_CHANNEL = 4;
const BUCKETS = BINS_PER_CHANNEL ** 3;
/** Edge band sampled as the backdrop: outer 12% top/bottom and 10% left/right. */
const FRAME_Y = 0.12;
const FRAME_X = 0.1;

export interface BackgroundProfile {
  /** Normalised 64-bucket colour histogram of the frame band. */
  readonly histogram: readonly number[];
  /** Mean colour of the frame band. */
  readonly average: { readonly r: number; readonly g: number; readonly b: number };
  /** Opaque pixels sampled in the frame band. */
  readonly samples: number;
}

function bucketOf(r: number, g: number, b: number): number {
  const shift = 8 - Math.log2(BINS_PER_CHANNEL);
  const ri = r >> shift;
  const gi = g >> shift;
  const bi = b >> shift;
  return (ri * BINS_PER_CHANNEL + gi) * BINS_PER_CHANNEL + bi;
}

function inFrameBand(xRatio: number, yRatio: number): boolean {
  return xRatio < FRAME_X || xRatio > 1 - FRAME_X || yRatio < FRAME_Y || yRatio > 1 - FRAME_Y;
}

/** Builds the backdrop colour profile from the outer frame band of a PNG. */
export function backgroundProfile(png: Buffer): BackgroundProfile {
  const image = decodePng(png);
  const histogram = new Array<number>(BUCKETS).fill(0);
  let samples = 0;
  let sumR = 0;
  let sumG = 0;
  let sumB = 0;
  for (let y = 0; y < image.height; y += 1) {
    const yRatio = y / image.height;
    for (let x = 0; x < image.width; x += 1) {
      const xRatio = x / image.width;
      if (!inFrameBand(xRatio, yRatio)) {
        continue;
      }
      const offset = (y * image.width + x) * 4;
      if (image.data[offset + 3]! < 40) {
        continue;
      }
      const r = image.data[offset]!;
      const g = image.data[offset + 1]!;
      const b = image.data[offset + 2]!;
      histogram[bucketOf(r, g, b)] += 1;
      sumR += r;
      sumG += g;
      sumB += b;
      samples += 1;
    }
  }
  const divisor = Math.max(1, samples);
  return {
    histogram: histogram.map((count) => count / divisor),
    average: {
      r: Math.round(sumR / divisor),
      g: Math.round(sumG / divisor),
      b: Math.round(sumB / divisor),
    },
    samples,
  };
}

/** Histogram intersection of two profiles, 0 (no overlap) → 1 (identical). */
export function backgroundSimilarity(a: BackgroundProfile, b: BackgroundProfile): number {
  let overlap = 0;
  for (let i = 0; i < BUCKETS; i += 1) {
    overlap += Math.min(a.histogram[i]!, b.histogram[i]!);
  }
  return Math.round(overlap * 1000) / 1000;
}

/** Euclidean distance between the two mean colours (0 → identical, 441 → black vs white). */
export function averageColourDistance(a: BackgroundProfile, b: BackgroundProfile): number {
  const dr = a.average.r - b.average.r;
  const dg = a.average.g - b.average.g;
  const db = a.average.b - b.average.b;
  return Math.round(Math.sqrt(dr * dr + dg * dg + db * db));
}
