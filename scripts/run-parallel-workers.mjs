/**
 * 4-worker headed Playwright run on a dual-monitor `1 2 | 3 4` layout.
 *
 * Each lane is an isolated Playwright process (workers=1) so wallets and
 * window positions cannot leak across workers.
 *
 * Assignments live in config/parallel-workers.json.
 *
 *   SGAP_LAUNCHER_MODE=staging npx pnpm test:parallel:staging
 */
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { publishAllureReport } from './generate-allure-report.mjs';
import {
  clearLockfile,
  killPidTree,
  stopSgapLeftovers,
  writeLockfile,
} from './lib/sgap-process-guard.mjs';
import {
  createWorkerMonitorServer,
  findChromiumExe,
  launchMonitorChrome,
} from './lib/sgap-worker-monitor-server.mjs';
import { resolveTester, testerPlayerId } from './lib/sgap-tester.mjs';
import { allureResultsRoot, isManagedRun, resultsRoot } from './lib/sgap-run-paths.mjs';

const require = createRequire(import.meta.url);
const playwrightCli = require.resolve('@playwright/test/cli');

const configPath = process.env.SGAP_PARALLEL_CONFIG?.trim()
  ? path.resolve(process.env.SGAP_PARALLEL_CONFIG.trim())
  : path.join(process.cwd(), 'config', 'parallel-workers.json');
const parallelConfig = JSON.parse(readFileSync(configPath, 'utf8'));
// Lane Playwright processes inherit SGAP_TESTER and apply the same suffix (tests/support/parallel-lanes.ts).
const tester = resolveTester();
parallelConfig.lanes = parallelConfig.lanes.map((lane) => ({ ...lane, playerId: testerPlayerId(lane.playerId, tester) }));

const launcherMode = process.env.SGAP_LAUNCHER_MODE ?? 'staging';
const headed = process.env.SGAP_PARALLEL_HEADLESS === '1' ? false : launcherMode === 'staging';
// Lane windows are tiled on screen; SGAP_BROWSER_VIEW=hidden (opt-in) moves them
// off-screen at the same size. See windowBoundsForLane in tests/support/parallel-lanes.ts.
const browserView = process.env.SGAP_BROWSER_VIEW?.trim().toLowerCase() === 'hidden' ? 'hidden' : 'visible';
// Watched lanes get a small "Screenshot captured" notice (src/platform/stable-screenshot.ts).
const screenshotToast = process.env.SGAP_SCREENSHOT_TOAST ?? (headed && browserView === 'visible' ? '1' : '0');
const extraArgs = process.argv.slice(2);

const screens = detectScreens();
// A lane pinned to a missing monitor silently lands in a half-height 2x2 cell, which
// squashes the portrait game frame and shifts every canvas ratio mid-run.
// Checked before cleanup so an aborted launch keeps the previous run's results.
const missingMonitorLanes = parallelConfig.lanes.filter(
  (lane) => Number.isFinite(Number(lane.monitor)) && Number(lane.monitor) >= screens.length,
);
if (missingMonitorLanes.length > 0 && process.env.SGAP_ALLOW_SCREEN_FALLBACK !== '1') {
  console.error(
    `\nSGAP: config ${configPath} pins worker(s) ${missingMonitorLanes.map((lane) => lane.id).join(', ')} ` +
      `to monitor index ${missingMonitorLanes.map((lane) => lane.monitor).join(', ')}, but only ${screens.length} screen(s) were detected.\n` +
      '      Wake/connect the other display and re-run, or set SGAP_ALLOW_SCREEN_FALLBACK=1 to accept the 2x2 fallback.\n',
  );
  process.exit(1);
}

console.log('SGAP: closing leftover Playwright Chromium from previous runs');
const cleaned = stopSgapLeftovers({ excludePid: process.pid });
if (cleaned.killed > 0) {
  console.log(`SGAP: terminated ${cleaned.killed} leftover process(es)`);
}
resetAllureWorkerDirs();

function resetAllureWorkerDirs() {
  // Lanes can outnumber workers; clear every w<N> so a stale lane never joins this report.
  const root = allureResultsRoot();
  const stale = existsSync(root) ? readdirSync(root).filter((name) => /^w\d+$/u.test(name)) : [];
  for (const name of new Set([...stale, 'w1', 'w2', 'w3', 'w4'])) {
    const dir = path.join(root, name);
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
  }
}

