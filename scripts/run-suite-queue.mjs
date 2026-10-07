/**
 * Run a test selection from config/qa-suites.json for a QUEUE of packages,
 * back-to-back and unattended, each package through the worker monitor (its
 * selected games side by side). Per-package Allure is generated without popups;
 * at the end one combined report across every queued package is published and
 * the history index opens.
 *
 * What to run — a preset suite or test families (PEN only when named):
 *   --suite scg                         preset from qa-suites.json suites
 *   --families CSF,BC,UIDS              families; @regression = every regression family
 *   --selection config/qa-selections/x.json   { families | suite, games, packages, environment }
 *
 * Where to run it:
 *   --packages 1,2                      every game of these packages
 *   --games felice-in-space,mars-triumph   only these games (packages derived)
 *   --environment STG                   launcher environment (STG | LOCAL)
 *
 * Options:
 *   --case CSF-003                      one case of the selection
 *   --hide-browser                      run the game windows off-screen (unattended runs); visible by default
 *   --trace                             keep Playwright traces for failed tests
 *   --no-screenshots                    skip Playwright failure screenshots
 *   --dry-run                           only write lane configs
 *
 *   node scripts/run-suite-queue.mjs --families CSF --games felice-in-space,mars-triumph
 *   node scripts/run-suite-queue.mjs --suite regression --packages 1
 */
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';

import { publishAllureReport } from './generate-allure-report.mjs';
import {
  findSuite,
  launcherModeFor,
  loadCatalog,
  loadManifests,
  packageOfGame,
  selectionSuite,
  suiteCases,
  writeLaneConfig,
} from './lib/qa-suites.mjs';
import { allureResultsRoot, isManagedRun, runId } from './lib/sgap-run-paths.mjs';

const cwd = process.cwd();

