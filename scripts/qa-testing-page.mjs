/**
 * Always-on Worker Monitor with the Quality Automation Testing section.
 *
 * Serves the Worker Monitor page; its Quality Automation Testing section picks
 * test families (Regression and Security / Pentesting kept apart) or a preset,
 * the games, optionally one case and the browser/evidence options, then Run.
 * Each package opens its selected games through the worker monitor; one combined
 * Allure report is published at the end.
 *
 * `/api/qa/*` drives the queue (CORS only for the per-run monitor pages on this PC).
 * Panel reads (lanes, observer, reader) are forwarded to the live per-run monitor
 * through an allowlist, so lanes show up on this page while a package is running;
 * worker-only endpoints of that monitor are never reachable through here.
 *
 * Usage: node scripts/qa-testing-page.mjs [port] [--share[=view]]   (default 3850)
 * Env:   SGAP_QA_PAGE_NO_OPEN=1      do not open the browser
 *        SGAP_QA_SHARE=control|view  open the panel to other PCs (see lib/qa-access.mjs)
 *        SGAP_QA_SHARE_KEY=…         fixed access key instead of a random one per start
 */
import { spawn, spawnSync } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';

import {
  SECURITY_HEADERS,
  checkAccess,
  corsHeaders,
  deniedPage,
  lanUrls,
  shareConfig,
} from './lib/qa-access.mjs';
import {
  familyCases,
  findSuite,
  loadCatalog,
  loadManifests,
  packageOfGame,
  selectionSuite,
  suiteCases,
} from './lib/qa-suites.mjs';
import { UI_ASSETS } from './lib/sgap-worker-monitor-server.mjs';

const cwd = process.cwd();
const portArg = process.argv.slice(2).find((arg) => /^\d+$/u.test(arg));
const port = Number(portArg ?? process.env.SGAP_QA_PAGE_PORT ?? 3850);
const share = shareConfig();
const MONITOR_URL = `http://127.0.0.1:${process.env.SGAP_MONITOR_PORT ?? 3847}`;
const HTML_PATH = path.join(cwd, 'scripts', 'lib', 'sgap-worker-monitor.html');
const READER_HTML_PATH = path.join(cwd, 'scripts', 'lib', 'sgap-backend-reader.html');
const OBSERVE_HTML_PATH = path.join(cwd, 'scripts', 'lib', 'sgap-monitor-worker.html');
const ALLURE_ROOT = path.resolve(process.env.SGAP_ALLURE_HISTORY_ROOT ?? path.join(cwd, 'allure-history'));
const MAX_LOG_LINES = 3000;

/** Per-run monitor endpoints the panel pages read; everything else there is worker-only. */
const PROXY_GET = new Set(['/api/status', '/api/reader', '/api/observe', '/api/observe/session']);
const PROXY_GET_PREFIX = '/reader/files/';
const PROXY_POST = new Set(['/api/stop']);

const STATIC_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
  '.csv': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webm': 'video/webm',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
};

/** @type {null | { pid: number, child: import('node:child_process').ChildProcess, suite: string, label: string, families: string[], packages: string[], games: string[], caseId?: string, dryRun: boolean, state: string, startedAt: number, endedAt?: number, exitCode?: number | null, currentPackage?: string, packageIndex?: number, logFile: string }} */
let job = null;
let logLines = [];
let logBase = 0;

