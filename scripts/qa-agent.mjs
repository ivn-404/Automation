/**
 * SGAP agent: runs a tester's tests on their own PC for the shared QA server.
 *
 * The tester keeps using the server's dashboard. "Run on: My PC" queues the run for
 * this agent, which polls the server, receives only the test selection (suite or
 * families, games, case, evidence options), plans it against this checkout's catalog
 * and runs scripts/run-suite-queue.mjs here: visible browsers, worker monitor
 * windows, terminal output and the Allure report all stay on this PC. The log and
 * the live worker status go back to the dashboard. The server can never send a
 * command line, a file or anything else to run.
 *
 * Usage:
 *   node scripts/qa-agent.mjs setup --server http://<server>:3850   sign in once, start at logon
 *   node scripts/qa-agent.mjs                                       run (the logon launcher does this)
 *   node scripts/qa-agent.mjs remove                                forget the server, stop starting at logon
 *
 * Normally installed by SGAP-setup.cmd, downloaded from the dashboard ("Set up my PC").
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';

import { planRun, runEnvBase } from './lib/execution-manager.mjs';
import { admit, loadServerConfig } from './lib/host-resources.mjs';
import { cleanMachine } from './lib/qa-users.mjs';
import { killPidTree } from './lib/sgap-process-guard.mjs';

const cwd = process.cwd();
const SGAP_DIR = path.join(cwd, '.sgap');
const CONFIG_FILE = path.join(SGAP_DIR, 'agent.json');
const LOCK_FILE = path.join(SGAP_DIR, 'agent.lock');
const RUNS_ROOT = path.join(cwd, 'runs', 'agent');
const ACTIVE_FILE = path.join(RUNS_ROOT, 'active.json');
const STARTUP_DIR = path.join(process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup');
const LAUNCHER = path.join(STARTUP_DIR, 'SGAP Agent.cmd');

const POLL_MS = 2000;
const FLUSH_MS = 1000;
const STATUS_MS = 3000;
const MAX_STATUS_BYTES = 500_000;

const args = process.argv.slice(2);
const command = args[0] && !args[0].startsWith('--') ? args[0] : 'run';
const flag = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return undefined;
  }
}

function writeJson(file, value) {
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  renameSync(tmp, file);
}

function normalizeServer(raw) {
  try {
    const url = new URL(String(raw ?? '').trim());
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
    return url.origin;
  } catch {
    return undefined;
  }
}

function machineName() {
  return cleanMachine(process.env.COMPUTERNAME ?? os.hostname()) ?? 'PC';
}

function version() {
  const head = spawnSync('git', ['rev-parse', '--short', 'HEAD'], { cwd, encoding: 'utf8', windowsHide: true });
  return head.status === 0 ? head.stdout.trim() : undefined;
}

async function post(server, route, body, token) {
  const response = await fetch(`${server}${route}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body ?? {}),
    signal: AbortSignal.timeout(10_000),
  });
  const data = await response.json().catch(() => ({}));
  return { status: response.status, data };
}

/** One reader for all questions, so typed-ahead or piped answers are not lost between prompts. */
let reader;
function lineReader() {
  if (reader === undefined) {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: Boolean(process.stdin.isTTY && process.stdout.isTTY) });
    rl.muted = false;
    // Password entry echoes "*" (readline redraws the whole line as prompt + text).
    rl._writeToOutput = (text) => {
      if (!rl.muted) {
        process.stdout.write(text);
        return;
      }
      const promptText = rl.getPrompt();
      if (text.startsWith(promptText)) process.stdout.write(promptText + '*'.repeat(rl.line.length));
      else if (!/^\r?\n$/u.test(text)) process.stdout.write('*'.repeat(text.length));
    };
    reader = { rl, lines: rl[Symbol.asyncIterator]() };
  }
  return reader;
}