function hasChromium(root) {
  if (!root || !existsSync(root)) {
    return false;
  }
  try {
    return readdirSync(root).some((name) => {
      if (!name.startsWith('chromium-')) {
        return false;
      }
      return existsSync(path.join(root, name, 'chrome-win64', 'chrome.exe'));
    });
  } catch {
    return false;
  }
}

function resolvePlaywrightBrowsersPath() {
  const configured = process.env.PLAYWRIGHT_BROWSERS_PATH;
  const local = path.join(process.env.LOCALAPPDATA ?? '', 'ms-playwright');
  if (hasChromium(configured)) {
    return configured;
  }
  if (hasChromium(local)) {
    return local;
  }
  return configured;
}

function detectScreens() {
  if (process.env.SGAP_SCREENS) {
    return parseScreens(process.env.SGAP_SCREENS);
  }
  if (process.env.SGAP_SCREEN_WIDTH && process.env.SGAP_SCREEN_HEIGHT) {
    return [
      {
        left: Number(process.env.SGAP_SCREEN_LEFT ?? '0'),
        top: Number(process.env.SGAP_SCREEN_TOP ?? '0'),
        width: Number(process.env.SGAP_SCREEN_WIDTH),
        height: Number(process.env.SGAP_SCREEN_HEIGHT),
      },
    ];
  }
  if (process.platform !== 'win32') {
    return [{ left: 0, top: 0, width: 1920, height: 1080 }];
  }
  const result = spawnSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-Command',
      [
        'Add-Type -AssemblyName System.Windows.Forms;',
        '[System.Windows.Forms.Screen]::AllScreens',
        '| Sort-Object { $_.WorkingArea.X }, { $_.WorkingArea.Y }',
        '| ForEach-Object { $w = $_.WorkingArea; Write-Output "$($w.X),$($w.Y),$($w.Width),$($w.Height)" }',
      ].join(' '),
    ],
    { encoding: 'utf8' },
  );
  const parsed = parseScreens((result.stdout ?? '').trim().split(/\r?\n/).join(';'));
  if (parsed.length > 0) {
    return parsed;
  }
  return [{ left: 0, top: 0, width: 1920, height: 1080 }];
}

function parseScreens(raw) {
  return raw
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const [left, top, width, height] = part.split(',').map(Number);
      if (![left, top, width, height].every((value) => Number.isFinite(value)) || width <= 0 || height <= 0) {
        return undefined;
      }
      return { left, top, width, height };
    })
    .filter(Boolean);
}

function lanePlacement(lane) {
  const id = Number(lane.id);
  return {
    monitor: Number.isFinite(Number(lane.monitor)) ? Number(lane.monitor) : Math.floor((id - 1) / 2),
    slot: Number.isFinite(Number(lane.slot)) ? Number(lane.slot) : (id - 1) % 2,
  };
}

/** Mirrors windowBoundsForLane in tests/support/parallel-lanes.ts (which places the windows). */
function windowBoundsForLane(lane, screens) {
  const cell = laneCell(lane, screens);
  if (browserView === 'visible') {
    return cell;
  }
  const minLeft = Math.min(...screens.map((screen) => screen.left));
  const maxRight = Math.max(...screens.map((screen) => screen.left + screen.width));
  return { ...cell, left: cell.left + (maxRight - minLeft) + 400 };
}

function laneCell(lane, screens) {
  const { monitor, slot } = lanePlacement(lane);
  if (screens.length >= 2) {
    const screen = screens[Math.min(monitor, screens.length - 1)];
    const cellW = Math.max(1, Math.floor(screen.width / 2));
    return {
      left: screen.left + slot * cellW,
      top: screen.top,
      width: cellW,
      height: screen.height,
    };
  }
  const screen = screens[0];
  const col = slot;
  const row = monitor;
  const cellW = Math.max(1, Math.floor(screen.width / 2));
  const cellH = Math.max(1, Math.floor(screen.height / 2));
  return {
    left: screen.left + col * cellW,
    top: screen.top + row * cellH,
    width: cellW,
    height: cellH,
  };
}

function assignmentLabel(lane) {
  if (Array.isArray(lane.categories) && lane.categories.length > 0) {
    return lane.categories.join(' ');
  }
  return lane.category;
}

function projectName(lane) {
  return `w${lane.id}-${lane.category}`;
}

function formatCell(bounds) {
  return `${bounds.width}x${bounds.height} @ ${bounds.left},${bounds.top}`;
}

