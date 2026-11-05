/**
 * Per-reel multipliers (Package 7).
 *
 * Each reel carries a multiplier under it. Wilds raise it (Wild +1, Double Wild +2,
 * Random Wild +1 on random reels); the payload lists it per tumble at
 * `symbols.out.multipliers`, one value per reel, 0 = not raised yet (shown as 1×).
 * A ways win across the first N reels pays `pay × ways × M`, where M is the sum of
 * the raised multipliers on those N reels, or 1 when none is raised. QA example:
 * MULTIPLIERS 5 | 4 | 1 | 1 → 5 + 4 = 9.
 *
 * Observed on Oppals /bet (2026-10-27): reels 0,2,0,0,0 paid a 4-reel win 2×, reels
 * 0,2,2,3,0 paid a 3-reel win 4× (the 3 on reel 4 not counted), and every win equalled
 * pay × ways × multiplier.
 */

import { getByPath } from '../shared/json-path.js';

export interface ReelMultiplierWin {
  readonly tumble: number;
  readonly symbol: number;
  readonly columns: number;
  readonly ways: number;
  readonly pay: number;
  readonly win: number;
  readonly applied: number;
  /** Reel multipliers in force for this tumble (0 = not raised). */
  readonly reels: readonly number[];
}

export interface ReelMultiplierStep extends ReelMultiplierWin {
  readonly ok: boolean;
  readonly expected: number;
  /** Raised multipliers on the winning reels that were summed. */
  readonly contributors: readonly number[];
  readonly expectedWin: number;
}

/** Ways wins in tumble order. `tumblesPath` is the tumble array (`slot.tumbles`). */
export function readReelMultiplierWins(body: unknown, tumblesPath: string): ReelMultiplierWin[] {
  const tumbles = getByPath(body, tumblesPath);
  if (!Array.isArray(tumbles)) {
    return [];
  }
  const wins: ReelMultiplierWin[] = [];
  tumbles.forEach((tumble, index) => {
    const out = getByPath(tumble, 'symbols.out') as { multipliers?: unknown; symbols?: unknown } | undefined;
    if (out === undefined || out === null || !Array.isArray(out.symbols)) {
      return;
    }
    const reels = Array.isArray(out.multipliers) ? out.multipliers.map(Number) : [];
    for (const entry of out.symbols) {
      if (entry === null || typeof entry !== 'object') {
        continue;
      }
      const record = entry as Record<string, unknown>;
      wins.push({
        tumble: index + 1,
        symbol: Number(record.symbol),
        columns: Number(record.columns),
        ways: Number(record.ways ?? 1),
        pay: Number(record.pay),
        win: Number(record.win),
        applied: Number(record.multiplier),
        reels,
      });
    }
  });
  return wins;
}

/** Check each win's multiplier against the sum of raised multipliers on its reels. */
export function checkReelMultiplierWins(wins: readonly ReelMultiplierWin[]): readonly ReelMultiplierStep[] {
  return wins.map((win) => {
    const contributors = win.reels.slice(0, win.columns).filter((value) => value > 0);
    const expected = contributors.length > 0 ? contributors.reduce((sum, value) => sum + value, 0) : 1;
    const expectedWin = Math.round(win.pay * win.ways * expected * 100) / 100;
    return {
      ...win,
      ok:
        Number.isFinite(win.applied) &&
        win.applied === expected &&
        Number.isFinite(win.win) &&
        Math.abs(win.win - expectedWin) <= 0.011,
      expected,
      contributors,
      expectedWin,
    };
  });
}
