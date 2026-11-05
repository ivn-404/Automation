/**
 * Game URL runs: the control panel holds the pasted URL and hands this worker only a
 * reference (SGAP_LAUNCH_URL_REF). The raw URL is fetched over loopback while the run is
 * active and never written to env, logs or reports; use `redactUrl` for anything printed.
 */

import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { test } from '@playwright/test';

import type { GameManifest } from '../../src/core/models/index.js';
import { loadPersistedProfile } from '../../src/discovery/index.js';
import { parseGameManifest } from '../../src/platform/manifest/parse-game-manifest.js';
import type { LaunchDevice } from '../../src/platform/url-platform.js';

let cached: Promise<string> | undefined;

/** QA's device choice for the pasted URL; default keeps the URL's own `device`. */
export function launchDevice(): LaunchDevice {
  const value = process.env.SGAP_LAUNCH_DEVICE;
  return value === 'mobile' || value === 'desktop' || value === 'switch' ? value : 'preserve';
}

/** Discovery output of this run (DISC-001), when there is one. */
export function discoveryDir(): string | undefined {
  const dir = process.env.SGAP_DISCOVERY_DIR;
  return dir && dir.length > 0 ? dir : undefined;
}

/**
 * A runtime-discovery manifest (config/manifests/unregistered.json) is replaced by the learned
 * manifest DISC-001 wrote for this run. Without one it stays a template, whose cases report BLOCKED.
 */
/** Game key from the pasted URL (path segment), when the panel set it. */
export function launchGameKey(): string | undefined {
  const value = process.env.SGAP_LAUNCH_GAME_KEY;
  return value && value.length > 0 ? value : undefined;
}

export async function withLearnedProfile(manifest: GameManifest): Promise<GameManifest> {
  if (manifest.metadata?.discovery !== 'runtime') return manifest;
  const dir = discoveryDir();
  const fromRun = dir === undefined ? undefined : await readFile(path.join(dir, 'learned-manifest.json'), 'utf8').catch(() => undefined);
  if (fromRun !== undefined) return parseGameManifest(JSON.parse(fromRun));
  const key = launchGameKey();
  const persisted = key === undefined ? undefined : loadPersistedProfile(key);
  return persisted === undefined ? manifest : parseGameManifest(persisted);
}

const SKIP_PREFIX = { ready: '', calibration: 'CALIBRATION REQUIRED', unsupported: 'N/A', blocked: 'BLOCKED' } as const;

/**
 * This run's DISC-001 case list is the source of truth. A previous day's learned profile
 * must not make a case execute when discovery just classified it calibration / N/A / blocked.
 */
export function discoveryCaseSkip(caseId: string): string | undefined {
  const dir = discoveryDir();
  if (dir === undefined) return undefined;
  try {
    const cases = JSON.parse(readFileSync(path.join(dir, 'case-assessment.json'), 'utf8')) as Array<{
      caseId: string;
      status: keyof typeof SKIP_PREFIX;
      reason: string;
    }>;
    const row = cases.find((entry) => entry.caseId === caseId);
    if (row === undefined || row.status === 'ready') return undefined;
    const prefix = SKIP_PREFIX[row.status] ?? 'CALIBRATION REQUIRED';
    return `${prefix} — ${row.reason}`;
  } catch {
    return undefined;
  }
}

export function isLaunchUrlRun(): boolean {
  return (process.env.SGAP_LAUNCH_URL_REF ?? '').length > 0;
}

export function fetchLaunchUrl(): Promise<string> {
  cached ??= (async () => {
    const panel = process.env.SGAP_QA_PANEL_URL;
    const ref = process.env.SGAP_LAUNCH_URL_REF;
    if (!panel || !ref) throw new Error('Game URL run without a control panel to fetch the URL from.');
    const response = await fetch(`${panel}/api/qa/launch-url/${encodeURIComponent(ref)}`).catch((error: Error) => {
      throw new Error(`Control panel unreachable for the Game URL: ${error.message}`);
    });
    if (!response.ok) throw new Error(`Game URL no longer available from the control panel (HTTP ${response.status}).`);
    const body = (await response.json()) as { url?: unknown };
    if (typeof body.url !== 'string') throw new Error('Control panel returned no Game URL.');
    return body.url;
  })();
  return cached;
}

/** Launcher chrome (wallet, bet limit, provider grid) does not exist on a pasted Game URL. */
export function skipWithoutLauncher(what: string): void {
  if (isLaunchUrlRun()) {
    test.skip(true, `${what} needs the staging launcher — not applicable to a Game URL run.`);
  }
}
