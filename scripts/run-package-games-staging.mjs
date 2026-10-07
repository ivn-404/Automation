/**
 * Run automated regression specs across the shared DiJoker package (4 games).
 *
 * Waves (BF last — shared DiJoker pollution):
 *   1) non-BF: csf, bc, ap, tm, mn
 *   2) BF: bf
 *
 * Each game project uses launcher player `{Exact Game Name}_{random}`.
 *
 * Env:
 *   SGAP_WORKERS   default 1 (set 4 to experiment with parallel games)
 *   SGAP_HEADED    default on (set 0 for headless)
 *
 * Example:
 *   SGAP_LAUNCHER_MODE=staging node scripts/run-package-games-staging.mjs
 *   SGAP_WORKERS=4 SGAP_LAUNCHER_MODE=staging node scripts/run-package-games-staging.mjs
 *   node scripts/run-package-games-staging.mjs -- tests/specs/csf/CSF-001.spec.ts
 */
import { spawnSync } from 'node:child_process';
import { publishAllureReport } from './generate-allure-report.mjs';
import {
  printSimulationFooter,
  printSimulationHeader,
  runPlaywrightWave,
} from './lib/simulation-terminal-report.mjs';

const workers = process.env.SGAP_WORKERS ?? '1';
const headed = process.env.SGAP_HEADED !== '0';
const launcherMode = process.env.SGAP_LAUNCHER_MODE ?? 'staging';

const GAMES = [
  'Sugar Wonderland',
  'Felice in Space',
  'Beelze-Bop',
  'Mars Triumph',
];

const projects = [
  'game:sugar-wonderland',
  'game:felice-in-space',
  'game:beelze-bop',
  'game:mars-triumph',
];

const projectArgs = projects.flatMap((name) => ['--project', name]);
const common = [
  'playwright',
  'test',
  ...projectArgs,
  `--workers=${workers}`,
  ...(headed ? ['--headed'] : []),
];

const dash = process.argv.indexOf('--');
const customSpecs = dash >= 0 ? process.argv.slice(dash + 1) : undefined;

const env = {
  ...process.env,
  SGAP_LAUNCHER_MODE: launcherMode,
  SGAP_CLICK_TRACKER: process.env.SGAP_CLICK_TRACKER ?? '1',
};

const simulationStartedAt = Date.now();

printSimulationHeader({
  title: 'Package games — automated regression',
  subtitle: '4 games × wave-0 specs (shared DiJoker package)',
  games: GAMES,
  workers,
  headed,
  launcherMode,
  waves: customSpecs?.length
    ? [`custom: ${customSpecs.join(' ')}`]
    : ['non-BF (csf, bc, ap, tm, mn)', 'BF (bf last)'],
});

const waveResults = [];

function recordWave(name, exitCode, stats) {
  waveResults.push({ name, exitCode, stats });
}

if (customSpecs !== undefined && customSpecs.length > 0) {
  const { exitCode, stats } = runPlaywrightWave({
    spawnSync,
    npxArgs: [...common, ...customSpecs],
    env,
    waveName: 'Custom spec selection',
    waveDetail: customSpecs.join(' '),
    waveIndex: 1,
    waveTotal: 1,
  });
  recordWave('custom', exitCode, stats);
  process.exit(printSimulationFooter({ waveResults, startedAt: simulationStartedAt }));
}

const { exitCode: nonBfExit, stats: nonBfStats } = runPlaywrightWave({
  spawnSync,
  npxArgs: [
    ...common,
    '--grep-invert',
    'BF-',
    'tests/specs/csf',
    'tests/specs/bc',
    'tests/specs/ap',
    'tests/specs/tm',
    'tests/specs/mn',
  ],
  env,
  waveName: 'Automated non-BF',
  waveDetail: 'csf, bc, ap, tm, mn — 16 specs × 4 games',
  waveIndex: 1,
  waveTotal: 2,
});
recordWave('non-BF', nonBfExit, nonBfStats);

const { exitCode: bfExit, stats: bfStats } = runPlaywrightWave({
  spawnSync,
  npxArgs: [...common, '--grep', 'BF-', 'tests/specs/bf'],
  env,
  waveName: 'Buy Feature (BF last)',
  waveDetail: 'bf — 4 specs × 4 games',
  waveIndex: 2,
  waveTotal: 2,
});
recordWave('BF', bfExit, bfStats);

const exitCode = printSimulationFooter({ waveResults, startedAt: simulationStartedAt });
await publishAllureReport();
process.exit(exitCode);
