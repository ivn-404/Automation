/**
 * Re-run specs that failed in the last 48-spec gate, each in its own Playwright
 * process, so gate order / leftover session cannot pollute the next case.
 *
 * Continues after failures so the rollup shows isolation pass vs still-broken.
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

const STEPS = [
  { id: 'CSF-006', spec: 'tests/specs/csf/CSF-006.spec.ts', detail: 'Result shown after reel stop' },
  { id: 'BC-007', spec: 'tests/specs/bc/BC-007.spec.ts', detail: 'Currency formatting' },
  { id: 'TM-001', spec: 'tests/specs/tm/TM-001.spec.ts', detail: 'Turbo toggle + spin' },
  { id: 'TM-002', spec: 'tests/specs/tm/TM-002.spec.ts', detail: 'Reel speed in turbo' },
  { id: 'TM-003', spec: 'tests/specs/tm/TM-003.spec.ts', detail: 'Turbo persists in autoplay' },
  { id: 'TM-004', spec: 'tests/specs/tm/TM-004.spec.ts', detail: 'Turbo + win dialogue' },
  { id: 'MN-001', spec: 'tests/specs/mn/MN-001.spec.ts', detail: 'Open/close menu then spin' },
  { id: 'UIDS-003', spec: 'tests/specs/uids/UIDS-003.spec.ts', detail: 'Bet display matches internal' },
  { id: 'UIDS-004', spec: 'tests/specs/uids/UIDS-004.spec.ts', detail: 'Buy display matches calculated' },
  { id: 'SM-001', spec: 'tests/specs/sm/SM-001.spec.ts', detail: 'No spin during feature intro' },
  { id: 'SM-004', spec: 'tests/specs/sm/SM-004.spec.ts', detail: 'Returns to idle after spin' },
  { id: 'CP-002', spec: 'tests/specs/cp/CP-002.spec.ts', detail: 'History/balance 2 decimals' },
  { id: 'ES-006', spec: 'tests/specs/es/ES-006.spec.ts', detail: 'Maximum bet edge case' },
  { id: 'AP-002', spec: 'tests/specs/ap/AP-002.spec.ts', detail: 'Autoplay selected spin count' },
  { id: 'BF-001', spec: 'tests/specs/bf/BF-001.spec.ts', detail: 'Open buy panel and return' },
];

const simulationStartedAt = Date.now();
const waveResults = [];

printSimulationHeader({
  title: 'Sugar Wonderland — isolate 15 gate failures',
  games: ['Sugar Wonderland'],
  workers: 1,
  headed: launcherMode === 'staging',
  launcherMode,
  gameId: 'sugar-wonderland',
  waves: STEPS.map((step) => `${step.id} (${step.spec})`),
});

for (let i = 0; i < STEPS.length; i += 1) {
  const step = STEPS[i];
  const { exitCode, stats } = runPlaywrightWave({
    spawnSync,
    npxArgs: [...common, step.spec],
    env,
    waveName: `${step.id} — ${step.detail}`,
    waveDetail: step.spec,
    waveIndex: i + 1,
    waveTotal: STEPS.length,
  });
  waveResults.push({ name: step.id, exitCode, stats });
}

process.exit(printSimulationFooter({ waveResults, startedAt: simulationStartedAt }));
