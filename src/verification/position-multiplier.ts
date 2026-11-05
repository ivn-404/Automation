/**
 * Position-background multipliers.
 *
 * Some titles (Package 5) do not drop a multiplier symbol. A winning cluster
 * marks each of its cells. The next time that same cell is in a winning cluster,
 * the mark doubles. The cluster's paid multiplier is the sum of the cells that
 * are already above 1 before this win is applied; a cluster of unmarked cells
 * pays 1×.
 *
 * Observed on Titanic Transport /bet tumbles (2026-10-15): 0→1, then 1→2, then
 * 2→4, and paid totals 2, 4, 6, 8, 10 and 16 matching that sum. A step that
 * does not match is a failure — the next double is not assumed past the evidence
 * in the response being checked.
 */

import { getByPath } from '../shared/json-path.js';

export interface PositionClusterWin {
  readonly positions: readonly (readonly [number, number])[];
  readonly applied: number;
}

export interface PositionMultiplierStep {
  readonly ok: boolean;
  readonly applied: number;
  readonly expected: number;
  /** Cell values already above 1 that this cluster paid. */
  readonly contributors: readonly number[];
}

function positionKey(position: readonly [number, number]): string {
  return `${position[0]},${position[1]}`;
}

/** Winning clusters in tumble order. `tumblesPath` is the array (`slot.tumbles`). */
export function readTumbleClusterWins(body: unknown, tumblesPath: string): PositionClusterWin[] {
  const tumbles = getByPath(body, tumblesPath);
  if (!Array.isArray(tumbles)) {
    return [];
  }
  const wins: PositionClusterWin[] = [];
  for (const tumble of tumbles) {
    const outs = getByPath(tumble, 'symbols.out');
    if (!Array.isArray(outs)) {
      continue;
    }
    for (const entry of outs) {
      if (entry === null || typeof entry !== 'object') {
        continue;
      }
      const record = entry as { positions?: unknown; win?: { multiplier?: unknown } };
      const positions: [number, number][] = [];
      if (Array.isArray(record.positions)) {
        for (const position of record.positions) {
          if (!Array.isArray(position) || position.length < 2) {
            continue;
          }
          const x = Number(position[0]);
          const y = Number(position[1]);
          if (Number.isInteger(x) && Number.isInteger(y)) {
            positions.push([x, y]);
          }
        }
      }
      wins.push({ positions, applied: Number(record.win?.multiplier) });
    }
  }
  return wins;
}

/**
 * Replay cluster wins in order. Each cell starts unmarked (0). After a win it
 * becomes 1, and after each later win on that cell it doubles. The paid
 * multiplier is checked against the cells' values before that update.
 */
export function checkPositionMultiplierProgress(
  wins: readonly PositionClusterWin[],
): readonly PositionMultiplierStep[] {
  const level = new Map<string, number>();
  const steps: PositionMultiplierStep[] = [];
  for (const win of wins) {
    const contributors = win.positions
      .map((position) => level.get(positionKey(position)) ?? 0)
      .filter((value) => value > 1);
    const expected = contributors.length > 0 ? contributors.reduce((sum, value) => sum + value, 0) : 1;
    steps.push({
      ok: Number.isFinite(win.applied) && win.applied === expected,
      applied: win.applied,
      expected,
      contributors,
    });
    for (const position of win.positions) {
      const key = positionKey(position);
      const current = level.get(key) ?? 0;
      level.set(key, current === 0 ? 1 : current * 2);
    }
  }
  return steps;
}
