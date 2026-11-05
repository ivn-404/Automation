/**
 * Execution manager for the local QA control panel.
 *
 * Every test run gets an id (RUN-0001, RUN-0002, …), its own folder under runs/,
 * its own worker monitor on a free port and the tester's staging players
 * (SGAP_TESTER). Runs execute side by side; a run waits only when this PC lacks
 * the CPU/RAM for its browsers (scripts/lib/host-resources.mjs).
 *
 * Runs execute scripts/run-suite-queue.mjs, the same driver the CLI uses.
 */
import { spawn } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { admit, hostCapacity } from './host-resources.mjs';
import { checkLaunchUrl, createLaunchUrlVault, gameForLaunchUrl, launchUrlFacts } from './launch-url.mjs';
import {
  familyCases,
  familyPanel,
  findSuite,
  loadCatalog,
  loadManifests,
  packageOfGame,
  selectionSuite,
  suiteCases,
  UNREGISTERED_GAME,
  URL_PACKAGE,
} from './qa-suites.mjs';
import { killPidTree } from './sgap-process-guard.mjs';
import { sanitizeTester } from './sgap-tester.mjs';

const MAX_LOG_LINES = 3000;
const ACTIVE = new Set(['queued', 'running']);
export const RUNS_DIR = 'runs';