function argValue(flag) {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function listArg(value) {
  if (value === undefined) return undefined;
  const items = (Array.isArray(value) ? value : String(value).split(',')).map((item) => String(item).trim()).filter(Boolean);
  return items.length > 0 ? items : undefined;
}

const catalog = loadCatalog(cwd);
const selectionFile = argValue('--selection');
const selection = selectionFile ? JSON.parse(readFileSync(path.resolve(cwd, selectionFile), 'utf8')) : {};

const familyTokens = listArg(argValue('--families')) ?? listArg(selection.families);
const suiteId = argValue('--suite') ?? selection.suite;
if (familyTokens !== undefined && suiteId !== undefined) {
  console.error('SGAP: pass either --suite or --families, not both.');
  process.exit(2);
}
let suite;
try {
  suite = familyTokens !== undefined ? selectionSuite(catalog, familyTokens, cwd) : findSuite(catalog, suiteId ?? 'scg', cwd);
} catch (error) {
  console.error(`SGAP: ${error.message}`);
  process.exit(2);
}

const games = listArg(argValue('--games')) ?? listArg(selection.games);
for (const gameId of games ?? []) {
  if (packageOfGame(catalog, gameId) === undefined) {
    console.error(`SGAP: game "${gameId}" is not in any package of config/qa-suites.json.`);
    process.exit(2);
  }
}
const packagesArg = listArg(argValue('--packages')) ?? listArg(selection.packages);
const queue = packagesArg
  ?? (games !== undefined
    ? Object.keys(catalog.packages).filter((pkg) => games.some((gameId) => packageOfGame(catalog, gameId) === pkg))
    : suite.defaultPackages);
const caseId = argValue('--case')?.trim() || undefined;
if (caseId !== undefined && !suiteCases(suite, cwd).includes(caseId)) {
  console.error(`SGAP: ${caseId} is not part of ${suite.label}.`);
  process.exit(2);
}
const dryRun = process.argv.includes('--dry-run');
let launcherMode;
try {
  launcherMode = launcherModeFor(catalog, argValue('--environment') ?? selection.environment);
} catch (error) {
  console.error(`SGAP: ${error.message}`);
  process.exit(2);
}
const hideBrowser = process.argv.includes('--hide-browser') || selection.hideBrowser === true;
const trace = process.argv.includes('--trace') || selection.trace === true;
const screenshots = !(process.argv.includes('--no-screenshots') || selection.screenshots === false);

function hasResults(dir) {
  try {
    return readdirSync(dir).some((name) => name.endsWith('-result.json'));
  } catch {
    return false;
  }
}

const familyIds = suite.familyIds ?? suite.categories ?? [];
const groupOf = (id) => catalog.families[id]?.group;
const regressionPicked = familyIds.filter((id) => groupOf(id) === 'regression');
const securityPicked = familyIds.filter((id) => groupOf(id) === 'security');
const otherPicked = familyIds.filter((id) => groupOf(id) !== 'regression' && groupOf(id) !== 'security');

console.log('');
console.log('SGAP suite queue');
console.log('────────────────────────────────────────');
console.log(` suite      : ${suite.label}${caseId ? ` — ${caseId} only` : ''}`);
console.log(` regression : ${regressionPicked.join(', ') || '—'}`);
console.log(` security   : ${securityPicked.join(', ') || '— (PEN not selected)'}`);
if (otherPicked.length > 0) console.log(` other      : ${otherPicked.join(', ')}`);
if (suite.manualOnly?.length > 0) console.log(` manual only: ${suite.manualOnly.join(', ')} (no automated cases, skipped)`);
console.log(` games      : ${games ? games.join(', ') : 'every game of the queued packages'}`);
console.log(` queue      : packages ${queue.join(', ')}`);
console.log(` environment: ${launcherMode ?? process.env.SGAP_LAUNCHER_MODE ?? 'staging'}`);
console.log(` browser    : ${hideBrowser ? 'hidden off-screen' : 'visible'} · failure screenshots ${screenshots ? 'on' : 'off'} · trace ${trace ? 'retain-on-failure' : 'off'}`);
console.log(` each       : games side by side via worker monitor${dryRun ? ' (DRY RUN — nothing launched)' : ''}`);
console.log('────────────────────────────────────────');

const manifests = loadManifests(cwd);
const managed = isManagedRun();
const accumRoot = managed
  ? path.join(allureResultsRoot(), 'combined')
  : path.join('allure-results', `queue-${suite.id}${caseId ? `-${caseId.toLowerCase()}` : ''}`);
if (!dryRun) {
  rmSync(path.resolve(cwd, accumRoot), { recursive: true, force: true });
  mkdirSync(path.resolve(cwd, accumRoot), { recursive: true });
}

const runEnv = {
  ...process.env,
  ...(launcherMode ? { SGAP_LAUNCHER_MODE: launcherMode } : {}),
  SGAP_BROWSER_VIEW: hideBrowser ? 'hidden' : 'visible',
  SGAP_SCREENSHOT: screenshots ? 'only-on-failure' : 'off',
  ...(trace ? { SGAP_TRACE: 'retain-on-failure' } : {}),
  SGAP_SKIP_ALLURE_OPEN: '1',
};

const combinedSources = [];
const summary = [];
const startedAt = Date.now();
let environmentPlaced = false;

for (const [index, pkg] of queue.entries()) {
  console.log(`\n######## [${index + 1}/${queue.length}] Package ${pkg} ########`);

  let configPath;
  try {
    configPath = writeLaneConfig({
      catalog,
      suite,
      pkg,
      caseId,
      games,
      includeEnvironment: !environmentPlaced,
      cwd,
      manifests,
    });
  } catch (error) {
    console.error(`Package ${pkg}: ${error.message}; skipping.`);
    summary.push({ pkg, exit: -1, note: 'config generation failed' });
    continue;
  }
  if (configPath === undefined) {
    console.log(`Package ${pkg}: no selected game has a case to run; skipping.`);
    summary.push({ pkg, exit: 0, note: 'nothing selected' });
    continue;
  }
  environmentPlaced = true;
  const lanes = JSON.parse(readFileSync(path.resolve(cwd, configPath), 'utf8')).lanes;
  console.log(`Lane config: ${configPath}`);
  for (const lane of lanes) {
    console.log(`  W${lane.id} ${lane.gameName}: ${lane.testMatch.join(' ')}`);
  }

  if (dryRun) {
    summary.push({ pkg, exit: 0, note: 'dry run' });
    continue;
  }

  const packageStarted = Date.now();
  const run = spawnSync(process.execPath, ['scripts/run-parallel-workers.mjs'], {
    cwd,
    stdio: 'inherit',
    env: { ...runEnv, SGAP_PARALLEL_CONFIG: configPath },
  });
  summary.push({ pkg, exit: run.status ?? -1, minutes: (Date.now() - packageStarted) / 60000 });

  // Keep this package's results before the next package resets the lane folders (w1..wN).
  const laneRoot = allureResultsRoot();
  const laneDirs = existsSync(laneRoot) ? readdirSync(laneRoot).filter((name) => /^w\d+$/u.test(name)) : [];
  for (const name of laneDirs) {
    const src = path.join(laneRoot, name);
    if (hasResults(src)) {
      const dest = path.resolve(cwd, accumRoot, `pkg${pkg}`, name);
      mkdirSync(dest, { recursive: true });
      cpSync(src, dest, { recursive: true });
      combinedSources.push(path.join(accumRoot, `pkg${pkg}`, name));
    }
  }
}

const elapsedMin = ((Date.now() - startedAt) / 60000).toFixed(1);
console.log('\nQueue summary');
console.log('────────────────────────────────────────');
for (const row of summary) {
  const minutes = row.minutes !== undefined ? ` ${row.minutes.toFixed(1)}m` : '';
  console.log(`  Package ${String(row.pkg).padEnd(3)} exit=${row.exit}${minutes}${row.note ? ` (${row.note})` : ''}`);
}
console.log('────────────────────────────────────────');
console.log(`  ${queue.length} packages in ${elapsedMin}m`);

if (combinedSources.length > 0) {
  console.log(`\nAllure: building ONE combined report across packages ${queue.join(', ')}`);
  if (managed) {
    // Several runs publish concurrently: own folder per run, no shared allure-report/ shortcut,
    // no browser popping up on the host (the control panel links to /allure/).
    await publishAllureReport({ sources: combinedSources, runId: runId(), latestShortcut: false, owner: process.env.SGAP_RUN_OWNER, label: suite.label });
  } else {
    delete process.env.SGAP_SKIP_ALLURE_OPEN;
    await publishAllureReport({ sources: combinedSources });
  }
} else if (!dryRun) {
  console.log('Allure: no results accumulated to publish.');
}

process.exit(summary.some((row) => row.exit !== 0) ? 1 : 0);
