/**
 * Read-only eligibility of a case against a loaded manifest.
 *
 * Same order as tests/fixtures/sgap.fixture.ts `_sgapBaseline` and
 * tests/support/capabilities.ts: assessment skip, then declared-absent (N/A),
 * then undeclared (NOT CONFIGURED). Does not decide what the scheduler queues.
 */

import type { GameManifest } from '../core/models/index.js';
import { BLOCKED_PREFIX, CALIBRATION_PREFIX, assessmentSkipReason } from './assessment.js';
import {
  type Capability,
  unmappedCapabilities,
  unsupportedCapabilities,
} from './game-capabilities.js';

export type EligibilityStatus =
  | 'eligible'
  | 'unsupported'
  | 'unmapped'
  | 'blocked'
  | 'calibration';

export interface EligibilityRow {
  readonly packageId: string;
  readonly gameId: string;
  readonly gameName: string;
  readonly family: string;
  readonly caseId: string;
  readonly requires: readonly string[];
  readonly status: EligibilityStatus;
  readonly missing: readonly string[];
  readonly reason: string;
}

export function classifyRequirements(
  manifest: GameManifest,
  capabilities: readonly Capability[],
): {
  readonly status: EligibilityStatus;
  readonly missing: readonly Capability[];
  readonly reason: string;
} {
  const requires = [...capabilities];
  const notReady = assessmentSkipReason(manifest, requires);
  if (notReady !== undefined) {
    const status: EligibilityStatus = notReady.startsWith(BLOCKED_PREFIX)
      ? 'blocked'
      : 'calibration';
    return { status, missing: [], reason: notReady };
  }

  const unsupported = unsupportedCapabilities(manifest, requires);
  if (unsupported.length > 0) {
    return {
      status: 'unsupported',
      missing: unsupported,
      reason: `N/A — ${manifest.displayName} does not support ${unsupported.join(', ')}`,
    };
  }

  const unmapped = unmappedCapabilities(manifest, requires);
  if (unmapped.length > 0) {
    return {
      status: 'unmapped',
      missing: unmapped,
      reason: `${manifest.displayName} does not declare ${unmapped.join(', ')}`,
    };
  }

  return {
    status: 'eligible',
    missing: [],
    reason: requires.length > 0 ? `needs ${requires.join(', ')}` : 'needs no game capability',
  };
}

const STATUS_LABEL: Record<EligibilityStatus, string> = {
  eligible: 'eligible',
  unsupported: 'N/A',
  unmapped: 'NOT CONFIGURED',
  blocked: 'blocked',
  calibration: 'calibration',
};

export function formatEligibilitySummary(rows: readonly EligibilityRow[]): string {
  const count = (status: EligibilityStatus): number =>
    rows.filter((row) => row.status === status).length;
  const lines = [
    'SGAP eligibility (read-only — does not change what will run)',
    '────────────────────────────────────────',
    `  eligible        : ${count('eligible')}`,
    `  N/A             : ${count('unsupported')}`,
    `  NOT CONFIGURED  : ${count('unmapped')}`,
    `  blocked         : ${count('blocked')}`,
    `  calibration     : ${count('calibration')}`,
    '────────────────────────────────────────',
    '  pkg  game                 family  case       requires                         missing            status',
  ];
  for (const row of rows) {
    const requires = row.requires.join(',') || '—';
    const missing = row.missing.join(',') || '—';
    lines.push(
      `  ${row.packageId.padEnd(4)} ${row.gameId.padEnd(20)} ${row.family.padEnd(6)} ${row.caseId.padEnd(10)} ${requires.padEnd(32)} ${missing.padEnd(18)} ${STATUS_LABEL[row.status]}`,
    );
  }
  return lines.join('\n');
}
