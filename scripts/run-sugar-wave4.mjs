/**
 * Sugar Wonderland Wave 4 — 8 new regression specs.
 *
 * Each spec runs in its own Playwright invocation so order is enforced.
 * AP-004 (3 USD wallet) is last; wallet restore runs first on staging.
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

const WAVE4_STEPS = [
  {
    id: 'RESTORE',
    spec: 'tests/specs/setup/restore-staging-wallet.spec.ts',
    detail: 'Restore staging wallet (20k USD)',
    stagingOnly: true,
  },
  { id: 'BF-007', spec: 'tests/specs/bf/BF-007.spec.ts', detail: 'Buy triggers correct feature' },
  { id: 'BF-010', spec: 'tests/specs/bf/BF-010.spec.ts', detail: 'No balance mismatch after buy' },
  { id: 'UIDS-004', spec: 'tests/specs/uids/UIDS-004.spec.ts', detail: 'Buy display matches calculated value' },
  { id: 'SM-001', spec: 'tests/specs/sm/SM-001.spec.ts', detail: 'Cannot spin during feature intro' },
  { id: 'SM-006', spec: 'tests/specs/sm/SM-006.spec.ts', detail: 'No infinite loading state' },
  { id: 'ES-004', spec: 'tests/specs/es/ES-004.spec.ts', detail: 'Bonus skip via click' },
  { id: 'TM-004', spec: 'tests/specs/tm/TM-004.spec.ts', detail: 'Turbo + win dialogue' },
  { id: 'AP-004', spec: 'tests/specs/ap/AP-004.spec.ts', detail: 'Autoplay stops on insufficient balance' },
];

const steps =
  launcherMode === 'staging'
    ? WAVE4_STEPS
    : WAVE4_STEPS.filter((step) => !step.stagingOnly);

const resumeFrom = process.env.SGAP_WAVE4_FROM;
const activeSteps =
  resumeFrom === undefined
    ? steps
    : steps.slice(Math.max(0, steps.findIndex((step) => step.id === resumeFrom)));

const simulationStartedAt = Date.now();
const waveResults = [];

printSimulationHeader({
  title: 'Sugar Wonderland — Wave 4 (8 specs + wallet restore)',
  games: ['Sugar Wonderland'],
  workers: 1,
  headed: launcherMode === 'staging',
  launcherMode,
  gameId: 'sugar-wonderland',
  waves: activeSteps.map((step) => `${step.id} (${step.spec})`),
});

let exitCode = 0;

for (let i = 0; i < activeSteps.length; i += 1) {
  const step = activeSteps[i];
  const { exitCode: waveExit, stats } = runPlaywrightWave({
    spawnSync,
    npxArgs: [...common, step.spec],
    env,
    waveName: `${step.id} — ${step.detail}`,
    waveDetail: step.spec,
    waveIndex: i + 1,
    waveTotal: activeSteps.length,
  });
  exitCode |= waveExit;
  waveResults.push({ name: step.id, exitCode: waveExit, stats });
  if (waveExit !== 0) {
    break;
  }
}

process.exit(printSimulationFooter({ waveResults, startedAt: simulationStartedAt }));
