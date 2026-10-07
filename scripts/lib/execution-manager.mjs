/**
 * Execution manager for the shared QA control panel.
 *
 * Every test run gets an id (RUN-0001, RUN-0002, …), its own folder under runs/,
 * its own worker monitor on a free port and its owner's staging players
 * (SGAP_TESTER = account name). Any number of runs execute side by side; a run
 * waits only when this host lacks the CPU/RAM for its browsers
 * (scripts/lib/host-resources.mjs) — never because of who or how many people
 * are using the panel.
 *
 * Runs execute scripts/run-suite-queue.mjs, the same driver the CLI uses.
 */
import { spawn } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { admit, hostCapacity } from './host-resources.mjs';
import { findSuite, loadCatalog, packageOfGame, selectionSuite, suiteCases } from './qa-suites.mjs';
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
  const { child, lines, logBase, logStream, ...rest } = run;
  return rest;
}

export function createExecutionManager({ cwd = process.cwd(), config }) {
  const root = path.join(cwd, RUNS_DIR);
  const indexFile = path.join(root, 'index.json');
  const activeFile = path.join(root, 'active.json');
  mkdirSync(root, { recursive: true });

  /** @type {Map<string, any>} insertion order = submission order */
  const runs = new Map();
  let nextNumber = 1;

  // Restore history; anything that was live when the panel stopped is gone now.
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

  /** Validates a selection and turns it into run-suite-queue arguments. */
  function plan(body) {
    const catalog = loadCatalog(cwd);
    const families = Array.isArray(body.families) ? body.families.map(String) : undefined;
    let suite;
    try {
      suite = families !== undefined ? selectionSuite(catalog, families, cwd) : findSuite(catalog, String(body.suite ?? ''), cwd);
    } catch (error) {
      return { error: String(error?.message ?? error) };
    }
    const games = (Array.isArray(body.games) ? body.games : []).map(String).filter((gameId) => packageOfGame(catalog, gameId) !== undefined);
    if (games.length === 0) return { error: 'Select at least one game.' };
    const packages = Object.keys(catalog.packages).filter((pkg) => games.some((gameId) => packageOfGame(catalog, gameId) === pkg));
    const caseId = typeof body.caseId === 'string' && body.caseId.length > 0 ? body.caseId : undefined;
    if (caseId !== undefined && !suiteCases(suite, cwd).includes(caseId)) {
      return { error: `${caseId} is not part of ${suite.label}.` };
    }
    // Packages run one after another; the widest package sets the browsers held at once.
    const browsers = Math.max(...packages.map((pkg) => games.filter((gameId) => packageOfGame(catalog, gameId) === pkg).length));

    const args = ['scripts/run-suite-queue.mjs'];
    if (families !== undefined) args.push('--families', suite.familyIds.join(','));
    else args.push('--suite', suite.id);
    args.push('--packages', packages.join(','), '--games', games.join(','));
    if (caseId) args.push('--case', caseId);
    if (body.trace === true) args.push('--trace');
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
      label: suite.label + (caseId ? ` · ${caseId}` : ''),
      families: suite.familyIds ?? suite.categories ?? [],
      gameNames: games,
    };
  }

  function start(run) {
    const dir = path.join(root, run.id);
    mkdirSync(dir, { recursive: true });
    run.dir = path.relative(cwd, dir).replace(/\\/g, '/');
    run.logFile = `${run.dir}/run.log`;
    run.logStream = createWriteStream(path.join(dir, 'run.log'), { flags: 'a' });
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
    };
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
      if (run.state === 'running') run.state = code === 0 ? 'passed' : 'failed';
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
    log(id, since = 0) {
      const run = runs.get(id);
      if (!run) return undefined;
      const startAt = Math.max(0, since - run.logBase);
      return { from: run.logBase + startAt, next: run.logBase + run.lines.length, lines: run.lines.slice(startAt) };
    },
    /**
     * @param {{ name: string, role: string }} user
     * @returns {{ status: number, body: object }}
     */
    submit(user, body) {
      const planned = plan(body);
      if (planned.error) return { status: 400, body: { ok: false, error: planned.error } };
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
    /** Owners stop their own runs; admins stop any. */
    stop(user, id) {
      const run = runs.get(id);
      if (!run) return { status: 404, body: { ok: false, error: `${id} not found.` } };
      if (run.owner !== user.name && user.role !== 'admin') {
        return { status: 403, body: { ok: false, error: `${id} belongs to ${run.owner}; only they or an admin can stop it.` } };
      }
      if (run.state === 'queued') {
        run.state = 'stopped';
        run.endedAt = Date.now();
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