function loadJsonStats(filePath) {
  if (!existsSync(filePath)) {
    return { passed: 0, failed: 0, skipped: 0, timedOut: 0 };
  }
  try {
    const report = JSON.parse(readFileSync(filePath, 'utf8'));
    const stats = { passed: 0, failed: 0, skipped: 0, timedOut: 0 };
    const visit = (suites) => {
      if (!Array.isArray(suites)) {
        return;
      }
      for (const suite of suites) {
        for (const spec of suite.specs ?? []) {
          for (const test of spec.tests ?? []) {
            const status = test.results?.[0]?.status ?? test.status;
            if (status === 'passed' || status === 'expected') stats.passed += 1;
            else if (status === 'skipped') stats.skipped += 1;
            else if (status === 'timedOut') stats.timedOut += 1;
            else if (status === 'failed' || status === 'unexpected') stats.failed += 1;
          }
        }
        visit(suite.suites);
      }
    };
    visit(report.suites);
    return stats;
  } catch {
    return { passed: 0, failed: 0, skipped: 0, timedOut: 0 };
  }
}

function runLane(lane, env) {
  const resultsFile = path.join(resultsRoot(), `w${lane.id}-results.json`);
  rmSync(resultsFile, { force: true });
  const args = [
    playwrightCli,
    'test',
    `--project=${projectName(lane)}`,
    '--workers=1',
    ...(headed ? ['--headed'] : []),
    ...extraArgs,
  ];
  return new Promise((resolve) => {
    if (shuttingDown) {
      resolve({ lane, code: 1, resultsFile });
      return;
    }
    const child = spawn(process.execPath, args, {
      env: {
        ...env,
        SGAP_RESULTS_JSON: resultsFile,
        SGAP_ALLURE_DIR: path.join(allureResultsRoot(), `w${lane.id}`),
        SGAP_WORKER_ID: String(lane.id),
        ...(lane.gameId ? { SGAP_GAME_ID: lane.gameId } : {}),
      },
      stdio: 'inherit',
      windowsHide: false,
      detached: false,
    });
    children.push(child);
    laneChildren.set(lane.id, child);
    writeLockfile(children.map((entry) => entry.pid));
    child.on('error', (error) => {
      console.error(`[Worker ${lane.id}] failed to start: ${error.message}`);
      dropChild(child);
      resolve({ lane, code: 1, resultsFile });
    });
    child.on('exit', (code) => {
      dropChild(child);
      resolve({ lane, code: code === null ? 1 : code, resultsFile });
    });
  });
}

const children = [];
const laneChildren = new Map();
let shuttingDown = false;
let monitorHandle;

function dropChild(child) {
  const index = children.indexOf(child);
  if (index >= 0) {
    children.splice(index, 1);
  }
  for (const [laneId, entry] of laneChildren.entries()) {
    if (entry === child) {
      laneChildren.delete(laneId);
      break;
    }
  }
  if (!shuttingDown) {
    writeLockfile(children.map((entry) => entry.pid));
  }
}

async function stopWorkersFromMonitor(body = {}) {
  const all = body.all === true;
  const requested = all
    ? parallelConfig.lanes.map((lane) => Number(lane.id))
    : (Array.isArray(body.workers) ? body.workers.map(Number) : []);
  const workerIds = [...new Set(requested.filter((id) => Number.isFinite(id) && id > 0))];
  if (workerIds.length === 0) {
    return { ok: false, error: 'Specify workers: [1,2,3,4] or all: true' };
  }

  console.log(
    `\nSGAP monitor: stop requested — ${all ? 'all workers' : 'worker(s) ' + workerIds.join(', ')}`,
  );

  const stopped = [];
  const missing = [];
  for (const id of workerIds) {
    const child = laneChildren.get(id);
    if (child?.pid) {
      killPidTree(child.pid);
      stopped.push(id);
    } else {
      missing.push(id);
    }
    monitorHandle?.applyEvent({
      type: 'lane-end',
      id,
      workerId: id,
      reason: 'stopped',
    });
  }

  if (all && workerIds.length === parallelConfig.lanes.length) {
    for (const child of [...children]) {
      if (child.pid) {
        killPidTree(child.pid);
      }
    }
    children.length = 0;
    laneChildren.clear();
    stopSgapLeftovers({ excludePid: process.pid });
    clearLockfile();
  }

  return {
    ok: true,
    all,
    stopped,
    missing,
    message:
      stopped.length > 0
        ? `Stopped worker${stopped.length === 1 ? '' : 's'} ${stopped.join(', ')}`
        : 'No active worker processes matched',
  };
}

