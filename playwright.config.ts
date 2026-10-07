import { defineConfig, devices, type Project, type ReporterDescription } from '@playwright/test';

import {
  laneAssignmentLabel,
  loadParallelWorkersConfig,
  projectNameForLane,
  resolveLanePlacement,
  testMatchForLane,
  windowBoundsForLane,
} from './tests/support/parallel-lanes.js';
import path from 'node:path';

import { innerViewportForWindow } from './src/platform/game-view-layout.js';
import { resultsRoot } from './src/shared/run-paths.js';

/**
 * SGAP Playwright configuration.
 *
 * Responsibilities:
 * - Global test runner settings (timeouts, reporters, artifacts)
 * - Browser projects (Chrome, Edge)
 * - Optional per-game projects for the shared DiJoker package
 * - Optional 4-lane parallel projects (SGAP_PARALLEL_WORKERS=1)
 *
 * Environment-specific values belong in config/environments/.
 * Game-specific values belong in config/manifests/.
 * Lane assignments belong in config/parallel-workers.json.
 */

const parallelEnabled = process.env.SGAP_PARALLEL_WORKERS === '1';
const parallelConfig = parallelEnabled ? loadParallelWorkersConfig() : undefined;

const TRACE_MODES = ['off', 'on', 'retain-on-failure', 'on-first-retry'] as const;
const SCREENSHOT_MODES = ['off', 'on', 'only-on-failure'] as const;

function traceMode(fallback: (typeof TRACE_MODES)[number]): (typeof TRACE_MODES)[number] {
  const raw = process.env.SGAP_TRACE?.trim();
  return TRACE_MODES.find((mode) => mode === raw) ?? fallback;
}

function screenshotMode(fallback: (typeof SCREENSHOT_MODES)[number]): (typeof SCREENSHOT_MODES)[number] {
  const raw = process.env.SGAP_SCREENSHOT?.trim();
  return SCREENSHOT_MODES.find((mode) => mode === raw) ?? fallback;
}

const desktopChrome = {
  ...devices['Desktop Chrome'],
  viewport: { width: 1400, height: 900 } as const,
  hasTouch: true,
};

/** Same-package DiJoker titles (wave-0 canvas coords shared). */
export const SGAP_PACKAGE_GAMES = [
  {
    id: 'sugar-wonderland',
    project: 'game:sugar-wonderland',
    gameName: 'Sugar Wonderland',
  },
  {
    id: 'felice-in-space',
    project: 'game:felice-in-space',
    gameName: 'Felice in Space',
  },
  {
    id: 'beelze-bop',
    project: 'game:beelze-bop',
    gameName: 'Beelze-Bop',
  },
  {
    id: 'mars-triumph',
    project: 'game:mars-triumph',
    gameName: 'Mars Triumph',
  },
] as const;

const defaultProjects: Project[] = [
  {
    name: 'chromium',
    use: { ...desktopChrome },
  },
  {
    name: 'chrome',
    use: {
      ...desktopChrome,
      channel: 'chrome',
    },
  },
  {
    name: 'edge',
    use: {
      ...devices['Desktop Edge'],
      viewport: { width: 1400, height: 900 },
      hasTouch: true,
      channel: 'msedge',
    },
  },
  ...SGAP_PACKAGE_GAMES.map((game) => ({
    name: game.project,
    metadata: {
      sgapGameId: game.id,
      /** Exact game title — fixture builds `{gameName}_{random}` player ids. */
      sgapGameName: game.gameName,
    },
    use: { ...desktopChrome },
  })),
];

const parallelProjects: Project[] =
  parallelConfig === undefined
    ? []
    : parallelConfig.lanes.map((lane) => {
        const bounds = windowBoundsForLane(lane);
        const placement = resolveLanePlacement(lane);
        return {
          name: projectNameForLane(lane),
          testDir: './tests/specs',
          testMatch: testMatchForLane(lane),
          fullyParallel: false,
          workers: 1,
          metadata: {
            sgapWorkerId: lane.id,
            sgapCategory: lane.category,
            sgapCategories: laneAssignmentLabel(lane),
            sgapPlayerId: lane.playerId,
            ...(lane.gameId !== undefined ? { sgapGameId: lane.gameId } : {}),
            ...(lane.gameName !== undefined ? { sgapGameName: lane.gameName } : {}),
            ...(lane.packageId !== undefined ? { sgapPackageId: lane.packageId } : {}),
            sgapDefaultBalance: parallelConfig.defaultBalance,
            sgapDefaultBetLimit: parallelConfig.defaultBetLimit ?? parallelConfig.defaultBalance,
            sgapMonitor: placement.monitor,
            sgapSlot: placement.slot,
            sgapGridCol: placement.col,
            sgapGridRow: placement.row,
          },
          use: {
            ...desktopChrome,
            viewport: innerViewportForWindow(bounds),
            launchOptions: {
              args: [
                `--window-position=${bounds.left},${bounds.top}`,
                `--window-size=${bounds.width},${bounds.height}`,
              ],
            },
          },
        };
      });

const reporters: ReporterDescription[] = [
  ['list'],
  ...(parallelEnabled
    ? ([['./tests/support/parallel-lane-reporter.ts']] as ReporterDescription[])
    : ([
        ['html', { outputFolder: process.env.SGAP_HTML_REPORT ?? 'playwright-report', open: 'never' }],
      ] as ReporterDescription[])),
  ['json', { outputFile: process.env.SGAP_RESULTS_JSON ?? path.join(resultsRoot(), 'results.json') }],
  [
    'allure-playwright',
    {
      resultsDir:
        process.env.SGAP_ALLURE_DIR ??
        (process.env.SGAP_RUN_DIR ? path.join(resultsRoot(), 'allure-results') : 'allure-results'),
      detail: true,
      suiteTitle: true,
      environmentInfo: {
        launcher_mode: process.env.SGAP_LAUNCHER_MODE ?? 'local',
        game_id: process.env.SGAP_GAME_ID ?? 'sugar-wonderland',
        node_version: process.version,
      },
    },
  ],
];

export default defineConfig({
  testDir: './tests/specs',
  // Playwright empties outputDir when a process starts, so each managed run needs its own.
  outputDir: path.join(resultsRoot(), 'artifacts'),

  fullyParallel: parallelEnabled ? false : true,
  forbidOnly: !!process.env.CI,
  retries:
    process.env.CI || process.env.SGAP_LAUNCHER_MODE === 'staging' ? 1 : 0,
  workers: parallelEnabled ? 1 : process.env.CI ? 1 : undefined,

  /* SGAP: prefer observable conditions in tests; global timeout is a safety net only. */
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },

  reporter: reporters,

  use: {
    headless: true,
    /* Match calibrate:spin viewport so canvasAction ratios stay stable. */
    viewport: { width: 1400, height: 900 },
    /* DiJoker launches Sugar Wonderland with device=mobile — Phaser expects touch. */
    hasTouch: true,
    ignoreHTTPSErrors: true,
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    // Parallel headed lanes: traces/videos under load corrupt zip archives and
    // amplify "page/context closed" teardown failures. Keep screenshots only
    // unless the tester opts in (SGAP_TRACE / SGAP_SCREENSHOT from the QA page).
    trace: traceMode(parallelEnabled ? 'off' : 'on-first-retry'),
    screenshot: screenshotMode('only-on-failure'),
    video: parallelEnabled ? 'off' : 'retain-on-failure',
  },

  projects: parallelEnabled ? parallelProjects : defaultProjects,
});
