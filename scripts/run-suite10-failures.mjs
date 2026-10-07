/**
 * Re-run only the 5 specs that failed in suite #10 (59/5 gate),
 * each in its own Playwright process on the correct parallel lane project.
 */
import { spawnSync } from 'node:child_process';
import {
  printSimulationFooter,
  printSimulationHeader,
  runPlaywrightWave,
} from './lib/simulation-terminal-report.mjs';

const launcherMode = process.env.SGAP_LAUNCHER_MODE ?? 'staging';
const browsersPath =
  process.env.PLAYWRIGHT_BROWSERS_PATH ?? 'C:/Users/User/AppData/Local/ms-playwright';

const env = {
  ...process.env,
  SGAP_LAUNCHER_MODE: launcherMode,
  SGAP_PARALLEL_WORKERS: '1',
  SGAP_GAME_ID: 'sugar-wonderland',
  PLAYWRIGHT_BROWSERS_PATH: browsersPath,
  SGAP_CLICK_TRACKER: process.env.SGAP_CLICK_TRACKER ?? '1',
};

const common = [
  'playwright',
  'test',
  '--workers=1',
  '--retries=0',
  ...(launcherMode === 'staging' ? ['--headed'] : []),
];

/** Lane project matches config/parallel-workers.json assignments. */
const ALL_STEPS = [
  { id: 'AP-002', spec: 'tests/specs/ap/AP-002.spec.ts', project: 'w4-CONTROL' },
  { id: 'BC-004', spec: 'tests/specs/bc/BC-004.spec.ts', project: 'w4-CONTROL' },
  { id: 'ES-006', spec: 'tests/specs/es/ES-006.spec.ts', project: 'w4-CONTROL' },
  { id: 'BF-003', spec: 'tests/specs/bf/BF-003.spec.ts', project: 'w3-BUY' },
  { id: 'CSF-008', spec: 'tests/specs/csf/CSF-008.spec.ts', project: 'w1-CORE' },
];

/** `node scripts/run-suite10-failures.mjs BC-004 ES-006` runs a subset. */
const requested = process.argv.slice(2).map((arg) => arg.toUpperCase());
const STEPS =
  requested.length > 0 ? ALL_STEPS.filter((step) => requested.includes(step.id)) : ALL_STEPS;

const simulationStartedAt = Date.now();
const waveResults = [];

printSimulationHeader({
  title: `Suite #10 failures only (${STEPS.length} spec${STEPS.length === 1 ? '' : 's'})`,
  games: ['Sugar Wonderland'],
  workers: 1,
  headed: launcherMode === 'staging',
  launcherMode,
  gameId: 'sugar-wonderland',
  waves: STEPS.map((step) => `${step.id} (${step.project})`),
});

for (let i = 0; i < STEPS.length; i += 1) {
  const step = STEPS[i];
  const { exitCode, stats } = runPlaywrightWave({
    spawnSync,
    npxArgs: [...common, step.spec, '--project', step.project],
    env,
    waveName: `${step.id} — ${step.project}`,
    waveDetail: step.spec,
    waveIndex: i + 1,
    waveTotal: STEPS.length,
  });
  waveResults.push({ name: step.id, exitCode, stats });
}

process.exit(printSimulationFooter({ waveResults, startedAt: simulationStartedAt }));
