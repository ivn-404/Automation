import { randomBytes } from 'node:crypto';

/**
 * Build a DiJoker launcher username that is easy to attribute to a game.
 *
 * Convention: `{Exact Game Name}_{random}`
 * Example: `Sugar Wonderland_a3f9c2`
 *
 * Prefer the exact launcher / manifest display name (not slug or brand id).
 */
export function buildLauncherPlayerId(gameName: string): string {
  const trimmed = gameName.trim();
  if (trimmed.length === 0) {
    throw new Error('buildLauncherPlayerId requires a non-empty game name');
  }
  const suffix = randomBytes(3).toString('hex');
  return `${trimmed}_${suffix}`;
}
