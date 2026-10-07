/**
 * Lightweight PNG decode/resize/compare for canvas symbol matching.
 */

import { PNG } from 'pngjs';

export interface RgbaImage {
  readonly width: number;
  readonly height: number;
  /** RGBA bytes */
  readonly data: Buffer;
}

export function decodePng(buffer: Buffer): RgbaImage {
  const png = PNG.sync.read(buffer);
  return { width: png.width, height: png.height, data: png.data as Buffer };
}

export function encodePng(image: RgbaImage): Buffer {
  const png = new PNG({ width: image.width, height: image.height });
  image.data.copy(png.data);
  return PNG.sync.write(png);
}

export function cropImage(
  image: RgbaImage,
  x: number,
  y: number,
  width: number,
  height: number,
): RgbaImage {
  const x0 = Math.max(0, Math.floor(x));
  const y0 = Math.max(0, Math.floor(y));
  const w = Math.max(1, Math.min(image.width - x0, Math.floor(width)));
  const h = Math.max(1, Math.min(image.height - y0, Math.floor(height)));
  const data = Buffer.alloc(w * h * 4);

  for (let row = 0; row < h; row += 1) {
    for (let col = 0; col < w; col += 1) {
      const src = ((y0 + row) * image.width + (x0 + col)) * 4;
      const dst = (row * w + col) * 4;
      data[dst] = image.data[src]!;
      data[dst + 1] = image.data[src + 1]!;
      data[dst + 2] = image.data[src + 2]!;
      data[dst + 3] = image.data[src + 3]!;
    }
  }

  return { width: w, height: h, data };
}

/** Nearest-neighbor resize to fixed size for comparison. */
export function resizeNearest(image: RgbaImage, width: number, height: number): RgbaImage {
  const data = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const sy = Math.min(image.height - 1, Math.floor((y / height) * image.height));
    for (let x = 0; x < width; x += 1) {
      const sx = Math.min(image.width - 1, Math.floor((x / width) * image.width));
      const src = (sy * image.width + sx) * 4;
      const dst = (y * width + x) * 4;
      data[dst] = image.data[src]!;
      data[dst + 1] = image.data[src + 1]!;
      data[dst + 2] = image.data[src + 2]!;
      data[dst + 3] = image.data[src + 3]!;
    }
  }
  return { width, height, data };
}

const COMPARE_SIZE = 24;
const HIST_BINS = 8;

function hueHistogram(image: RgbaImage): Float64Array {
  const hist = new Float64Array(HIST_BINS * 3);
  let count = 0;
  for (let i = 0; i < image.data.length; i += 4) {
    const a = image.data[i + 3]!;
    if (a < 40) {
      continue;
    }
    const r = image.data[i]! / 255;
    const g = image.data[i + 1]! / 255;
    const b = image.data[i + 2]! / 255;
    // skip near-black / near-white UI chrome
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    if (max < 0.12 || min > 0.92) {
      continue;
    }
    hist[Math.min(HIST_BINS - 1, Math.floor(r * HIST_BINS))]! += 1;
    hist[HIST_BINS + Math.min(HIST_BINS - 1, Math.floor(g * HIST_BINS))]! += 1;
    hist[HIST_BINS * 2 + Math.min(HIST_BINS - 1, Math.floor(b * HIST_BINS))]! += 1;
    count += 1;
  }
  if (count > 0) {
    for (let i = 0; i < hist.length; i += 1) {
      hist[i]! /= count;
    }
  }
  return hist;
}

function meanAbsError(a: RgbaImage, b: RgbaImage): number {
  let sum = 0;
  let count = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    const aa = a.data[i + 3]!;
    const ba = b.data[i + 3]!;
    if (aa < 30 && ba < 30) {
      continue;
    }
    sum +=
      Math.abs(a.data[i]! - b.data[i]!) +
      Math.abs(a.data[i + 1]! - b.data[i + 1]!) +
      Math.abs(a.data[i + 2]! - b.data[i + 2]!);
    count += 1;
  }
  if (count === 0) {
    return 1;
  }
  return sum / (count * 255 * 3);
}

function histCorrelation(a: Float64Array, b: Float64Array): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  if (na === 0 || nb === 0) {
    return 0;
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export interface MatchScore {
  readonly score: number;
  readonly mae: number;
  readonly hist: number;
}

/** Higher score = better match (0–1). */
export function compareImages(candidate: RgbaImage, template: RgbaImage): MatchScore {
  const a = resizeNearest(candidate, COMPARE_SIZE, COMPARE_SIZE);
  const b = resizeNearest(template, COMPARE_SIZE, COMPARE_SIZE);
  const mae = meanAbsError(a, b);
  const hist = histCorrelation(hueHistogram(a), hueHistogram(b));
  const maeScore = Math.max(0, 1 - mae * 1.6);
  const score = maeScore * 0.45 + hist * 0.55;
  return { score, mae, hist };
}

export function bestTemplateMatch(
  candidate: RgbaImage,
  templates: ReadonlyArray<{ id: number; image: RgbaImage }>,
): { id: number; score: number } | undefined {
  const bestById = new Map<number, number>();
  for (const template of templates) {
    const { score } = compareImages(candidate, template.image);
    const prev = bestById.get(template.id);
    if (prev === undefined || score > prev) {
      bestById.set(template.id, score);
    }
  }
  let best: { id: number; score: number } | undefined;
  for (const [id, score] of bestById) {
    if (best === undefined || score > best.score) {
      best = { id, score };
    }
  }
  return best;
}
