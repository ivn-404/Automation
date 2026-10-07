/**
 * Monitored Scratch (SCG) sweep across every scratch-enabled game on staging.
 *
 * Unlike run-scg-all-staging.mjs (sequential, no dashboard), this runner brings up
 * the SGAP worker monitor so every game shows as its own lane in the "worker tab"
 * (http://127.0.0.1:3847) + the Chrome overlay, runs games with bounded concurrency,
 * streams start/end events per game, and publishes one Allure report at the end.
 *
 * Env:
 *   SGAP_LAUNCHER_MODE     default 'staging'
 *   SGAP_SCG_SPECS         spec path/glob (default tests/specs/scg) — e.g. a single case
 *   SGAP_SCG_GAMES         optional comma-separated gameId allowlist (default: all)
 *   SGAP_SCG_CONCURRENCY   games in flight at once (default 2; headed load cap)
 *   SGAP_HEADED            default on (0 = headless)
 *   SGAP_MONITOR_PORT      default 3847
 *   SGAP_SKIP_ALLURE=1     skip the final publish
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { publishAllureReport } from './generate-allure-report.mjs';
import {
  createWorkerMonitorServer,
  findChromiumExe,
  launchMonitorChrome,
} from './lib/sgap-worker-monitor-server.mjs';
import { clearLockfile, killPidTree, stopSgapLeftovers, writeLockfile } from './lib/sgap-process-guard.mjs';

const require = createRequire(import.meta.url);
const cwd = process.cwd();
const launcherMode = process.env.SGAP_LAUNCHER_MODE ?? 'staging';
const headed = process.env.SGAP_HEADED !== '0';
const specPath = process.env.SGAP_SCG_SPECS ?? 'tests/specs/scg';
const concurrency = Math.max(1, Number(process.env.SGAP_SCG_CONCURRENCY ?? '2') || 2);

/** Manual-test id a spec path targets, for the dashboard row (falls back to 'SCG'). */
const specTestId = (() => {
  const match = specPath.match(/\b(SCG-\d{3})\b/);
  return match?.[1] ?? 'SCG';
})();

function hasChromium(root) {
  if (!root || !existsSync(root)) {
    return false;
  }
  try {
    return readdirSync(root).some(
      (name) => name.startsWith('chromium-') && existsSync(path.join(root, name, 'chrome-win64', 'chrome.exe')),
    );
  } catch {
    return false;
  }
}

function resolveBrowsersPath() {
  const configured = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (hasChromium(configured)) {
    return configured;
  }
  const local = path.join(process.env.LOCALAPPDATA ?? '', 'ms-playwright');
  if (hasChromium(local)) {
    return local;
  }
  return configured;
}

function scratchEnabled(manifest) {
  if (manifest.scratchCard && typeof manifest.scratchCard === 'object') {
    return true;
  }
  const component = (manifest.components ?? []).find((entry) => entry && entry.id === 'scratchCard');
  return Boolean(component && component.enabled);
}