function stopWorkers(reason) {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  console.log(`\nSGAP: ${reason} — terminating workers and Playwright Chromium`);
  for (const child of [...children]) {
    if (child.pid) {
      killPidTree(child.pid);
    }
  }
  children.length = 0;
  laneChildren.clear();
  stopSgapLeftovers({ excludePid: process.pid });
  clearLockfile();
}

process.on('SIGINT', () => {
  stopWorkers('interrupted');
  process.exit(130);
});
process.on('SIGTERM', () => {
  stopWorkers('terminated');
  process.exit(143);
});
process.on('SIGHUP', () => {
  stopWorkers('hangup');
  process.exit(129);
});
if (process.platform === 'win32') {
  process.on('SIGBREAK', () => {
    stopWorkers('console close');
    process.exit(1);
  });
}

const screenEnv = screens.map((screen) => `${screen.left},${screen.top},${screen.width},${screen.height}`).join(';');
const dual = screens.length >= 2;
const startedAt = Date.now();
const playwrightBrowsersPath = resolvePlaywrightBrowsersPath();

console.log('');
console.log(`SGAP ${parallelConfig.workers ?? parallelConfig.lanes.length}-worker parallel`);
console.log(` launcher : ${launcherMode}`);
console.log(` workers  : ${parallelConfig.workers ?? parallelConfig.lanes.length} isolated processes`);
console.log(` headed   : ${headed}`);
console.log(` browser  : ${headed ? (browserView === 'visible' ? 'visible on screen' : 'hidden off-screen (same window size and viewport)') : 'headless'}${screenshotToast === '1' ? ' · screenshot notice on' : ''}`);
console.log(` browsers : ${playwrightBrowsersPath || 'Playwright default'}`);
console.log(` layout   : ${parallelConfig.layout ?? '1 2 | 3 4'}`);
console.log(` tester   : ${tester || '(none — set SGAP_TESTER in .env when several PCs test at once)'}`);
console.log(` balance  : ${parallelConfig.defaultBalance} (min-bet tests use ${parallelConfig.minimumBetBalance})`);
console.log(` bet limit: ${parallelConfig.defaultBetLimit ?? parallelConfig.defaultBalance}`);
console.log(` screens  : ${screens.length}${dual ? ' (dual-monitor row)' : ' (single-monitor 2x2 fallback)'}`);
screens.forEach((screen, index) => {
  console.log(
    `   monitor ${index + 1}: ${screen.width}x${screen.height} @ ${screen.left},${screen.top}`,
  );
});
console.log('');
if (dual) {
  const left = screens[0];
  const right = screens[1];
  console.log(`   Monitor 1 (${left.width}x${left.height})     |  Monitor 2 (${right.width}x${right.height})`);
  console.log('   [W1]              [W2]           |  [W3]              [W4]');
} else {
  console.log('   [W1] [W2]');
  console.log('   [W3] [W4]');
}
console.log('');
console.log(' lanes    :');
for (const lane of parallelConfig.lanes) {
  const bounds = windowBoundsForLane(lane, screens);
  const { monitor, slot } = lanePlacement(lane);
  const game = lane.gameName ?? lane.gameId ?? process.env.SGAP_GAME_ID ?? 'sugar-wonderland';
  console.log(
    `   [Worker ${lane.id}][${game}][${lane.category}][${lane.playerId}]  ${assignmentLabel(lane)}  M${monitor + 1}${slot === 0 ? 'L' : 'R'}  ${formatCell(bounds)}`,
  );
}
console.log('');

const monitorEnabled = process.env.SGAP_WORKER_MONITOR !== '0' && process.env.SGAP_WORKER_MONITOR !== 'false';
let monitorClose = async () => undefined;
let monitorUrl = '';
if (monitorEnabled) {
  monitorHandle = createWorkerMonitorServer({
    lanes: parallelConfig.lanes.map((lane) => ({
      id: lane.id,
      category: lane.category,
      categories: lane.categories,
      playerId: lane.playerId,
      project: projectName(lane),
      gameId: lane.gameId,
      gameName: lane.gameName,
      packageId: lane.packageId,
    })),
    onStop: stopWorkersFromMonitor,
  });
  const bound = await monitorHandle.listen(Number(process.env.SGAP_MONITOR_PORT ?? 3847));
  monitorUrl = bound.url;
  monitorClose = bound.close;
  console.log(` monitor  : ${bound.url}`);
  console.log(` reader   : ${bound.url}/reader`);
  console.log(` observe  : ${bound.url}/observe  (Monitor Worker)`);
}