function pushLog(line) {
  logLines.push(line);
  if (logLines.length > MAX_LOG_LINES) {
    const drop = logLines.length - MAX_LOG_LINES;
    logLines = logLines.slice(drop);
    logBase += drop;
  }
  const progress = line.match(/^#+ \[(\d+)\/(\d+)\] Package (\S+)/u);
  if (progress && job) {
    job.packageIndex = Number(progress[1]);
    job.currentPackage = progress[3];
  }
}

function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', ...SECURITY_HEADERS, ...res.sgapCors });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

/** Read-only file from allure-history/ (the published reports), or undefined. */
function allureFile(rel) {
  let target = path.resolve(ALLURE_ROOT, `.${path.sep}${decodeURIComponent(rel)}`);
  if (target !== ALLURE_ROOT && !target.startsWith(ALLURE_ROOT + path.sep)) {
    return undefined;
  }
  try {
    if (existsSync(target) && statSync(target).isDirectory()) {
      target = path.join(target, 'index.html');
    }
    return existsSync(target) && statSync(target).isFile() ? target : undefined;
  } catch {
    return undefined;
  }
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function parseJson(raw) {
  const text = raw.toString('utf8');
  return text.length > 0 ? JSON.parse(text) : {};
}

/** Forwards a request to the per-run worker monitor; answers "no run" when it is down. */
async function proxyToMonitor(req, res, url, raw) {
  try {
    const upstream = await fetch(`${MONITOR_URL}${url.pathname}${url.search}`, {
      method: req.method,
      headers: { 'Content-Type': req.headers['content-type'] ?? 'application/json' },
      body: req.method === 'GET' || req.method === 'HEAD' ? undefined : raw,
      signal: AbortSignal.timeout(5000),
    });
    const body = Buffer.from(await upstream.arrayBuffer());
    res.writeHead(upstream.status, {
      'Content-Type': upstream.headers.get('content-type') ?? 'application/octet-stream',
      'Cache-Control': 'no-store',
      ...SECURITY_HEADERS,
      ...res.sgapCors,
    });
    res.end(body);
  } catch {
    if (url.pathname === '/api/status') {
      send(res, 200, { offline: true, workers: [], totals: {} });
    } else if (url.pathname === '/api/reader') {
      send(res, 200, { offline: true, sequences: [], keep: 50, statusCounts: {} });
    } else {
      send(res, 503, { ok: false, error: 'No run is using the worker monitor right now.' });
    }
  }
}

/** Panel pages served from here talk to this server for the runner API and links. */
function panelPage(file) {
  const html = readFileSync(file, 'utf8');
  return html.replace('</head>', `<script>window.SGAP_QA_API = '';</script>\n</head>`);
}

async function monitorStatus() {
  try {
    const response = await fetch(`${MONITOR_URL}/api/status`, { signal: AbortSignal.timeout(1500) });
    return response.ok ? await response.json() : undefined;
  } catch {
    return undefined;
  }
}

function catalogView() {
  const catalog = loadCatalog(cwd);
  const manifests = loadManifests(cwd);
  const cases = familyCases(catalog, cwd);
  return {
    groups: Object.entries(catalog.familyGroups ?? {}).map(([id, group]) => ({
      id,
      label: group.label,
      description: group.description,
      families: Object.entries(catalog.families)
        .filter(([, family]) => family.group === id)
        .map(([familyId, family]) => ({ id: familyId, label: family.label, scope: family.scope, cases: cases[familyId] })),
    })),
    suites: catalog.suites.map((entry) => {
      const suite = findSuite(catalog, entry.id, cwd);
      return {
        id: suite.id,
        label: suite.label,
        description: suite.description,
        categories: suite.categories,
        families: suite.familyIds ?? null,
        defaultPackages: suite.defaultPackages,
        cases: suiteCases(suite, cwd),
      };
    }),
    packages: Object.entries(catalog.packages).map(([id, gameIds]) => ({
      id,
      games: gameIds.map((gameId) => ({ gameId, name: manifests.get(gameId)?.displayName ?? gameId })),
    })),
    links: { monitor: MONITOR_URL, allure: '/allure/' },
  };
}

function runEnv() {
  const env = { ...process.env, SGAP_LAUNCHER_MODE: process.env.SGAP_LAUNCHER_MODE ?? 'staging' };
  const defaultBrowsers = path.join(process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local'), 'ms-playwright');
  if (env.PLAYWRIGHT_BROWSERS_PATH === undefined && existsSync(defaultBrowsers)) {
    env.PLAYWRIGHT_BROWSERS_PATH = defaultBrowsers;
  }
  return env;
}

async function startRun(body) {
  if (job?.state === 'running') {
    return { status: 409, body: { ok: false, error: 'A simulation is already running from this page.' } };
  }
  if (!body.dryRun && (await monitorStatus()) !== undefined) {
    return {
      status: 409,
      body: { ok: false, error: `Another run is already using the worker monitor (${MONITOR_URL}). Wait for it or stop it first.` },
    };
  }
  const catalog = loadCatalog(cwd);
  const families = Array.isArray(body.families) ? body.families.map(String) : undefined;
  let suite;
  try {
    suite = families !== undefined ? selectionSuite(catalog, families, cwd) : findSuite(catalog, String(body.suite ?? ''), cwd);
  } catch (error) {
    return { status: 400, body: { ok: false, error: String(error?.message ?? error) } };
  }
  const games = (Array.isArray(body.games) ? body.games : []).map(String).filter((gameId) => packageOfGame(catalog, gameId) !== undefined);
  const packages = Object.keys(catalog.packages).filter((pkg) => games.some((gameId) => packageOfGame(catalog, gameId) === pkg));
  if (games.length === 0) {
    return { status: 400, body: { ok: false, error: 'Select at least one game.' } };
  }
  const caseId = typeof body.caseId === 'string' && body.caseId.length > 0 ? body.caseId : undefined;
  if (caseId !== undefined && !suiteCases(suite, cwd).includes(caseId)) {
    return { status: 400, body: { ok: false, error: `${caseId} is not part of ${suite.label}.` } };
  }

  const args = ['scripts/run-suite-queue.mjs'];
  if (families !== undefined) args.push('--families', suite.familyIds.join(','));
  else args.push('--suite', suite.id);
  args.push('--packages', packages.join(','), '--games', games.join(','));
  if (caseId) args.push('--case', caseId);
  if (body.trace === true) args.push('--trace');
  if (body.screenshots === false) args.push('--no-screenshots');
  if (body.dryRun) args.push('--dry-run');

  const logDir = path.join(cwd, 'test-results', 'qa-page');
  mkdirSync(logDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const logFile = path.join(logDir, `${suite.id}-${stamp}.log`);
  const logStream = createWriteStream(logFile);

  logLines = [];
  logBase = 0;
  const child = spawn(process.execPath, args, { cwd, env: runEnv(), windowsHide: true });
  job = {
    pid: child.pid,
    child,
    suite: suite.id,
    label: suite.label,
    families: suite.familyIds ?? suite.categories ?? [],
    packages,
    games,
    caseId,
    dryRun: Boolean(body.dryRun),
    state: 'running',
    startedAt: Date.now(),
    logFile: path.relative(cwd, logFile),
  };
  pushLog(`$ node ${args.join(' ')}`);

  let pending = '';
  const onData = (chunk) => {
    logStream.write(chunk);
    pending += chunk.toString('utf8').replace(/\u001b\[[0-9;]*m/g, '');
    const parts = pending.split(/\r?\n/u);
    pending = parts.pop() ?? '';
    parts.forEach(pushLog);
  };
  child.stdout.on('data', onData);
  child.stderr.on('data', onData);
  child.on('close', (code) => {
    if (pending.length > 0) pushLog(pending);
    logStream.end();
    if (job?.child === child) {
      job.endedAt = Date.now();
      job.exitCode = code;
      if (job.state === 'running') {
        job.state = code === 0 ? 'passed' : 'failed';
      }
    }
  });
  return { status: 200, body: { ok: true, pid: child.pid } };
}

function stopRun() {
  if (job?.state !== 'running') {
    return { ok: false, error: 'Nothing is running from this page.' };
  }
  job.state = 'stopped';
  pushLog('■ Stop requested — ending the queue and closing test browsers…');
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/F', '/T', '/PID', String(job.pid)], { windowsHide: true });
  } else {
    job.child.kill('SIGTERM');
  }
  spawnSync(process.execPath, ['scripts/stop-sgap-browsers.mjs'], { cwd, windowsHide: true, timeout: 30_000 });
  return { ok: true };
}

function jobView(since) {
  const start = Math.max(0, since - logBase);
  const view = job === null ? null : (({ child, ...rest }) => rest)(job);
  return { job: view, log: { from: logBase + start, next: logBase + logLines.length, lines: logLines.slice(start) } };
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  res.sgapCors = corsHeaders(req);
  try {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, res.sgapCors);
      res.end();
      return;
    }
    if (req.method === 'GET' && UI_ASSETS[url.pathname] !== undefined) {
      const asset = UI_ASSETS[url.pathname];
      send(res, 200, readFileSync(asset.file, 'utf8'), asset.type);
      return;
    }
    const access = checkAccess(req, url, share);
    if (!access.ok) {
      if (access.status === 302) {
        res.writeHead(302, { Location: access.redirect, 'Set-Cookie': access.cookie, 'Cache-Control': 'no-store', ...SECURITY_HEADERS });
        res.end();
      } else if (url.pathname.startsWith('/api/')) {
        send(res, access.status, { ok: false, error: access.message });
      } else {
        send(res, access.status, deniedPage(access.message), 'text/html; charset=utf-8');
      }
      return;
    }
    if (req.method === 'POST') {
      if (access.role === 'view') {
        send(res, 403, { ok: false, error: 'View-only access: runs can only be started or stopped from the host PC.' });
        return;
      }
      // JSON-only writes: a plain HTML form on another site cannot trigger a run.
      if (!String(req.headers['content-type'] ?? '').startsWith('application/json')) {
        send(res, 415, { ok: false, error: 'Send JSON (Content-Type: application/json).' });
        return;
      }
    }
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      send(res, 200, panelPage(HTML_PATH), 'text/html; charset=utf-8');
      return;
    }
    if (req.method === 'GET' && (url.pathname === '/reader' || url.pathname === '/reader.html')) {
      send(res, 200, panelPage(READER_HTML_PATH), 'text/html; charset=utf-8');
      return;
    }
    if (req.method === 'GET' && (url.pathname === '/observe' || url.pathname === '/observe.html')) {
      send(res, 200, panelPage(OBSERVE_HTML_PATH), 'text/html; charset=utf-8');
      return;
    }
    if (req.method === 'GET' && (url.pathname === '/allure' || url.pathname.startsWith('/allure/'))) {
      if (url.pathname === '/allure') {
        res.writeHead(302, { Location: '/allure/', ...SECURITY_HEADERS });
        res.end();
        return;
      }
      const file = allureFile(url.pathname.slice('/allure/'.length) || 'index.html');
      if (file === undefined) {
        send(res, 404, 'Not found', 'text/plain; charset=utf-8');
        return;
      }
      send(res, 200, readFileSync(file), STATIC_TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream');
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/qa/access') {
      send(res, 200, {
        remote: access.remote,
        role: access.role,
        share: share === undefined ? null : { mode: share.mode, ...(access.remote ? {} : { urls: lanUrls(port, share.key) }) },
      });
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/qa/catalog') {
      send(res, 200, catalogView());
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/qa/job') {
      send(res, 200, jobView(Number(url.searchParams.get('since') ?? 0)));
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/qa/run') {
      const result = await startRun(parseJson(await readBody(req)));
      send(res, result.status, result.body);
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/qa/stop') {
      send(res, 200, stopRun());
      return;
    }
    const proxied = req.method === 'GET'
      ? PROXY_GET.has(url.pathname) || url.pathname.startsWith(PROXY_GET_PREFIX)
      : req.method === 'POST' && PROXY_POST.has(url.pathname);
    if (!proxied) {
      send(res, 404, { ok: false, error: 'not found' });
      return;
    }
    const raw = req.method === 'GET' ? Buffer.alloc(0) : await readBody(req);
    // "Stop all" during a simulation must end the whole queue, not just the current package.
    if (req.method === 'POST' && url.pathname === '/api/stop' && job?.state === 'running') {
      const body = parseJson(raw);
      if (body.all === true) {
        const result = stopRun();
        send(res, 200, { ...result, message: 'Simulation stopped' });
        return;
      }
    }
    await proxyToMonitor(req, res, url, raw);
  } catch (error) {
    send(res, 500, { ok: false, error: String(error?.message ?? error) });
  }
});

server.listen(port, share === undefined ? '127.0.0.1' : '0.0.0.0', () => {
  const pageUrl = `http://127.0.0.1:${port}/`;
  console.log(`SGAP control panel: ${pageUrl}`);
  if (share !== undefined) {
    const urls = lanUrls(port, share.key);
    console.log(`Shared on the local network (${share.mode === 'view' ? 'view only' : 'control'}) — open on the other PC:`);
    for (const url of urls.length > 0 ? urls : [`http://<this-pc-ip>:${port}/?key=${share.key}`]) {
      console.log(`  ${url}`);
    }
    console.log('Remote browsers need the key once. Tests, browsers and files stay on this PC.');
  }
  if (process.env.SGAP_QA_PAGE_NO_OPEN !== '1') {
    if (process.platform === 'win32') {
      spawn('cmd', ['/c', 'start', '""', pageUrl], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
    } else {
      spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', [pageUrl], { detached: true, stdio: 'ignore' }).unref();
    }
  }
});