function runEnvBase() {
  const env = { ...process.env, SGAP_LAUNCHER_MODE: process.env.SGAP_LAUNCHER_MODE ?? 'staging' };
  const defaultBrowsers = path.join(process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local'), 'ms-playwright');
  if (env.PLAYWRIGHT_BROWSERS_PATH === undefined && existsSync(defaultBrowsers)) {
    env.PLAYWRIGHT_BROWSERS_PATH = defaultBrowsers;
  }
  return env;
}

/** Public view of a run (no process handles or log buffers). */
function view(run) {
  const { child, lines, logBase, logStream, laneConfig, launchRef, launchRaw, ...rest } = run;
  return rest;
}

/** Optional pasted game URL from a run request: undefined when none, `{ error }` when refused. */
function planLaunchUrl(body, cwd) {
  if (typeof body.launchUrl !== 'string' || body.launchUrl.trim().length === 0) return undefined;
  const checked = checkLaunchUrl(body.launchUrl, cwd);
  if (!checked.ok) return { error: `Game URL refused: ${checked.reasons.join(' ')}` };
  const device = ['mobile', 'desktop', 'switch'].includes(body.launchDevice) ? body.launchDevice : 'preserve';
  const { gameKey } = launchUrlFacts(body.launchUrl);
  return { raw: body.launchUrl.trim(), redacted: checked.redacted, host: checked.host, lan: checked.lan, device, gameKey };
}

/** Validates a selection against this checkout's catalog and turns it into run-suite-queue arguments. */
function planRun(body, cwd = process.cwd()) {
  const catalog = loadCatalog(cwd);
  const families = Array.isArray(body.families) ? body.families.map(String) : undefined;
  const owned = (families ?? []).filter((id) => familyPanel(catalog, id) !== undefined);
  if (owned.length > 0) {
    return { error: `${owned.join(', ')} runs from its own page (PAD Tester), not the Test runner.` };
  }
  let suite;
  try {
    suite = families !== undefined ? selectionSuite(catalog, families, cwd) : findSuite(catalog, String(body.suite ?? ''), cwd);
  } catch (error) {
    return { error: String(error?.message ?? error) };
  }
  let games = (Array.isArray(body.games) ? body.games : []).map(String).filter((gameId) => packageOfGame(catalog, gameId) !== undefined);
  const launch = planLaunchUrl(body, cwd);
  if (launch?.error) return { error: launch.error };
  if (launch !== undefined) {
    const linked = gameForLaunchUrl(launch.raw, loadManifests(cwd));
    if (linked) games = [linked.gameId];
    else if (!launch.lan || games.length !== 1) games = [UNREGISTERED_GAME];
  }
  if (games.length === 0) return { error: 'Select at least one game.' };
  const packages = [...new Set(games.map((gameId) => packageOfGame(catalog, gameId) ?? URL_PACKAGE))];
  const caseId = typeof body.caseId === 'string' && body.caseId.length > 0 ? body.caseId : undefined;
  if (caseId !== undefined && !suiteCases(suite, cwd).includes(caseId)) {
    return { error: `${caseId} is not part of ${suite.label}.` };
  }
  // Packages run one after another; the widest package sets the browsers held at once.
  const browsers = Math.max(...packages.map((pkg) => games.filter((gameId) => (packageOfGame(catalog, gameId) ?? URL_PACKAGE) === pkg).length));

  const args = ['scripts/run-suite-queue.mjs'];
  if (families !== undefined) args.push('--families', suite.familyIds.join(','));
  else args.push('--suite', suite.id);
  args.push('--packages', packages.join(','), '--games', games.join(','));
  if (caseId) args.push('--case', caseId);
  // A Playwright trace records every URL the page opened, session token included.
  if (body.trace === true && launch === undefined) args.push('--trace');
  if (body.screenshots === false) args.push('--no-screenshots');
  if (body.hideBrowser === true) args.push('--hide-browser');
  if (body.dryRun) args.push('--dry-run');
  return {
    args,
    suite,
    games,
    packages,
    caseId,
    browsers,
    launch,
    label: suite.label + (caseId ? ` · ${caseId}` : '') + (launch ? ` · URL ${launch.gameKey}${games[0] === UNREGISTERED_GAME ? ' (unregistered)' : ''}` : ''),
    families: suite.familyIds ?? suite.categories ?? [],
    gameNames: games,
  };
}

/**
 * Env for PAD runs: the observer runs passive (traffic, console, events and the resource
 * inventory, no HUD scene walks), and no click dots or screenshot toasts inside the measurements.
 */
const PAD_ENV = {
  SGAP_OBSERVE: '1',
  SGAP_OBSERVE_PASSIVE: '1',
  SGAP_OBSERVE_BALANCE_MS: '0',
  SGAP_RESOURCES: '1',
  SGAP_PAD_LIVE_CPU: '1',
  SGAP_CLICK_TRACKER: '0',
  SGAP_SCREENSHOT_TOAST: '0',
};
/** Installed browser channel per PAD Tester choice; `chromium` is Playwright's bundled build. */
const PAD_BROWSERS = { chromium: undefined, chrome: 'chrome', edge: 'msedge' };
/** PAD-053: let the game draw as fast as it can instead of at the display refresh. */
const HEADROOM_ARGS = ['--disable-gpu-vsync', '--disable-frame-rate-limit'];
/** PAD-056 needs a second lane that loads the GPU on the other screen. */
const BUSY_CASE = 'PAD-056';

/**
 * Validates a PAD Tester request: one game, some PAD cases, the screen to play on, browser,
 * headroom and quick options.
 */
function planPadRun(body, cwd = process.cwd()) {
  const catalog = loadCatalog(cwd);
  const manifests = loadManifests(cwd);
  const launch = planLaunchUrl(body, cwd);
  if (launch?.error) return { error: launch.error };
  let gameId = String(body.gameId ?? '');
  if (launch !== undefined) {
    const linked = gameForLaunchUrl(launch.raw, manifests);
    if (linked) gameId = linked.gameId;
    else if (!launch.lan || !manifests.has(gameId)) gameId = UNREGISTERED_GAME;
  }
  const manifest = manifests.get(gameId);
  if (manifest === undefined) return { error: 'Select a game.' };
  if (gameId === UNREGISTERED_GAME && launch === undefined) return { error: 'An unregistered game needs a Game URL.' };
  const discover = gameId === UNREGISTERED_GAME;
  const available = familyCases(catalog, cwd).PAD ?? [];
  const cases = (Array.isArray(body.cases) ? body.cases.map(String) : []).filter((id) => available.includes(id));
  if (cases.length === 0) return { error: 'Select at least one PAD case.' };
  const monitor = Number(body.monitor) === 0 ? 0 : 1;
  const browser = Object.hasOwn(PAD_BROWSERS, body.browser) ? body.browser : 'chromium';
  const channel = PAD_BROWSERS[browser];
  const headroom = body.headroom === true;
  const quick = body.quick === true;
  const deepAssets = body.deepAssets === true;
  if (launch !== undefined && cases.includes(BUSY_CASE)) {
    return { error: `${BUSY_CASE} opens a second game browser; one Game URL session cannot run in two browsers.` };
  }
  const name = manifest.displayName ?? gameId;
  const browserFields = {
    ...(channel !== undefined ? { channel } : {}),
    ...(headroom ? { browserArgs: HEADROOM_ARGS } : {}),
  };
  const lanes = [
    {
      id: 1,
      gameId,
      gameName: name,
      category: 'PAD',
      categories: ['PAD'],
      testMatch: [...(discover ? ['discovery/DISC-001*.spec.ts'] : []), ...cases.map((id) => `pad/${id}*.spec.ts`)],
      playerId: `${name}_PAD`,
      monitor,
      slot: 0,
      ...browserFields,
    },
  ];
  if (cases.includes(BUSY_CASE)) {
    lanes.push({
      id: 2,
      gameId,
      gameName: name,
      category: 'PAD-LOAD',
      categories: ['PAD-LOAD'],
      testMatch: ['pad-load/BUSY-056*.spec.ts'],
      playerId: `${name}_PADBUSY`,
      monitor: monitor === 0 ? 1 : 0,
      slot: 0,
      ...(channel !== undefined ? { channel } : {}),
    });
  }
  const options = [
    browser !== 'chromium' ? browser : '',
    headroom ? 'headroom' : '',
    quick ? 'quick' : '',
    deepAssets ? 'deep asset inspection' : '',
    launch ? `Game URL on ${launch.host}` : '',
    discover ? `unregistered ${launch.gameKey ?? 'game'}: discovery first` : '',
  ].filter(Boolean);
  return {
    gameId,
    gameName: name,
    cases,
    monitor,
    browser,
    headroom,
    quick,
    deepAssets,
    launch,
    laneConfig: {
      kind: 'pad',
      workers: lanes.length,
      layout: String(lanes.length),
      notes: `PAD Tester run: ${cases.join(', ')} on ${name}, screen ${monitor + 1}${options.length > 0 ? ` (${options.join(', ')})` : ''}.`,
      defaultBalance: 15000,
      defaultBetLimit: 15000,
      minimumBetBalance: 100,
      lanes,
    },
  };
}

/** Folds one line of run-suite-queue output into a run's progress fields. */
function trackProgress(run, line) {
  const progress = line.match(/^#+ \[(\d+)\/(\d+)\] Package (\S+)/u);
  if (progress) {
    run.packageIndex = Number(progress[1]);
    run.packageCount = Number(progress[2]);
    run.currentPackage = progress[3];
    run.monitorUrl = undefined;
  }
  const monitor = line.match(/^\s*monitor\s*:\s*(http:\/\/127\.0\.0\.1:\d+)\s*$/u);
  if (monitor) run.monitorUrl = monitor[1];
}

export function createExecutionManager({ cwd = process.cwd(), config }) {
  const root = path.join(cwd, RUNS_DIR);
  const indexFile = path.join(root, 'index.json');
  const activeFile = path.join(root, 'active.json');
  mkdirSync(root, { recursive: true });

  /** @type {Map<string, any>} insertion order = submission order */
  const runs = new Map();
  const vault = createLaunchUrlVault();
  let nextNumber = 1;

  // Restore history; runs this PC was executing are gone now.
  if (existsSync(indexFile)) {
    try {
      const saved = JSON.parse(readFileSync(indexFile, 'utf8'));
      nextNumber = Number(saved.next) || 1;
      for (const entry of saved.runs ?? []) {
        if (ACTIVE.has(entry.state)) {
          entry.state = 'interrupted';
          entry.note = 'The control panel restarted while this run was active.';
          entry.endedAt ??= Date.now();
        }
        runs.set(entry.id, { ...entry, lines: [], logBase: 0 });
      }
    } catch {
      // Corrupt index: start a fresh history, keep run folders on disk.
    }
  }

  function persist() {
    const keep = Math.max(10, Number(config.keepFinishedRuns) || 200);
    const all = [...runs.values()];
    const finished = all.filter((run) => !ACTIVE.has(run.state));
    for (const old of finished.slice(0, Math.max(0, finished.length - keep))) {
      runs.delete(old.id);
    }
    const tmp = `${indexFile}.tmp`;
    writeFileSync(tmp, `${JSON.stringify({ next: nextNumber, runs: [...runs.values()].map(view) }, null, 2)}\n`, 'utf8');
    renameSync(tmp, indexFile);
    // Lets host-wide browser sweeps (CLI runs, stop-sgap-browsers) leave managed runs alone.
    const pids = [...runs.values()].filter((run) => run.state === 'running' && run.pid).map((run) => run.pid);
    writeFileSync(activeFile, `${JSON.stringify({ panelPid: process.pid, pids }, null, 2)}\n`, 'utf8');
  }

  /** Run fields for a pasted Game URL: the redacted form is public, the vault reference is not. */
  function launchFields(runId, launch) {
    if (launch === undefined) return {};
    return {
      launchUrl: launch.redacted,
      launchHost: launch.host,
      launchLan: launch.lan,
      launchDevice: launch.device,
      launchGameKey: launch.gameKey,
      launchRef: vault.put(runId, launch.raw),
    };
  }

  function inUse() {
    const running = [...runs.values()].filter((run) => run.state === 'running');
    return { runs: running.length, browsers: running.reduce((sum, run) => sum + run.browsers, 0) };
  }

  function pushLog(run, line) {
    run.lines.push(line);
    if (run.lines.length > MAX_LOG_LINES) {
      const drop = run.lines.length - MAX_LOG_LINES;
      run.lines = run.lines.slice(drop);
      run.logBase += drop;
    }
    trackProgress(run, line);
  }

  function openRunLog(run) {
    const dir = path.join(root, run.id);
    mkdirSync(dir, { recursive: true });
    run.dir = path.relative(cwd, dir).replace(/\\/g, '/');
    run.logFile = `${run.dir}/run.log`;
    run.logStream = createWriteStream(path.join(dir, 'run.log'), { flags: 'a' });
    return dir;
  }

  function start(run) {
    const dir = openRunLog(run);
    run.state = 'running';
    run.startedAt = Date.now();
    run.queueReason = undefined;
    const env = {
      ...runEnvBase(),
      SGAP_RUN_ID: run.id,
      SGAP_RUN_DIR: dir,
      SGAP_RUN_OWNER: run.owner,
      SGAP_TESTER: run.tester,
      SGAP_MONITOR_PORT: '0',
      SGAP_MONITOR_OVERLAY: '0',
      SGAP_SKIP_ALLURE_OPEN: '1',
      ...(run.kind === 'pad' ? { ...PAD_ENV, SGAP_PARALLEL_CONFIG: path.join(dir, 'pad-lanes.json') } : {}),
      ...(run.kind === 'pad' && run.quick ? { SGAP_PAD_QUICK: '1' } : {}),
      ...(run.kind === 'pad' && run.deepAssets ? { SGAP_RESOURCES_HASH: '1' } : {}),
      ...(run.launchRef
        ? {
            SGAP_LAUNCH_URL_REF: run.launchRef,
            SGAP_LAUNCH_URL_LAN: run.launchLan ? '1' : '0',
            SGAP_LAUNCH_DEVICE: run.launchDevice ?? 'preserve',
            SGAP_DISCOVERY_DIR: path.join(dir, 'discovery'),
            ...(run.launchGameKey ? { SGAP_LAUNCH_GAME_KEY: run.launchGameKey } : {}),
          }
        : {}),
    };
    if (run.kind === 'pad') {
      writeFileSync(path.join(dir, 'pad-lanes.json'), `${JSON.stringify(run.laneConfig, null, 2)}\n`, 'utf8');
    }
    pushLog(run, `$ node ${run.args.join(' ')}   [${run.id} · ${run.owner} · players *_${run.tester}]`);
    const child = spawn(process.execPath, run.args, { cwd, env, windowsHide: true });
    run.child = child;
    run.pid = child.pid;
    let pending = '';
    const onData = (chunk) => {
      run.logStream.write(chunk);
      pending += chunk.toString('utf8').replace(/\u001b\[[0-9;]*m/g, '');
      const parts = pending.split(/\r?\n/u);
      pending = parts.pop() ?? '';
      for (const line of parts) pushLog(run, line);
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('error', (error) => pushLog(run, `Failed to start: ${error.message}`));
    child.on('close', (code) => {
      if (pending.length > 0) pushLog(run, pending);
      run.logStream.end();
      run.child = undefined;
      run.monitorUrl = undefined;
      run.endedAt = Date.now();
      run.exitCode = code;
      const urlRun = Boolean(run.launchRef);
      vault.release(run.id);
      run.launchRef = undefined;
      if (run.state === 'running') run.state = code === 0 ? 'passed' : code === 3 && urlRun ? 'calibration' : 'failed';
      persist();
      schedule();
    });
    persist();
  }

  /** Starts every queued run that fits, oldest first; smaller runs may pass a run that is still waiting for room. */
  function schedule() {
    for (const run of runs.values()) {
      if (run.state !== 'queued') continue;
      const decision = admit(config, run.browsers, inUse());
      if (decision.ok) {
        start(run);
      } else {
        run.queueReason = decision.reason;
      }
    }
  }

  const timer = setInterval(() => {
    if ([...runs.values()].some((run) => run.state === 'queued')) schedule();
  }, 10_000);
  timer.unref();

  return {
    capacity() {
      return hostCapacity(config, inUse());
    },
    list() {
      return [...runs.values()].map(view).reverse();
    },
    get(id) {
      const run = runs.get(id);
      return run ? view(run) : undefined;
    },
    monitorUrl(id) {
      return runs.get(id)?.monitorUrl;
    },
    /** Raw Game URL for a worker of an active run; undefined once the run has ended. */
    launchUrl(ref) {
      return vault.take(ref);
    },
    log(id, since = 0) {
      const run = runs.get(id);
      if (!run) return undefined;
      const startAt = Math.max(0, since - run.logBase);
      return { from: run.logBase + startAt, next: run.logBase + run.lines.length, lines: run.lines.slice(startAt) };
    },
    /**
     * @param {{ name: string }} user
     * @returns {{ status: number, body: object }}
     */
    submit(user, body) {
      const planned = planRun(body, cwd);
      if (planned.error) return { status: 400, body: { ok: false, error: planned.error } };
      const measuring = [...runs.values()].find((run) => run.kind === 'pad' && ACTIVE.has(run.state));
      if (measuring && !planned.args.includes('--dry-run')) {
        return {
          status: 409,
          body: { ok: false, error: `${measuring.id} (PAD Tester) is measuring FPS and needs this PC to itself. Start after it finishes.` },
        };
      }
      const tester = sanitizeTester(user.name) || 'host';
      const clash = [...runs.values()].find(
        (run) => ACTIVE.has(run.state) && run.tester === tester && run.games.some((gameId) => planned.games.includes(gameId)),
      );
      if (clash) {
        const shared = clash.games.filter((gameId) => planned.games.includes(gameId));
        return {
          status: 409,
          body: {
            ok: false,
            error: `${clash.id} (${clash.state}) already uses your staging players for ${shared.join(', ')}. One player cannot run two tests at once — wait for it, stop it, or pick other games.`,
          },
        };
      }
      const decision = planned.args.includes('--dry-run') ? { ok: true } : admit(config, planned.browsers, inUse());
      if (!decision.ok && (decision.permanent || config.whenFull === 'reject')) {
        return { status: 503, body: { ok: false, error: decision.reason } };
      }
      const id = `RUN-${String(nextNumber).padStart(4, '0')}`;
      nextNumber += 1;
      const run = {
        id,
        owner: user.name,
        tester,
        label: planned.label,
        suite: planned.suite.id,
        families: planned.families,
        games: planned.games,
        packages: planned.packages,
        caseId: planned.caseId,
        browsers: planned.browsers,
        dryRun: planned.args.includes('--dry-run'),
        args: planned.args,
        ...launchFields(id, planned.launch),
        state: 'queued',
        queuedAt: Date.now(),
        lines: [],
        logBase: 0,
      };
      runs.set(id, run);
      if (decision.ok) start(run);
      else {
        run.queueReason = decision.reason;
        persist();
      }
      return { status: 200, body: { ok: true, run: view(run) } };
    },
    /**
     * PAD Tester run: one game in one browser through the worker monitor. Never queued
     * behind or beside other runs — a second game shares the GPU and skews the FPS.
     */
    submitPad(user, body) {
      const planned = planPadRun(body, cwd);
      if (planned.error) return { status: 400, body: { ok: false, error: planned.error } };
      const busy = [...runs.values()].filter((run) => ACTIVE.has(run.state));
      if (busy.length > 0) {
        return {
          status: 409,
          body: {
            ok: false,
            error: `${busy.map((run) => run.id).join(', ')} still running. FPS is only trustworthy with nothing else on this PC — wait for it or stop it first.`,
          },
        };
      }
      const id = `RUN-${String(nextNumber).padStart(4, '0')}`;
      nextNumber += 1;
      const run = {
        id,
        kind: 'pad',
        owner: user.name,
        tester: sanitizeTester(user.name) || 'host',
        label: `PAD · ${planned.cases.length === 1 ? planned.cases[0] : `${planned.cases.length} cases`} · ${planned.gameName}${planned.launch ? ` · URL ${planned.launch.host}` : ''}`,
        suite: 'pad',
        families: ['PAD'],
        games: [planned.gameId],
        packages: [],
        cases: planned.cases,
        monitor: planned.monitor,
        browser: planned.browser,
        headroom: planned.headroom,
        quick: planned.quick,
        deepAssets: planned.deepAssets,
        ...launchFields(id, planned.launch),
        laneConfig: planned.laneConfig,
        browsers: planned.laneConfig.lanes.length,
        args: ['scripts/run-parallel-workers.mjs'],
        state: 'queued',
        queuedAt: Date.now(),
        lines: [],
        logBase: 0,
      };
      runs.set(id, run);
      start(run);
      return { status: 200, body: { ok: true, run: view(run) } };
    },
    stop(user, id) {
      const run = runs.get(id);
      if (!run) return { status: 404, body: { ok: false, error: `${id} not found.` } };
      if (run.state === 'queued') {
      run.state = 'stopped';
      run.endedAt = Date.now();
      vault.release(run.id);
      run.launchRef = undefined;
      run.note = `Removed from the queue by ${user.name}.`;
        persist();
        return { status: 200, body: { ok: true } };
      }
      if (run.state !== 'running') return { status: 409, body: { ok: false, error: `${id} is not running.` } };
      run.state = 'stopped';
      run.note = `Stopped by ${user.name}.`;
      pushLog(run, `■ Stop requested by ${user.name} — ending ${id} and closing its browsers…`);
      if (run.pid) killPidTree(run.pid);
      return { status: 200, body: { ok: true } };
    },
    stopAll() {
      for (const run of runs.values()) {
        if (run.state === 'running' && run.pid) killPidTree(run.pid);
      }
    },
  };
}