const env = {
  ...process.env,
  SGAP_LAUNCHER_MODE: launcherMode,
  SGAP_PARALLEL_WORKERS: '1',
  SGAP_GAME_ID: process.env.SGAP_GAME_ID ?? 'sugar-wonderland',
  SGAP_CLICK_TRACKER: process.env.SGAP_CLICK_TRACKER ?? '1',
  SGAP_BROWSER_VIEW: browserView,
  SGAP_SCREENSHOT_TOAST: screenshotToast,
  SGAP_WORKER_MONITOR: monitorEnabled ? '1' : '0',
  SGAP_MONITOR_URL: monitorUrl,
  SGAP_SCREENS: screenEnv,
  SGAP_SCREEN_LEFT: String(screens[0].left),
  SGAP_SCREEN_TOP: String(screens[0].top),
  SGAP_SCREEN_WIDTH: String(screens[0].width),
  SGAP_SCREEN_HEIGHT: String(screens[0].height),
  ...(playwrightBrowsersPath ? { PLAYWRIGHT_BROWSERS_PATH: playwrightBrowsersPath } : {}),
};

const resultsPromise = shuttingDown
  ? Promise.resolve([])
  : Promise.all(parallelConfig.lanes.map((lane) => runLane(lane, env)));

// Managed runs are watched through the control panel; overlay windows from several
// concurrent runs would pile up on the host's screen. An SGAP agent runs on the
// tester's own PC and asks for them (SGAP_MONITOR_OVERLAY=1).
const overlayWindows =
  process.env.SGAP_MONITOR_OVERLAY === '1' || (!isManagedRun() && process.env.SGAP_MONITOR_OVERLAY !== '0');
if (!shuttingDown && monitorEnabled && monitorUrl && overlayWindows) {
  setTimeout(() => {
    const chromeExe = findChromiumExe(playwrightBrowsersPath);
    const monitorChrome = launchMonitorChrome({
      url: monitorUrl,
      chromeExe,
      screens,
    });
    if (monitorChrome?.pid) {
      console.log(` overlay  : Chrome worker monitor (pid ${monitorChrome.pid})`);
    } else if (!chromeExe) {
      console.log(' overlay  : skipped (Chromium not found) — open the monitor URL in Chrome');
    }
    if (process.env.SGAP_OBSERVE !== '0' && process.env.SGAP_OBSERVE_WINDOW !== '0') {
      setTimeout(() => {
        const observeChrome = launchMonitorChrome({
          url: `${monitorUrl}/observe`,
          chromeExe,
          screens,
          offset: 48,
        });
        if (observeChrome?.pid) {
          console.log(` observe  : Monitor Worker window (pid ${observeChrome.pid})`);
        }
      }, 1500);
    }
  }, 6000);
}

const results = await resultsPromise;
if (shuttingDown) {
  process.exit(130);
}

for (const child of [...children]) {
  if (child.pid) {
    killPidTree(child.pid);
  }
}
stopSgapLeftovers({ excludePid: process.pid });
clearLockfile();
const elapsedMs = Date.now() - startedAt;
const elapsedMin = (elapsedMs / 60000).toFixed(1);

console.log('');
console.log(`SGAP ${parallelConfig.workers ?? parallelConfig.lanes.length}-worker summary`);
console.log('────────────────────────────────────────');
let failedLanes = 0;
let passed = 0;
let failed = 0;
let skipped = 0;
for (const result of results) {
  const stats = loadJsonStats(result.resultsFile);
  passed += stats.passed;
  failed += stats.failed + stats.timedOut;
  skipped += stats.skipped;
  if (result.code !== 0) {
    failedLanes += 1;
  }
  const status = !existsSync(result.resultsFile) ? 'STOPPED (no results)' : result.code === 0 ? 'PASS' : 'FAIL';
  const game = result.lane.gameName ?? result.lane.gameId ?? '';
  const gameTag = game ? `[${game}]` : '';
  console.log(
    `  [Worker ${result.lane.id}]${gameTag}[${result.lane.category}][${result.lane.playerId}]  ${status}  passed=${stats.passed} failed=${stats.failed + stats.timedOut} skipped=${stats.skipped}`,
  );
}
console.log('────────────────────────────────────────');
console.log(`  totals   passed=${passed} failed=${failed} skipped=${skipped}  (${elapsedMin}m)`);
console.log('');

// Managed runs publish one combined report per run (scripts/run-suite-queue.mjs).
if (process.env.SGAP_SKIP_ALLURE !== '1' && !isManagedRun()) {
  await publishAllureReport();
}

await monitorClose();
process.exit(failedLanes === 0 ? 0 : 1);
