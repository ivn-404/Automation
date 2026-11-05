/**
 * Frame-pacing maths for PAD runs. Input is a list of frame timestamps (epoch ms) from the
 * in-frame sampler; everything else is derived. Bands are the QA-agreed FPS bands
 * (docs/catalogs/FPS_TestCase.md): ≥ 60 pass, 40–59 passable, 30–39 investigate,
 * 24–29 needs optimization, < 24 priority.
 */

export type FpsBand = 'pass' | 'passable' | 'investigate' | 'optimize' | 'priority';

export interface FpsBandInfo {
  readonly band: FpsBand;
  readonly label: string;
  readonly verdict: 'pass' | 'warn' | 'fail';
  readonly color: string;
}

const BANDS: readonly (FpsBandInfo & { readonly min: number })[] = [
  { min: 60, band: 'pass', label: 'Pass', verdict: 'pass', color: '#16a34a' },
  { min: 40, band: 'passable', label: 'Passable', verdict: 'pass', color: '#65a30d' },
  { min: 30, band: 'investigate', label: 'Investigate', verdict: 'warn', color: '#ca8a04' },
  { min: 24, band: 'optimize', label: 'Needs optimization', verdict: 'fail', color: '#ea580c' },
  { min: Number.NEGATIVE_INFINITY, band: 'priority', label: 'Priority', verdict: 'fail', color: '#dc2626' },
];

/** On a 60 Hz panel a steady 59.x is a full-rate game; round so vsync jitter is not "below 60". */
const RATE_TOLERANCE = 0.5;

export function fpsBand(fps: number): FpsBandInfo {
  const value = Number.isFinite(fps) ? fps + RATE_TOLERANCE : Number.NEGATIVE_INFINITY;
  const { min: _min, ...info } = BANDS.find((entry) => value >= entry.min)!;
  return info;
}

export interface FrameStats {
  readonly frames: number;
  readonly durationMs: number;
  readonly avgFps: number;
  /** 1000 ÷ mean of the slowest 1% frame times (at least one frame). */
  readonly low1Fps: number;
  readonly p50Ms: number;
  readonly p95Ms: number;
  readonly p99Ms: number;
  readonly maxMs: number;
  /** Frames longer than two 60 Hz budgets (33.3 ms). */
  readonly longFrames: number;
  /** Frames longer than 100 ms. */
  readonly hitches: number;
}

export const LONG_FRAME_MS = 1000 / 30;
export const HITCH_MS = 100;

/** A time range (epoch ms) whose frames do not count: SGAP's own screenshots, a hidden tab. */
export interface ExcludedSpan {
  readonly from: number;
  readonly to: number;
  readonly reason: string;
}

function overlaps(start: number, end: number, spans: readonly ExcludedSpan[]): boolean {
  return spans.some((span) => start < span.to && end > span.from);
}

export function frameIntervals(
  timestamps: readonly number[],
  excluded: readonly ExcludedSpan[] = [],
): number[] {
  const out: number[] = [];
  for (let i = 1; i < timestamps.length; i += 1) {
    const start = timestamps[i - 1]!;
    const end = timestamps[i]!;
    if (excluded.length === 0 || !overlaps(start, end, excluded)) {
      out.push(end - start);
    }
  }
  return out;
}

function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) {
    return Number.NaN;
  }
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index]!;
}

export function frameStats(
  timestamps: readonly number[],
  excluded: readonly ExcludedSpan[] = [],
): FrameStats {
  const intervals = frameIntervals(timestamps, excluded);
  const durationMs = intervals.reduce((sum, value) => sum + value, 0);
  const sorted = [...intervals].sort((a, b) => a - b);
  const slowestCount = Math.max(1, Math.floor(sorted.length / 100));
  const slowest = sorted.slice(sorted.length - slowestCount);
  const slowestMean = slowest.reduce((sum, value) => sum + value, 0) / Math.max(1, slowest.length);
  return {
    frames: intervals.length,
    durationMs,
    avgFps: durationMs > 0 ? (intervals.length * 1000) / durationMs : Number.NaN,
    low1Fps: slowestMean > 0 ? 1000 / slowestMean : Number.NaN,
    p50Ms: percentile(sorted, 50),
    p95Ms: percentile(sorted, 95),
    p99Ms: percentile(sorted, 99),
    maxMs: sorted.length > 0 ? sorted[sorted.length - 1]! : Number.NaN,
    longFrames: intervals.filter((value) => value > LONG_FRAME_MS).length,
    hitches: intervals.filter((value) => value > HITCH_MS).length,
  };
}

/** Each frame interval longer than `minMs`, as [start, end] epoch ms. */
export function slowFrames(
  timestamps: readonly number[],
  minMs = HITCH_MS,
  excluded: readonly ExcludedSpan[] = [],
): { readonly at: number; readonly ms: number }[] {
  const out: { at: number; ms: number }[] = [];
  for (let i = 1; i < timestamps.length; i += 1) {
    const ms = timestamps[i]! - timestamps[i - 1]!;
    if (ms > minMs && !overlaps(timestamps[i - 1]!, timestamps[i]!, excluded)) {
      out.push({ at: timestamps[i - 1]!, ms });
    }
  }
  return out;
}

export function round1(value: number): number {
  return Number.isFinite(value) ? Math.round(value * 10) / 10 : value;
}
