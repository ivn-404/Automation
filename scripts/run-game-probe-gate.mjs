/**
 * Universal per-game probe gate (future titles use this first).
 *
 * 1) PROBE-002 — can we enter the iframe? DOM / Phaser / canvas surface?
 * 2) PROBE-001 — spin / bet+ / turbo vs amplify /bet contracts
 *
 * Usage:
 *   SGAP_GAME_ID=sugar-wonderland node scripts/run-game-probe-gate.mjs
 *   SGAP_GAME_ID=beelze-bop node scripts/run-game-probe-gate.mjs
 *
 * Stop the catalog if either probe is not first-attempt green.
 */
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const gameId = process.env.SGAP_GAME_ID ?? 'sugar-wonderland';
const launcherMode = process.env.SGAP_LAUNCHER_MODE ?? 'staging';

const env = {
  ...process.env,
  SGAP_LAUNCHER_MODE: launcherMode,
  SGAP_GAME_ID: gameId,
  SGAP_CLICK_TRACKER: process.env.SGAP_CLICK_TRACKER ?? '1',
  SGAP_WORKER_MONITOR: process.env.SGAP_WORKER_MONITOR ?? '0',
};

if (!env.PLAYWRIGHT_BROWSERS_PATH && process.platform === 'win32' && process.env.LOCALAPPDATA) {
  env.PLAYWRIGHT_BROWSERS_PATH = path.join(process.env.LOCALAPPDATA, 'ms-playwright');
}

const cli = require.resolve('@playwright/test/cli');

function runProbe(spec) {
  console.log(`\n=== ${gameId} → ${spec} ===\n`);
  const result = spawnSync(
    process.execPath,
    [
      cli,
      'test',
      spec,
      '--project=chromium',
      '--headed',
      '--workers=1',
      '--retries=0',
    ],
    { cwd: root, env, stdio: 'inherit' },
  );
  return result.status ?? 1;
}

const probes = [
  'tests/specs/probe/PROBE-002.spec.ts',
  'tests/specs/probe/PROBE-001.spec.ts',
];

let exitCode = 0;
for (const spec of probes) {
  const code = runProbe(spec);
  if (code !== 0) {
    exitCode = code;
    console.error(`\nProbe gate failed on ${spec} (exit ${code}). Do not run the catalog yet.\n`);
    break;
  }
}

if (exitCode === 0) {
  console.log(`\nProbe gate green for ${gameId}. Catalog may proceed (1 worker first).\n`);
}

process.exit(exitCode);
