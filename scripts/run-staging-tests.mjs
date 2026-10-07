/**
 * Staging sweep: non-BF first, BF last (shared DiJoker player pollution).
 * Prints detailed terminal summary after each wave.
 */
import { spawnSync } from 'node:child_process';
import { publishAllureReport } from './generate-allure-report.mjs';
import {
  printSimulationFooter,
  printSimulationHeader,
  runPlaywrightWave,
} from './lib/simulation-terminal-report.mjs';

const launcherMode = process.env.SGAP_LAUNCHER_MODE ?? 'staging';
const env = { ...process.env, SGAP_LAUNCHER_MODE: launcherMode, SGAP_CLICK_TRACKER: process.env.SGAP_CLICK_TRACKER ?? '1' };

const common = [
  'playwright',
  'test',
  '--project=chromium',
  '--headed',
  '--workers=1',
];

const simulationStartedAt = Date.now();
const waveResults = [];

printSimulationHeader({
  title: 'Sugar Wonderland — staging sweep (all specs matching grep)',
  games: ['Sugar Wonderland'],
  workers: 1,
  headed: true,
  launcherMode,
  gameId: process.env.SGAP_GAME_ID ?? 'sugar-wonderland',
  waves: ['non-BF grep', 'BF grep'],
});

function wave(name, extraArgs, detail, index, total) {
  const { exitCode, stats } = runPlaywrightWave({
    spawnSync,
    npxArgs: [...common, ...extraArgs],
    env,
    waveName: name,
    waveDetail: detail,
    waveIndex: index,
    waveTotal: total,
  });
  waveResults.push({ name, exitCode, stats });
  return exitCode;
}

wave('Non-BF grep', ['--grep-invert', 'BF-'], 'all specs except BF-*', 1, 2);
wave('BF grep', ['--grep', 'BF-'], 'BF-* specs only', 2, 2);

const exitCode = printSimulationFooter({ waveResults, startedAt: simulationStartedAt });
await publishAllureReport();
process.exit(exitCode);