async function ask(question, { hidden = false } = {}) {
  const { rl, lines } = lineReader();
  rl.setPrompt(question);
  rl.muted = hidden;
  rl.prompt();
  const next = await lines.next();
  rl.muted = false;
  if (hidden) process.stdout.write('\n');
  if (next.done) {
    console.error('\nNo answer received.');
    process.exit(1);
  }
  return String(next.value).trim();
}

function closeReader() {
  reader?.rl.close();
  reader = undefined;
}

// ── setup / remove ─────────────────────────────────────────────────────────────

function installLauncher() {
  if (process.platform !== 'win32') return undefined;
  mkdirSync(STARTUP_DIR, { recursive: true });
  const script = [
    '@echo off',
    'title SGAP Agent',
    `cd /d "${cwd}"`,
    'echo Updating SGAP...',
    'git pull --ff-only',
    'call npx --yes pnpm install --prefer-offline',
    'node scripts\\qa-agent.mjs',
    'if errorlevel 1 pause',
    '',
  ].join('\r\n');
  writeFileSync(LAUNCHER, script, 'utf8');
  return LAUNCHER;
}

function startLauncher() {
  spawn('cmd.exe', ['/d', '/c', `start "SGAP Agent" "${LAUNCHER}"`], {
    detached: true,
    stdio: 'ignore',
    windowsVerbatimArguments: true,
  }).unref();
}

async function setup() {
  const existing = readJson(CONFIG_FILE);
  let server = normalizeServer(flag('--server') ?? existing?.server);
  while (server === undefined) {
    server = normalizeServer(await ask('SGAP server address (e.g. http://192.168.0.196:3850): '));
  }
  const machine = machineName();
  console.log(`\nConnecting this PC (${machine}) to ${server}`);
  console.log('Sign in with the SGAP account your admin gave you.\n');
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const name = await ask('Account name: ');
    const password = await ask('Password: ', { hidden: true });
    let result;
    try {
      result = await post(server, '/api/qa/agent/register', { name, password, machine });
    } catch (error) {
      console.error(`Cannot reach ${server}: ${error.message}. Is the SGAP server running, and is this PC on the same network?`);
      process.exit(1);
    }
    if (result.status === 200 && result.data.ok) {
      closeReader();
      writeJson(CONFIG_FILE, { server, name: result.data.user.name, machine: result.data.machine, token: result.data.token });
      console.log(`\nSigned in as ${result.data.user.name}. Runs you start with "Run on: My PC" will run here.`);
      if (args.includes('--no-startup')) return;
      const launcher = installLauncher();
      if (launcher) {
        console.log('The SGAP Agent now starts by itself when you sign in to Windows.');
        if (!args.includes('--no-start')) {
          startLauncher();
          console.log('Started it in its own window ("SGAP Agent"). Keep that window open while you test.');
        }
      } else {
        console.log('Start it with: node scripts/qa-agent.mjs');
      }
      return;
    }
    console.error(result.data.error ?? `Sign-in failed (HTTP ${result.status}).`);
    if (result.status !== 401) process.exit(1);
  }
  process.exit(1);
}

function remove() {
  rmSync(CONFIG_FILE, { force: true });
  rmSync(LAUNCHER, { force: true });
  console.log('This PC no longer runs SGAP tests for the server. Run setup again to reconnect.');
}

// ── run ────────────────────────────────────────────────────────────────────────

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

/** One agent per checkout: two would race for the same runs. */
function takeLock() {
  const held = readJson(LOCK_FILE);
  if (held?.pid && held.pid !== process.pid && alive(held.pid)) {
    console.error(`The SGAP Agent is already running on this PC (pid ${held.pid}). Use that window.`);
    process.exit(1);
  }
  writeJson(LOCK_FILE, { pid: process.pid, startedAt: new Date().toISOString() });
}

