/**
 * Sugar Wonderland regression: automated specs first (BF last), then pending catalog rows.
 * Prints detailed terminal summary after each wave.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { publishAllureReport } from './generate-allure-report.mjs';
import {
  printSimulationFooter,
  printSimulationHeader,
  runPlaywrightWave,
} from './lib/simulation-terminal-report.mjs';

const root = process.cwd();
const resultsDir = path.join(root, 'allure-results');

rmSync(resultsDir, { recursive: true, force: true });
mkdirSync(resultsDir, { recursive: true });
writeFileSync(
  path.join(resultsDir, 'categories.json'),
  `${JSON.stringify(
    [
      {
        name: 'Not yet automated',
        matchedStatuses: ['skipped'],
        messageRegex: '.*Not yet automated.*',
      },
      { name: 'Product defects', matchedStatuses: ['failed'] },
      { name: 'Test defects', matchedStatuses: ['broken'] },
    ],
    null,
    2,
  )}\n`,
  'utf8',
);

const launcherMode = process.env.SGAP_LAUNCHER_MODE ?? 'staging';
const gameId = process.env.SGAP_GAME_ID ?? 'sugar-wonderland';

const env = {
  ...process.env,
  SGAP_LAUNCHER_MODE: launcherMode,
  SGAP_GAME_ID: gameId,
  SGAP_CLICK_TRACKER: process.env.SGAP_CLICK_TRACKER ?? '1',
};

const common = ['--project=chromium', '--workers=1'];
if (launcherMode === 'staging') {
  common.push('--headed');
}

const simulationStartedAt = Date.now();
const waveResults = [];

printSimulationHeader({
  title: 'Sugar Wonderland — full regression staging',
  games: ['Sugar Wonderland'],
  workers: 1,
  headed: launcherMode === 'staging',
  launcherMode,
  gameId,
  waves: ['CSF → BC → TM → MN → AP → ES → AT', 'FS', 'BF (last)', 'pending catalog (Allure)'],
});

function wave(name, args, detail, index, total) {
  const { exitCode, stats } = runPlaywrightWave({
    spawnSync,
    npxArgs: ['playwright', 'test', ...common, ...args],
    env,
    waveName: name,
    waveDetail: detail,
    waveIndex: index,
    waveTotal: total,
  });
  waveResults.push({ name, exitCode, stats });
  return exitCode;
}

const nonBfCategories = [
  ['CSF', 'tests/specs/csf'],
  ['BC', 'tests/specs/bc'],
  ['TM', 'tests/specs/tm'],
  ['MN', 'tests/specs/mn'],
  ['AP', 'tests/specs/ap'],
  ['ES', 'tests/specs/es'],
  ['AT', 'tests/specs/at'],
];

let nonBfExit = 0;
for (const [label, dir] of nonBfCategories) {
  nonBfExit |= wave(
    `Automated ${label}`,
    [dir],
    `${dir} (ordered — AP last avoids BC/TM pollution)`,
    nonBfCategories.findIndex(([l]) => l === label) + 1,
    nonBfCategories.length + 3,
  );
}
waveResults.push({
  name: 'non-BF (all categories)',
  exitCode: nonBfExit,
  stats: waveResults
    .filter((w) => w.name.startsWith('Automated '))
    .reduce(
      (acc, w) => ({
        passed: acc.passed + (w.stats?.passed ?? 0),
        failed: acc.failed + (w.stats?.failed ?? 0),
        skipped: acc.skipped + (w.stats?.skipped ?? 0),
        total: acc.total + (w.stats?.total ?? 0),
      }),
      { passed: 0, failed: 0, skipped: 0, total: 0 },
    ),
});

wave('Free Spins (FS)', ['tests/specs/fs'], 'FS-003 / FS-004 / FS-006 / FS-007 / FS-009', 8, 10);

wave('Buy Feature (BF last)', ['--grep', 'BF-', 'tests/specs/bf'], 'BF specs including BF-008', 9, 10);

wave(
  'Pending catalog',
  ['tests/specs/regression/regression-pending.spec.ts'],
  'RegressionTestCases.md coverage → Allure',
  10,
  10,
);

const exitCode = printSimulationFooter({ waveResults, startedAt: simulationStartedAt });
await publishAllureReport();
process.exit(exitCode);
