/** Sugar Wonderland / DiJoker package default ladder (staging initialize fallback). */
export const DEFAULT_BET_LEVELS = [
  0.2, 0.4, 0.6, 0.8, 1, 1.2, 1.6, 2, 2.4, 2.8, 3.2, 3.6, 4, 5, 6, 8, 10, 14, 18, 24, 32, 40, 58.4,
] as const;

export function parseBetLevels(raw: string | undefined): readonly number[] {
  if (raw === undefined || raw.trim().length === 0) {
    return DEFAULT_BET_LEVELS;
  }
  const levels = raw
    .split(',')
    .map((part) => Number(part.trim()))
    .filter((entry) => Number.isFinite(entry) && entry > 0);
  if (levels.length < 2) {
    return DEFAULT_BET_LEVELS;
  }
  return levels.sort((a, b) => a - b);
}

export function nearestBetLevelIndex(levels: readonly number[], stake: number): number {
  let best = 0;
  let bestDelta = Number.POSITIVE_INFINITY;
  for (let i = 0; i < levels.length; i += 1) {
    const delta = Math.abs(levels[i]! - stake);
    if (delta < bestDelta) {
      best = i;
      bestDelta = delta;
    }
  }
  return best;
}

export function stepBetLevel(
  levels: readonly number[],
  currentStake: number,
  direction: 'plus' | 'minus',
): number {
  const index = nearestBetLevelIndex(levels, currentStake);
  const nextIndex =
    direction === 'plus' ? Math.min(index + 1, levels.length - 1) : Math.max(index - 1, 0);
  return levels[nextIndex]!;
}
