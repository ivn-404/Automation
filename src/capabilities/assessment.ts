/**
 * Readiness gate for games learned at run time from a Game URL (`metadata.discovery`).
 *
 * Discovery writes `metadata["assessment.<capability>"] = "<status>|<reason>"` for every
 * capability it could not verify. Such a case is skipped with the reason; it is never a pass
 * and never a silent N/A. Registered manifests carry no assessment keys and are unaffected.
 */

import type { GameManifest } from '../core/models/index.js';
import type { Capability } from './game-capabilities.js';

export const CALIBRATION_PREFIX = 'CALIBRATION REQUIRED';
export const BLOCKED_PREFIX = 'BLOCKED';

export function isDiscoveredManifest(manifest: Pick<GameManifest, 'metadata'>): boolean {
  const mode = manifest.metadata?.discovery;
  return mode === 'runtime' || mode === 'learned';
}

/** Skip reason for the first capability discovery could not verify, or undefined. */
export function assessmentSkipReason(manifest: GameManifest, capabilities: readonly Capability[]): string | undefined {
  if (!isDiscoveredManifest(manifest)) return undefined;
  if (manifest.metadata?.discovery === 'runtime') {
    return `${BLOCKED_PREFIX} — no discovery profile for this game; DISC-001 must run first in a Game URL run`;
  }
  for (const capability of capabilities) {
    const value = manifest.metadata?.[`assessment.${capability}`];
    if (value === undefined) continue;
    const [status, ...rest] = value.split('|');
    const prefix = status === 'blocked' ? BLOCKED_PREFIX : CALIBRATION_PREFIX;
    return `${prefix} — ${capability}: ${rest.join('|')}`;
  }
  return undefined;
}
