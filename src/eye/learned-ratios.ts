/**
 * Per-worker remembered canvas ratios from a vision / Phaser locate.
 * Workers must not share this map — windows and HUD drift differ.
 */

const TTL_MS = 5 * 60 * 1000;

/** Which resolver produced a remembered point — reported with the click that uses it. */
export type HealSource = 'phaser' | 'vision' | 'manifest';

export interface HealedPoint {
  readonly x: number;
  readonly y: number;
  readonly source: HealSource;
}

interface LearnedRatio extends HealedPoint {
  readonly at: number;
}

const learned = new Map<string, LearnedRatio>();

function key(gameId: string, action: string): string {
  return `${gameId}:${action}`;
}

export function rememberHealedRatio(
  gameId: string,
  action: string,
  point: { readonly x: number; readonly y: number },
  source: HealSource = 'vision',
): void {
  learned.set(key(gameId, action), { x: point.x, y: point.y, source, at: Date.now() });
}

export function forgetHealedRatio(gameId: string, action: string): void {
  learned.delete(key(gameId, action));
}

export function recallHealedRatio(gameId: string, action: string): HealedPoint | undefined {
  const hit = learned.get(key(gameId, action));
  if (hit === undefined) {
    return undefined;
  }
  if (Date.now() - hit.at > TTL_MS) {
    learned.delete(key(gameId, action));
    return undefined;
  }
  return { x: hit.x, y: hit.y, source: hit.source };
}

/** Read and drop a healed ratio so the next click falls back to the manifest. */
export function consumeHealedRatio(gameId: string, action: string): HealedPoint | undefined {
  const hit = recallHealedRatio(gameId, action);
  forgetHealedRatio(gameId, action);
  return hit;
}