async function runAgent() {
  const config = readJson(CONFIG_FILE);
  if (!config?.server || !config?.token) {
    console.error('This PC is not connected to an SGAP server yet. Run: node scripts/qa-agent.mjs setup --server http://<server>:3850');
    process.exit(1);
  }
  takeLock();
  const { server, token, machine } = config;
  const hostConfig = loadServerConfig(cwd);
  const agentVersion = version();
  /** @type {Map<string, { child: any, browsers: number, lines: string[], monitorUrl?: string, sending: Promise<void>, stopped: boolean, done: boolean }>} */
  const running = new Map();
  const failedJobs = new Set();
  let connected;
  let signedOut = false;

  console.log(`SGAP Agent · ${config.name} on ${machine} · server ${server}${agentVersion ? ` · version ${agentVersion}` : ''}`);
  console.log('Waiting for runs. Start them on the dashboard with "Run on: My PC". Close this window to stop.\n');

  function saveActive() {
    const pids = [...running.values()].filter((run) => !run.done && run.child?.pid).map((run) => run.child.pid);
    writeJson(ACTIVE_FILE, { agentPid: process.pid, pids });
  }

  function inUse() {
    const live = [...running.values()].filter((run) => !run.done);
    return { runs: live.length, browsers: live.reduce((sum, run) => sum + run.browsers, 0) };
  }

  /** Sends one report for a run; reports for the same run go out one at a time, in order. */
  function report(id, body) {
    const run = running.get(id);
    const send = async () => {
      for (let attempt = 0; attempt < (body.done ? 60 : 3); attempt += 1) {
        try {
          const result = await post(server, `/api/qa/agent/runs/${id}/report`, body, token);
          if (result.status === 200) {
            if (result.data.stop) stopRun(id, 'Stopped from the dashboard.');
            return;
          }
          if (result.status === 404) return;
        } catch {
          // Server restarting or network blip: retry below.
        }
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    };
    if (run === undefined) return send();
    run.sending = run.sending.then(send);
    return run.sending;
  }

  function stopRun(id, why) {
    const run = running.get(id);
    if (!run || run.stopped || run.done) return;
    run.stopped = true;
    console.log(`\n■ ${id}: ${why} Closing its browsers…`);
    if (run.child?.pid) killPidTree(run.child.pid);
  }

  async function flush(id, withStatus) {
    const run = running.get(id);
    if (!run) return;
    const body = {};
    if (run.lines.length > 0) body.lines = run.lines.splice(0, run.lines.length);
    if (withStatus && run.monitorUrl) {
      try {
        const response = await fetch(`${run.monitorUrl}/api/status`, { signal: AbortSignal.timeout(2000) });
        const text = await response.text();
        if (response.ok && text.length <= MAX_STATUS_BYTES) body.status = JSON.parse(text);
      } catch {
        // Between packages the monitor is down; the next snapshot catches up.
      }
    }
    if (body.lines || body.status) await report(id, body);
  }

  async function start(job) {
    const planned = planRun(job.selection ?? {}, cwd);
    if (planned.error) {
      failedJobs.add(job.id);
      console.log(`✖ ${job.id}: ${planned.error} (this PC may need an update: close this window and start "SGAP Agent" again)`);
      await report(job.id, { done: { exitCode: 1, error: `${machine} could not plan ${job.id}: ${planned.error}` } });
      return;
    }
    const decision = admit(hostConfig, planned.browsers, inUse());
    if (!decision.ok) {
      if (decision.permanent) {
        failedJobs.add(job.id);
        await report(job.id, { done: { exitCode: 1, error: `${machine}: ${decision.reason}` } });
      }
      return;
    }
    const claim = await post(server, `/api/qa/agent/runs/${job.id}/claim`, {}, token).catch(() => undefined);
    if (claim?.status !== 200) return;

    const dir = path.join(RUNS_ROOT, job.id);
    mkdirSync(dir, { recursive: true });
    const env = {
      ...runEnvBase(),
      SGAP_RUN_ID: job.id,
      SGAP_RUN_DIR: dir,
      SGAP_RUN_OWNER: config.name,
      SGAP_TESTER: job.tester,
      SGAP_MONITOR_PORT: '0',
      SGAP_MONITOR_OVERLAY: '1',
    };
    console.log(`\n▶ ${job.id} · ${job.label} · ${planned.games.length} game(s) · players *_${job.tester}`);
    const child = spawn(process.execPath, planned.args, { cwd, env, windowsHide: false });
    const run = { child, browsers: planned.browsers, lines: [], sending: Promise.resolve(), stopped: false, done: false };
    running.set(job.id, run);
    saveActive();

    let pending = '';
    const onData = (chunk) => {
      pending += chunk.toString('utf8').replace(/\u001b\[[0-9;]*m/g, '');
      const parts = pending.split(/\r?\n/u);
      pending = parts.pop() ?? '';
      for (const line of parts) {
        console.log(`${job.id} │ ${line}`);
        run.lines.push(line);
        if (/^#+ \[\d+\/\d+\] Package /u.test(line)) run.monitorUrl = undefined;
        const monitor = line.match(/^\s*monitor\s*:\s*(http:\/\/127\.0\.0\.1:\d+)\s*$/u);
        if (monitor) run.monitorUrl = monitor[1];
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('error', (error) => run.lines.push(`Failed to start: ${error.message}`));
    child.on('close', async (code) => {
      if (pending.length > 0) run.lines.push(pending);
      run.done = true;
      saveActive();
      await flush(job.id, false);
      console.log(`\n${code === 0 ? '✔' : '✖'} ${job.id} finished (exit ${code}). Report: Allure history on this PC (http://127.0.0.1:5055/).`);
      await report(job.id, { done: { exitCode: run.stopped ? 130 : code } });
      running.delete(job.id);
    });
  }

  async function poll() {
    let result;
    try {
      result = await post(server, '/api/qa/agent/poll', { version: agentVersion, running: [...running.keys()] }, token);
    } catch (error) {
      if (connected !== false) console.log(`… cannot reach ${server} (${error.message}); retrying every few seconds.`);
      connected = false;
      return;
    }
    if (result.status === 401) {
      signedOut = true;
      console.error(`\n${result.data.error ?? 'The server no longer accepts this agent.'}`);
      console.error('Run SGAP-setup.cmd again (or: node scripts/qa-agent.mjs setup) and sign in.');
      for (const id of running.keys()) stopRun(id, 'Agent signed out.');
      process.exitCode = 1;
      setTimeout(() => process.exit(1), 3000);
      return;
    }
    if (result.status !== 200) return;
    if (connected !== true) console.log(`✓ Connected to ${server} as ${result.data.user?.name ?? config.name}.`);
    connected = true;
    for (const id of result.data.stop ?? []) stopRun(id, 'Stopped from the dashboard.');
    for (const job of result.data.jobs ?? []) {
      if (!running.has(job.id) && !failedJobs.has(job.id)) await start(job);
    }
  }

  let lastStatus = 0;
  setInterval(() => {
    const withStatus = Date.now() - lastStatus >= STATUS_MS;
    if (withStatus) lastStatus = Date.now();
    for (const id of running.keys()) void flush(id, withStatus);
  }, FLUSH_MS);

  const loop = async () => {
    await poll();
    if (!signedOut) setTimeout(loop, POLL_MS);
  };
  void loop();

  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    process.on(signal, async () => {
      for (const id of running.keys()) stopRun(id, 'The SGAP Agent was closed.');
      await Promise.race([
        Promise.all([...running.keys()].map((id) => report(id, { lines: [`■ The SGAP Agent on ${machine} was closed.`] }))),
        new Promise((resolve) => setTimeout(resolve, 3000)),
      ]);
      rmSync(LOCK_FILE, { force: true });
      process.exit(0);
    });
  }
  process.on('exit', () => {
    const held = readJson(LOCK_FILE);
    if (held?.pid === process.pid) rmSync(LOCK_FILE, { force: true });
  });
}

if (command === 'setup') await setup();
else if (command === 'remove') remove();
else if (command === 'run') await runAgent();
else {
  console.error(`Unknown command "${command}". Use: setup | remove | (nothing) to run.`);
  process.exit(1);
}
