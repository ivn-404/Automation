/**
 * Sugar Wonderland wave 0 — automated regression gate (includes CSF-006 reel validation).
 *
 * Order matters on shared DiJoker player:
 *   CSF (incl. CSF-006) → BC → TM → MN → AP (autoplay last) → BF (buy last)
 *
 * Playwright alphabetical collection would run AP before BC otherwise.
 */
import { spawnSync } from 'node:child_process';
import {
  printSimulationFooter,
  printSimulationHeader,
  runPlaywrightWave,
} from './lib/simulation-terminal-report.mjs';

const launcherMode = process.env.SGAP_LAUNCHER_MODE ?? 'staging';
const env = {
  ...process.env,
  SGAP_LAUNCHER_MODE: launcherMode,
  SGAP_GAME_ID: 'sugar-wonderland',
  SGAP_CLICK_TRACKER: process.env.SGAP_CLICK_TRACKER ?? '1',
};

const common = [
  'playwright',
  'test',
  '--project=chromium',
  '--workers=1',
  ...(launcherMode === 'staging' ? ['--headed'] : []),
];

const NON_BF_CATEGORIES = [
  { id: 'CSF', dir: 'tests/specs/csf', detail: 'Core spin flow (CSF-001…008 incl. reel match)' },
  { id: 'BC', dir: 'tests/specs/bc', detail: 'Bet control' },
  { id: 'TM', dir: 'tests/specs/tm', detail: 'Turbo mode' },
  { id: 'MN', dir: 'tests/specs/mn', detail: 'Menu' },
  { id: 'UIDS', dir: 'tests/specs/uids', detail: 'UI & Display Sync' },
  { id: 'SM', dir: 'tests/specs/sm', detail: 'State Management' },
  { id: 'CP', dir: 'tests/specs/cp', detail: 'Currency Precision' },
  { id: 'ES', dir: 'tests/specs/es', detail: 'Edge & Stability' },
  { id: 'AP', dir: 'tests/specs/ap', detail: 'Autoplay (last — avoids polluting BC/TM)' },
];

const simulationStartedAt = Date.now();
const waveResults = [];

printSimulationHeader({
  title: 'Sugar Wonderland — wave 0 gate (48 specs)',
  games: ['Sugar Wonderland'],
  workers: 1,
  headed: launcherMode === 'staging',
  launcherMode,
  gameId: 'sugar-wonderland',
  waves: [
    ...NON_BF_CATEGORIES.map((c) => `${c.id} (${c.dir})`),
    'BF (tests/specs/bf — last)',
  ],
});

let nonBfExit = 0;
const nonBfStats = { passed: 0, failed: 0, skipped: 0, total: 0 };

for (let i = 0; i < NON_BF_CATEGORIES.length; i += 1) {
  const category = NON_BF_CATEGORIES[i];
  const { exitCode, stats } = runPlaywrightWave({
    spawnSync,
    npxArgs: [...common, category.dir],
    env,
    waveName: `${category.id} — ${category.detail}`,
    waveDetail: category.dir,
    waveIndex: i + 1,
    waveTotal: NON_BF_CATEGORIES.length + 1,
  });
  nonBfExit |= exitCode;
  nonBfStats.passed += stats.passed;
  nonBfStats.failed += stats.failed;
  nonBfStats.skipped += stats.skipped;
  nonBfStats.total += stats.total;
}

waveResults.push({ name: 'non-BF (ordered)', exitCode: nonBfExit, stats: nonBfStats });

const { exitCode: bfExit, stats: bfStats } = runPlaywrightWave({
  spawnSync,
  npxArgs: [...common, '--grep', 'BF-', 'tests/specs/bf'],
  env,
  waveName: 'Buy Feature (BF last)',
  waveDetail: 'BF-001 … BF-010',
  waveIndex: NON_BF_CATEGORIES.length + 1,
  waveTotal: NON_BF_CATEGORIES.length + 1,
});
waveResults.push({ name: 'BF', exitCode: bfExit, stats: bfStats });

process.exit(printSimulationFooter({ waveResults, startedAt: simulationStartedAt }));