function enumerateGames() {
  const dir = path.join(cwd, 'config', 'manifests');
  const allow = (process.env.SGAP_SCG_GAMES ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  const seen = new Set();
  return readdirSync(dir)
    .filter((file) => file.endsWith('.json') && !file.includes('schema'))
    .map((file) => {
      try {
        return JSON.parse(readFileSync(path.join(dir, file), 'utf8'));
      } catch {
        return undefined;
      }
    })
    .filter((manifest) => manifest && manifest.gameId && scratchEnabled(manifest))
    .map((manifest) => ({ id: manifest.gameId, name: manifest.displayName ?? manifest.gameId }))
    .filter((game) => allow.length === 0 || allow.includes(game.id))
    .filter((game) => (seen.has(game.id) ? false : (seen.add(game.id), true)))
    .sort((a, b) => a.id.localeCompare(b.id));
}

function resolvePlaywrightCli() {
  for (const spec of ['@playwright/test/cli', 'playwright/cli.js', 'playwright/lib/cli/cli.js']) {
    try {
      return require.resolve(spec);
    } catch {
      // try next
    }
  }
  return undefined;
}

/** Playwright JSON → per-test [{ id, title, status, durationMs, error }]. */
function readTestResults(resultsFile) {
  try {
    const report = JSON.parse(readFileSync(resultsFile, 'utf8'));
    const tests = [];
    const visit = (suites) => {
      if (!Array.isArray(suites)) {
        return;
      }
      for (const suite of suites) {
        for (const spec of suite.specs ?? []) {
          for (const test of spec.tests ?? []) {
            const result = test.results?.[test.results.length - 1] ?? {};
            const raw = result.status ?? test.status;
            const status =
              raw === 'expected' ? 'passed' : raw === 'unexpected' ? 'failed' : raw ?? 'failed';
            const idMatch = spec.title.match(/\b([A-Z]{2,}-\d{3})\b/);
            tests.push({
              id: idMatch?.[1] ?? specTestId,
              title: spec.title,
              status,
              durationMs: result.duration,
              error: (result.error?.message ?? '').replace(/\u001b\[[0-9;]*m/g, '').split('\n')[0]?.slice(0, 240),
            });
          }
        }
        visit(suite.suites);
      }
    };
    visit(report.suites);
    return tests;
  } catch {
    return undefined;
  }
}

const games = enumerateGames();
if (games.length === 0) {
  console.error('No scratch-enabled games found in config/manifests.');
  process.exit(1);
}

const browsersPath = resolveBrowsersPath();
const pwCli = resolvePlaywrightCli();

// One lane per game so the dashboard shows all packages (queued → running → done).
const lanes = games.map((game, index) => ({
  id: index + 1,
  category: 'SCG',
  gameId: game.id,
  gameName: game.name,
  project: `scg-${game.id}`,
}));
const laneByGame = new Map(lanes.map((lane) => [lane.gameId, lane]));

const children = new Map(); // laneId -> child process
let shuttingDown = false;

async function stopFromMonitor(body = {}) {
  const all = body.all === true;
  const requested = all
    ? [...children.keys()]
    : Array.isArray(body.workers)
      ? body.workers.map(Number)
      : [];
  const ids = [...new Set(requested.filter((id) => Number.isFinite(id) && id > 0))];
  if (ids.length === 0) {
    return { ok: false, error: 'Specify workers: [..] or all: true' };
  }
  const stopped = [];
  for (const id of ids) {
    const child = children.get(id);
    if (child?.pid) {
      killPidTree(child.pid);
      stopped.push(id);
    }
    monitor.applyEvent({ type: 'lane-end', id, workerId: id, reason: 'stopped' });
  }
  if (all) {
    shuttingDown = true;
  }
  return { ok: true, all, stopped, message: stopped.length ? `Stopped ${stopped.join(', ')}` : 'No active lanes matched' };
}

const monitor = createWorkerMonitorServer({ lanes, onStop: stopFromMonitor });
const bound = await monitor.listen(Number(process.env.SGAP_MONITOR_PORT ?? 3847));
const monitorUrl = bound.url;

console.log('');
console.log('SGAP scratch sweep (monitored)');
console.log('────────────────────────────────────────');
console.log(` launcher    : ${launcherMode}`);
console.log(` games       : ${games.length}`);
console.log(` spec        : ${specPath} (${specTestId})`);
console.log(` concurrency : ${concurrency}`);
console.log(` monitor     : ${monitorUrl}`);
console.log(` reader      : ${monitorUrl}/reader`);
console.log('────────────────────────────────────────');

// Open the Chrome overlay for the dashboard.
const monitorChrome = launchMonitorChrome({ url: monitorUrl, chromeExe: findChromiumExe(browsersPath), screens: [] });
if (monitorChrome?.pid) {
  console.log(` overlay     : Chrome worker monitor (pid ${monitorChrome.pid})`);
}

const startedAt = Date.now();
const sources = [];
const summary = [];

function runGame(game) {
  const lane = laneByGame.get(game.id);
  const allureDir = path.join('allure-results', 'scg', game.id);
  const outBase = path.join('test-results', 'scg-all', game.id);
  mkdirSync(path.join(cwd, allureDir), { recursive: true });
  mkdirSync(path.join(cwd, outBase), { recursive: true });
  const resultsFile = path.join(outBase, 'run-results.json');
  const testKey = `${game.id}:${specTestId}`;

  monitor.applyEvent({
    type: 'roster',
    id: lane.id,
    workerId: lane.id,
    category: 'SCG',
    gameId: game.id,
    gameName: game.name,
    project: lane.project,
    tests: [{ key: testKey, id: specTestId, title: `${specTestId} ${game.name}`, status: 'queued' }],
  });
  monitor.applyEvent({
    type: 'start',
    id: lane.id,
    workerId: lane.id,
    gameId: game.id,
    gameName: game.name,
    test: { key: testKey, id: specTestId, title: `${specTestId} ${game.name}`, status: 'running', startedAt: Date.now() },
  });

  const env = {
    ...process.env,
    SGAP_LAUNCHER_MODE: launcherMode,
    SGAP_GAME_ID: game.id,
    SGAP_ALLURE_DIR: allureDir,
    SGAP_RESULTS_JSON: resultsFile,
    SGAP_CLICK_TRACKER: process.env.SGAP_CLICK_TRACKER ?? '1',
    SGAP_WORKER_MONITOR: '1',
    SGAP_MONITOR_URL: monitorUrl,
    SGAP_WORKER_ID: String(lane.id),
    ...(browsersPath ? { PLAYWRIGHT_BROWSERS_PATH: browsersPath } : {}),
  };
  const testArgs = ['test', specPath, '--project=chromium', '--workers=1', '--retries=0', ...(headed ? ['--headed'] : []), `--output=${outBase}/artifacts`];
  const command = pwCli ? process.execPath : 'npx';
  const args = pwCli ? [pwCli, ...testArgs] : ['playwright', ...testArgs];

  return new Promise((resolve) => {
    if (shuttingDown) {
      resolve();
      return;
    }
    console.log(`START [W${lane.id}] ${game.name} (${game.id})`);
    const child = spawn(command, args, { cwd, env, stdio: 'inherit', windowsHide: false, shell: !pwCli && process.platform === 'win32' });
    children.set(lane.id, child);
    writeLockfile([...children.values()].map((entry) => entry.pid).filter(Boolean));
    child.on('exit', (code) => {
      children.delete(lane.id);
      const tests = readTestResults(path.join(cwd, resultsFile)) ?? [];
      const primary = tests[0];
      const status = primary?.status ?? (code === 0 ? 'passed' : 'failed');
      monitor.applyEvent({
        type: 'end',
        id: lane.id,
        workerId: lane.id,
        gameId: game.id,
        gameName: game.name,
        test: { key: testKey, id: specTestId, title: `${specTestId} ${game.name}`, status, durationMs: primary?.durationMs, error: primary?.error },
      });
      monitor.applyEvent({ type: 'lane-end', id: lane.id, workerId: lane.id });
      if (
        existsSync(path.join(cwd, allureDir)) &&
        readdirSync(path.join(cwd, allureDir)).some((name) => name.endsWith('-result.json'))
      ) {
        sources.push(allureDir);
      }
      summary.push({ game: game.id, status, exit: code ?? -1 });
      console.log(`END   [W${lane.id}] ${game.name} → ${status}`);
      resolve();
    });
  });
}

// Bounded-concurrency pool over the games.
const queue = [...games];
async function worker() {
  while (queue.length > 0 && !shuttingDown) {
    const game = queue.shift();
    await runGame(game);
  }
}

process.on('SIGINT', () => {
  shuttingDown = true;
  for (const child of children.values()) {
    if (child.pid) killPidTree(child.pid);
  }
  stopSgapLeftovers({ excludePid: process.pid });
  clearLockfile();
  process.exit(130);
});

await Promise.all(Array.from({ length: Math.min(concurrency, games.length) }, () => worker()));

stopSgapLeftovers({ excludePid: process.pid });
clearLockfile();

const elapsedMin = Math.round((Date.now() - startedAt) / 60000);
const passed = summary.filter((row) => row.status === 'passed').length;
const failed = summary.filter((row) => row.status === 'failed' || row.status === 'timedOut').length;
const skipped = summary.filter((row) => row.status === 'skipped').length;
console.log('\nScratch sweep summary');
console.log('────────────────────────────────────────');
for (const row of summary.sort((a, b) => a.game.localeCompare(b.game))) {
  console.log(`  ${row.status.toUpperCase().padEnd(8)} ${row.game}`);
}
console.log('────────────────────────────────────────');
console.log(`  totals  passed=${passed} failed=${failed} skipped=${skipped}  (${elapsedMin}m, ${games.length} games)`);

const resolvedSources = [...new Set(sources)].filter((dir) => existsSync(path.join(cwd, dir)));
if (process.env.SGAP_SKIP_ALLURE !== '1' && resolvedSources.length > 0) {
  await publishAllureReport({ sources: resolvedSources });
}

await bound.close();
process.exit(failed > 0 ? 1 : 0);
