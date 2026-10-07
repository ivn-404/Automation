/**
 * Run the Scratch (SCG) suite across every scratch-enabled game on staging, then
 * publish ONE Allure report that covers all games' scratch test cases.
 *
 * How it works:
 *   - Enumerates config/manifests/*.json and keeps the games with scratch enabled.
 *   - For each game, runs `playwright test tests/specs/scg --project=chromium` with
 *     SGAP_GAME_ID set, writing that game's Allure results to its own folder
 *     (allure-results/scg/<gameId>) so nothing clobbers between games.
 *   - Each SCG test already stamps a `gameId` Allure label (via the sgap fixture), so
 *     the merged report groups results by game.
 *   - At the end, generates + opens a single Allure report from every per-game folder.
 *
 * Env:
 *   SGAP_LAUNCHER_MODE  default 'staging'
 *   SGAP_HEADED         default on (set 0 for headless)
 *   SGAP_WORKERS        default 1 (per-game Playwright workers)
 *   SGAP_SCG_GAMES      optional comma-separated gameId allowlist (default: all scratch games)
 *   SGAP_SCG_SPECS      optional spec path/glob (default: tests/specs/scg)
 *   SGAP_SKIP_ALLURE=1  skip the final publish
 */
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { publishAllureReport } from './generate-allure-report.mjs';

const require = createRequire(import.meta.url);
const cwd = process.cwd();
const launcherMode = process.env.SGAP_LAUNCHER_MODE ?? 'staging';
const headed = process.env.SGAP_HEADED !== '0';
const workers = process.env.SGAP_WORKERS ?? '1';
const specPath = process.env.SGAP_SCG_SPECS ?? 'tests/specs/scg';

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
  const games = readdirSync(dir)
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
    .filter((game) => allow.length === 0 || allow.includes(game.id));
  const seen = new Set();
  return games
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

function readStats(resultsFile) {
  try {
    const json = JSON.parse(readFileSync(resultsFile, 'utf8'));
    const stats = json.stats ?? {};
    return {
      passed: stats.expected ?? 0,
      failed: stats.unexpected ?? 0,
      flaky: stats.flaky ?? 0,
      skipped: stats.skipped ?? 0,
    };
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

console.log('');
console.log('SGAP scratch sweep — all games');
console.log('────────────────────────────────────────');
console.log(` launcher : ${launcherMode}`);
console.log(` games    : ${games.length}`);
console.log(` specs    : ${specPath}`);
console.log(` headed   : ${headed}`);
console.log(` workers  : ${workers} per game`);
console.log(` browsers : ${browsersPath ?? '(default)'}`);
console.log(` runner   : ${pwCli ? 'node playwright cli' : 'npx playwright'}`);
console.log('────────────────────────────────────────');

const startedAt = Date.now();
const sources = [];
const summary = [];

for (const [index, game] of games.entries()) {
  const allureDir = path.join('allure-results', 'scg', game.id);
  const outBase = path.join('test-results', 'scg-all', game.id);
  mkdirSync(path.join(cwd, allureDir), { recursive: true });
  mkdirSync(path.join(cwd, outBase), { recursive: true });
  const resultsFile = path.join(outBase, 'run-results.json');

  const env = {
    ...process.env,
    SGAP_LAUNCHER_MODE: launcherMode,
    SGAP_GAME_ID: game.id,
    SGAP_ALLURE_DIR: allureDir,
    SGAP_RESULTS_JSON: resultsFile,
    SGAP_CLICK_TRACKER: process.env.SGAP_CLICK_TRACKER ?? '1',
    ...(browsersPath ? { PLAYWRIGHT_BROWSERS_PATH: browsersPath } : {}),
  };

  const testArgs = ['test', specPath, '--project=chromium', `--workers=${workers}`, ...(headed ? ['--headed'] : [])];
  const label = `[${index + 1}/${games.length}] ${game.name} (${game.id})`;
  console.log(`\n=== ${label} ===`);

  const result = pwCli
    ? spawnSync(process.execPath, [pwCli, ...testArgs], { cwd, stdio: 'inherit', env })
    : spawnSync('npx', ['playwright', ...testArgs], {
        cwd,
        stdio: 'inherit',
        env,
        shell: process.platform === 'win32',
      });

  const stats = readStats(path.join(cwd, resultsFile));
  summary.push({ game: game.id, exit: result.status ?? -1, stats });
  if (existsSync(path.join(cwd, allureDir)) && readdirSync(path.join(cwd, allureDir)).some((n) => n.endsWith('-result.json'))) {
    sources.push(allureDir);
  }
}

const elapsedMin = Math.round((Date.now() - startedAt) / 60000);
let totalPassed = 0;
let totalFailed = 0;
let totalSkipped = 0;
console.log('\nScratch sweep summary');
console.log('────────────────────────────────────────');
for (const row of summary) {
  const s = row.stats;
  if (s) {
    totalPassed += s.passed;
    totalFailed += s.failed;
    totalSkipped += s.skipped;
  }
  const detail = s
    ? `passed=${s.passed} failed=${s.failed}${s.flaky ? ` flaky=${s.flaky}` : ''}${s.skipped ? ` skipped=${s.skipped}` : ''}`
    : `no results (exit ${row.exit})`;
  const flag = !s || s.failed > 0 || row.exit !== 0 ? 'FAIL' : 'PASS';
  console.log(`  ${flag}  ${row.game.padEnd(28)} ${detail}`);
}
console.log('────────────────────────────────────────');
console.log(`  totals  passed=${totalPassed} failed=${totalFailed} skipped=${totalSkipped}  (${elapsedMin}m, ${games.length} games)`);

const resolvedSources = sources.filter((dir) => existsSync(path.join(cwd, dir)));
if (resolvedSources.length > 0) {
  await publishAllureReport({ sources: resolvedSources });
} else {
  console.log('Allure: no per-game result folders to publish.');
}

process.exit(totalFailed > 0 || summary.some((row) => row.exit !== 0) ? 1 : 0);
