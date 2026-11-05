/**
 * SGAP control panel (local only): dashboard, test runner and execution manager.
 *
 * Pick test families (Regression and Security / Pentesting kept apart) or a preset,
 * the games, optionally one case and the evidence options, then Run. Every run is an
 * independent execution (scripts/lib/execution-manager.mjs): id RUN-0001…, its own
 * folder under runs/, its own worker monitor and the tester's staging players. Runs
 * execute side by side as far as this PC's CPU/RAM allow (config/qa-server.json);
 * beyond that they queue with the actual reason.
 *
 * Run-scoped pages and reads live under /runs/<id>/ and are forwarded to that run's
 * monitor through an allowlist; worker-only monitor endpoints are never reachable.
 *
 * PAD (performance) runs have their own page, /pad (PAD Tester): one game in one browser
 * on screen 2, never beside another run.
 *
 * Usage: node scripts/qa-testing-page.mjs [port]   (default 3850, bound to 127.0.0.1)
 * Env:   SGAP_QA_PAGE_NO_OPEN=1      do not open the browser
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';

import { createExecutionManager } from './lib/execution-manager.mjs';
import { loadServerConfig } from './lib/host-resources.mjs';
import { LOCKFILE } from './lib/sgap-process-guard.mjs';
import { SECURITY_HEADERS, corsHeaders, isLoopback } from './lib/qa-access.mjs';
import { checkLaunchUrl, gameForLaunchUrl, launchUrlFacts } from './lib/launch-url.mjs';
import { familyCases, findSuite, loadCatalog, loadManifests, suiteCases } from './lib/qa-suites.mjs';
import { resolveTester, sanitizeTester } from './lib/sgap-tester.mjs';
import { loadAnalytics } from './lib/test-analytics.mjs';
import { stripLearnedSecrets } from './lib/learned-secrets.mjs';
import { UI_ASSETS } from './lib/sgap-worker-monitor-server.mjs';

const cwd = process.cwd();
const portArg = process.argv.slice(2).find((arg) => /^\d+$/u.test(arg));
const port = Number(portArg ?? process.env.SGAP_QA_PAGE_PORT ?? 3850);
const config = loadServerConfig(cwd);
const manager = createExecutionManager({ cwd, config });
const HOST_USER = { name: resolveTester() || sanitizeTester(os.userInfo().username) || 'host' };

const LIB = path.join(cwd, 'scripts', 'lib');
const HTML_PATH = path.join(LIB, 'sgap-worker-monitor.html');
const READER_HTML_PATH = path.join(LIB, 'sgap-backend-reader.html');
const OBSERVE_HTML_PATH = path.join(LIB, 'sgap-monitor-worker.html');
const DASHBOARD_HTML_PATH = path.join(LIB, 'sgap-dashboard.html');
const PAD_HTML_PATH = path.join(LIB, 'sgap-pad-tester.html');
const ALLURE_ROOT = path.resolve(process.env.SGAP_ALLURE_HISTORY_ROOT ?? path.join(cwd, 'allure-history'));

/** Per-run monitor endpoints the panel pages read; everything else there is worker-only. */
const PROXY_GET = new Set(['/api/status', '/api/reader', '/api/observe', '/api/observe/session']);
const PROXY_GET_PREFIX = '/reader/files/';
const RUN_PATH = /^\/runs\/(RUN-\d{4,}|CLI)(\/.*)?$/u;
/** Id under which a run started from a terminal (not by this panel) is shown. */
const CLI_RUN_ID = 'CLI';

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

function send(res, status, body, type = 'application/json; charset=utf-8', extra = {}) {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', ...SECURITY_HEADERS, ...res.sgapCors, ...extra });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

function redirect(res, location, extra = {}) {
  res.writeHead(302, { Location: location, 'Cache-Control': 'no-store', ...SECURITY_HEADERS, ...extra });
  res.end();
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
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1_000_000) throw new Error('Request body too large.');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function parseJson(raw) {
  const text = raw.toString('utf8');
  return text.length > 0 ? JSON.parse(text) : {};
}

/** Panel pages served from here talk to this server for the runner API, links and the run in view. */
function panelPage(file, runId) {
  const html = readFileSync(file, 'utf8');
  const boot = `<script>window.SGAP_QA_API = '';${runId ? ` window.SGAP_RUN_ID = ${JSON.stringify(runId)};` : ''}</script>`;
  return html.replace('</head>', `${boot}\n</head>`);
}

const OFFLINE = {
  '/api/status': { offline: true, workers: [], totals: {} },
  '/api/reader': { offline: true, sequences: [], keep: 50, statusCounts: {} },
  '/api/observe': { offline: true, sessions: [] },
};

function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
}

const monitorByPid = new Map();

/** Loopback port a runner process listens on (its worker monitor), for lockfiles that do not record it. */
function listeningMonitorUrl(pid) {
  if (monitorByPid.has(pid)) return monitorByPid.get(pid);
  let url;
  const result = process.platform === 'win32'
    ? spawnSync('netstat', ['-ano', '-p', 'tcp'], { encoding: 'utf8', windowsHide: true, timeout: 3000 })
    : spawnSync('lsof', ['-nP', '-a', '-p', String(pid), '-iTCP', '-sTCP:LISTEN'], { encoding: 'utf8', timeout: 3000 });
  for (const line of String(result.stdout ?? '').split(/\r?\n/u)) {
    const win = line.match(/^\s*TCP\s+127\.0\.0\.1:(\d+)\s+\S+\s+LISTENING\s+(\d+)\s*$/u);
    const nix = line.match(/127\.0\.0\.1:(\d+)\s+\(LISTEN\)/u);
    if (win && Number(win[2]) === pid) url = `http://127.0.0.1:${win[1]}`;
    else if (nix) url = `http://127.0.0.1:${nix[1]}`;
    if (url) break;
  }
  monitorByPid.set(pid, url);
  return url;
}

/**
 * A parallel run started by hand (terminal, agent, npm script), found through the
 * runner's lockfile. The panel cannot see its console, only its worker monitor.
 */
function cliRun() {
  let lock;
  try {
    lock = JSON.parse(readFileSync(LOCKFILE, 'utf8'));
  } catch {
    return undefined;
  }
  const pid = Number(lock.parent);
  if (!pid || !pidAlive(pid)) return undefined;
  lock.monitorUrl ||= listeningMonitorUrl(pid);
  if (!lock.monitorUrl) return undefined;
  const startedAt = Date.parse(lock.startedAt);
  return {
    id: CLI_RUN_ID,
    external: true,
    ...(lock.kind ? { kind: lock.kind } : {}),
    owner: lock.tester || HOST_USER.name,
    label: `Terminal run · ${lock.config ?? 'parallel workers'}`,
    state: 'running',
    startedAt: Number.isNaN(startedAt) ? undefined : startedAt,
    games: Array.isArray(lock.games) ? lock.games : [],
    packages: [],
    browsers: Number(lock.lanes) || 0,
    pid,
    note: `Started from a terminal · ${lock.lanes ?? '?'} lane(s) · monitor ${lock.monitorUrl}`,
    monitorUrl: lock.monitorUrl,
  };
}

/** Per-test resource inventories a run wrote to `<run dir>/resources/` (already redacted by the worker). */
/** DISC-001 output of a Game URL run: the discovery report, the per-case assessment, QA decisions. */
const EMPTY_DISCOVERY = {
  report: null,
  cases: [],
  learned: false,
  decisions: {},
  summary: { ready: 0, calibration: 0, unsupported: 0, blocked: 0, spinsLearned: 0, panels: [] },
};

function savedDiscovery(run) {
  if (!run.dir) return { ...EMPTY_DISCOVERY };
  const dir = path.resolve(cwd, run.dir, 'discovery');
  if (!dir.startsWith(path.resolve(cwd))) return { ...EMPTY_DISCOVERY };
  const read = (name) => {
    try {
      return JSON.parse(readFileSync(path.join(dir, name), 'utf8'));
    } catch {
      return null;
    }
  };
  const report = read('discovery.json');
  const cases = read('case-assessment.json') ?? [];
  const count = (status) => cases.filter((entry) => entry.status === status).length;
  const decisions = report?.game?.gameKey ? readLearnedDecisions(report.game.gameKey) : {};
  return {
    report,
    cases,
    learned: read('learned-manifest.json') !== null,
    decisions,
    summary: {
      ready: count('ready'),
      calibration: count('calibration'),
      unsupported: count('unsupported'),
      blocked: count('blocked'),
      spinsLearned: report?.payload?.spinsLearned ?? 0,
      panels: (report?.panelChecks ?? []).map((check) => ({ target: check.target, verified: check.verified, closed: check.closed })),
    },
  };
}

const LEARNED_DIR = path.join(cwd, '.sgap', 'learned');
const learnedPath = (gameKey) => path.join(LEARNED_DIR, `${String(gameKey).replace(/[^\w.-]+/gu, '_')}.json`);

function readLearnedDecisions(gameKey) {
  try {
    return JSON.parse(readFileSync(learnedPath(gameKey), 'utf8')).decisions ?? {};
  } catch {
    return {};
  }
}

const QA_DECISIONS = new Set(['confirmed', 'absent', 'rejected', 'clear']);

/**
 * Assisted calibration: a tester confirms a discovered control, rejects a mapping, or confirms a
 * capability is absent (→ N/A). Stored per game key (and build) in .sgap/learned — never in
 * config/manifests, never with a URL or token. The next discovery of that game applies it.
 */
function recordLearnedDecision(user, body) {
  const gameKey = String(body.gameKey ?? '').trim();
  const target = String(body.target ?? '').trim();
  const decision = String(body.decision ?? '');
  if (!/^[\w.-]{1,80}$/u.test(gameKey)) return { status: 400, body: { ok: false, error: 'gameKey is required.' } };
  if (!/^[A-Za-z]{2,40}$/u.test(target)) return { status: 400, body: { ok: false, error: 'target must be a control or capability name.' } };
  if (!QA_DECISIONS.has(decision)) return { status: 400, body: { ok: false, error: `decision must be one of ${[...QA_DECISIONS].join(', ')}.` } };
  const decisions = readLearnedDecisions(gameKey);
  if (decision === 'clear') delete decisions[target];
  else decisions[target] = { decision, by: user, at: new Date().toISOString(), ...(typeof body.build === 'string' && body.build ? { build: body.build.slice(0, 40) } : {}) };
  mkdirSync(LEARNED_DIR, { recursive: true });
  let existing = {};
  try {
    existing = JSON.parse(readFileSync(learnedPath(gameKey), 'utf8'));
  } catch {
    existing = {};
  }
  const safe = stripLearnedSecrets({ ...existing, gameKey, decisions });
  writeFileSync(learnedPath(gameKey), `${JSON.stringify(safe, null, 2)}\n`, 'utf8');
  return { status: 200, body: { ok: true, gameKey, decisions } };
}

function savedResources(run) {
  if (!run.dir) return [];
  const dir = path.resolve(cwd, run.dir, 'resources');
  if (!dir.startsWith(path.resolve(cwd))) return [];
  let files = [];
  try {
    files = readdirSync(dir).filter((name) => name.endsWith('.json'));
  } catch {
    return [];
  }
  return files.flatMap((name) => {
    try {
      const saved = JSON.parse(readFileSync(path.join(dir, name), 'utf8'));
      return [{ ...saved.session, status: saved.status, resources: Array.isArray(saved.resources) ? saved.resources : [] }];
    } catch {
      return [];
    }
  });
}

function findRun(runId) {
  return runId === CLI_RUN_ID ? cliRun() : manager.get(runId);
}

/** Forwards a read to one run's worker monitor; answers "offline" between packages or after the run. */
async function proxyToRun(req, res, runId, subPath, search, raw) {
  const base = !runId ? undefined : runId === CLI_RUN_ID ? cliRun()?.monitorUrl : manager.monitorUrl(runId);
  if (base === undefined) {
    if (OFFLINE[subPath]) send(res, 200, OFFLINE[subPath]);
    else send(res, 503, { ok: false, error: 'This run has no live worker monitor right now.' });
    return;
  }
  try {
    const upstream = await fetch(`${base}${subPath}${search}`, {
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
    if (OFFLINE[subPath]) send(res, 200, OFFLINE[subPath]);
    else send(res, 503, { ok: false, error: 'This run has no live worker monitor right now.' });
  }
}

/** Run shown by the root-level pages: the caller's newest live run, else anyone's. */
function defaultRunId(user) {
  const live = manager.list().filter((run) => run.state === 'running');
  return (live.find((run) => run.owner === user.name) ?? live[0])?.id ?? cliRun()?.id;
}

function allRuns() {
  const cli = cliRun();
  return cli ? [cli, ...manager.list()] : manager.list();
}

function catalogView() {
  const catalog = loadCatalog(cwd);
  const manifests = loadManifests(cwd);
  const cases = familyCases(catalog, cwd);
  return {
    groups: Object.entries(catalog.familyGroups ?? {}).filter(([, group]) => group.panel === undefined).map(([id, group]) => ({
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
    links: { allure: '/allure/' },
  };
}

/** PAD case wording and priority from docs/catalogs/FPS_TestCase.md (the QA-owned source). */
function padCaseDocs() {
  const docs = new Map();
  const priority = new Map();
  let text = '';
  try {
    text = readFileSync(path.join(cwd, 'docs', 'catalogs', 'FPS_TestCase.md'), 'utf8');
  } catch {
    return { docs, priority };
  }
  for (const line of text.split(/\r?\n/u)) {
    const row = line.match(/^\|\s*(PAD-\d{3})\s*\|([^|]*)\|([^|]*)\|([^|]*)\|([^|]*)\|/u);
    if (row) {
      docs.set(row[1], { title: row[2].trim(), window: row[3].trim(), runs: row[4].trim(), expected: row[5].trim() });
      continue;
    }
    const tier = line.match(/^\|\s*(P\d)\b[^|]*\|([^|]*)\|/u);
    if (tier) {
      for (const token of tier[2].split(/[,\s]+/u).filter(Boolean)) {
        const span = token.match(/^(?:PAD-)?(\d{3})(?:(?:…|\.\.\.|–|-)(\d{3}))?$/u);
        if (!span) continue;
        const from = Number(span[1]);
        const to = span[2] ? Number(span[2]) : from;
        for (let n = from; n <= to; n += 1) {
          const id = `PAD-${String(n).padStart(3, '0')}`;
          if (!priority.has(id)) priority.set(id, tier[1]);
        }
      }
    }
  }
  return { docs, priority };
}

function padCatalogView() {
  const catalog = loadCatalog(cwd);
  const manifests = loadManifests(cwd);
  const automated = familyCases(catalog, cwd).PAD ?? [];
  const { docs, priority } = padCaseDocs();
  const packageOf = new Map(Object.entries(catalog.packages).flatMap(([pkg, gameIds]) => gameIds.map((gameId) => [gameId, pkg])));
  const games = [...manifests.entries()]
    .map(([gameId, manifest]) => ({ gameId, name: manifest?.displayName ?? gameId, package: packageOf.get(gameId) }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return {
    games,
    defaultGame: 'gnome-mansland',
    cases: automated.map((id) => ({ id, priority: priority.get(id), ...(docs.get(id) ?? { title: id }) })),
    screens: { default: 1, note: 'Screen 2 keeps the game away from the panel and other windows.' },
  };
}

/** Local only: callers from this PC are the host tester; anything else is refused. */
function identify(req) {
  return isLoopback(req)
    ? { ok: true, user: HOST_USER }
    : { ok: false, status: 403, message: 'The SGAP control panel only accepts connections from this PC.' };
}

async function handleRunScoped(req, res, url, who, runId, subPath) {
  // A finished terminal run leaves no record; its pages stay up and read as offline.
  const run = runId === CLI_RUN_ID ? (cliRun() ?? { id: CLI_RUN_ID }) : manager.get(runId);
  if (run === undefined) {
    send(res, 404, { ok: false, error: `${runId} not found.` });
    return;
  }
  if (req.method === 'GET') {
    if (subPath === '' ) {
      redirect(res, `/runs/${runId}/`);
      return;
    }
    if (subPath === '/' || subPath === '/index.html') {
      send(res, 200, panelPage(HTML_PATH, runId), 'text/html; charset=utf-8');
      return;
    }
    if (subPath === '/reader' || subPath === '/reader.html') {
      send(res, 200, panelPage(READER_HTML_PATH, runId), 'text/html; charset=utf-8');
      return;
    }
    if (subPath === '/observe' || subPath === '/observe.html') {
      send(res, 200, panelPage(OBSERVE_HTML_PATH, runId), 'text/html; charset=utf-8');
      return;
    }
    if (PROXY_GET.has(subPath) || subPath.startsWith(PROXY_GET_PREFIX)) {
      await proxyToRun(req, res, runId, subPath, url.search, Buffer.alloc(0));
      return;
    }
  }
  if (req.method === 'POST' && subPath === '/api/stop') {
    const raw = await readBody(req);
    const body = parseJson(raw);
    if (body.all === true && runId !== CLI_RUN_ID) {
      const result = manager.stop(who.user, runId);
      send(res, result.status, { ...result.body, message: `${runId} stopped` });
      return;
    }
    await proxyToRun(req, res, runId, subPath, '', raw);
    return;
  }
  send(res, 404, { ok: false, error: 'not found' });
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
    // JSON-only writes: a plain HTML form on another site cannot trigger anything.
    if (req.method === 'POST' && !String(req.headers['content-type'] ?? '').startsWith('application/json')) {
      send(res, 415, { ok: false, error: 'Send JSON (Content-Type: application/json).' });
      return;
    }
    const who = identify(req);
    if (!who.ok) {
      send(res, who.status, { ok: false, error: who.message });
      return;
    }

    const scoped = url.pathname.match(RUN_PATH);
    if (scoped) {
      await handleRunScoped(req, res, url, who, scoped[1], scoped[2] ?? '');
      return;
    }

    if (req.method === 'GET') {
      if (url.pathname === '/' || url.pathname === '/index.html') {
        send(res, 200, panelPage(HTML_PATH), 'text/html; charset=utf-8');
        return;
      }
      if (url.pathname === '/pad' || url.pathname === '/pad.html') {
        send(res, 200, panelPage(PAD_HTML_PATH), 'text/html; charset=utf-8');
        return;
      }
      if (url.pathname === '/api/qa/pad/catalog') {
        send(res, 200, padCatalogView());
        return;
      }
      if (url.pathname === '/dashboard' || url.pathname === '/dashboard.html') {
        send(res, 200, panelPage(DASHBOARD_HTML_PATH), 'text/html; charset=utf-8');
        return;
      }
      if (url.pathname === '/api/qa/analytics') {
        send(res, 200, await loadAnalytics(ALLURE_ROOT));
        return;
      }
      if (url.pathname === '/reader' || url.pathname === '/reader.html') {
        send(res, 200, panelPage(READER_HTML_PATH, defaultRunId(who.user)), 'text/html; charset=utf-8');
        return;
      }
      if (url.pathname === '/observe' || url.pathname === '/observe.html') {
        send(res, 200, panelPage(OBSERVE_HTML_PATH, defaultRunId(who.user)), 'text/html; charset=utf-8');
        return;
      }
      if (url.pathname === '/allure' || url.pathname.startsWith('/allure/')) {
        if (url.pathname === '/allure') {
          redirect(res, '/allure/');
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
      if (url.pathname === '/api/qa/access') {
        send(res, 200, { user: who.user });
        return;
      }
      if (url.pathname === '/api/qa/catalog') {
        send(res, 200, catalogView());
        return;
      }
      if (url.pathname === '/api/qa/runs') {
        send(res, 200, {
          me: who.user,
          capacity: manager.capacity(),
          runs: allRuns(),
        });
        return;
      }
      const runRead = url.pathname.match(/^\/api\/qa\/runs\/(RUN-\d{4,}|CLI)$/u);
      if (runRead) {
        const run = findRun(runRead[1]);
        if (run === undefined) {
          send(res, 404, { ok: false, error: `${runRead[1]} not found.` });
          return;
        }
        const log = run.external
          ? { from: 0, next: 1, lines: [`Started from a terminal (PID ${run.pid}). Its console output stays in that terminal; the workers below are live from ${run.monitorUrl}.`] }
          : manager.log(run.id, Number(url.searchParams.get('since') ?? 0));
        send(res, 200, { run, log });
        return;
      }
      const launchRef = url.pathname.match(/^\/api\/qa\/launch-url\/([0-9a-f]{48})$/u);
      if (launchRef) {
        const raw = manager.launchUrl(launchRef[1]);
        if (raw === undefined) {
          send(res, 404, { ok: false, error: 'No active run holds this Game URL.' });
          return;
        }
        res.setHeader('Cache-Control', 'no-store');
        send(res, 200, { ok: true, url: raw });
        return;
      }
      const runDiscovery = url.pathname.match(/^\/api\/qa\/runs\/(RUN-\d{4,})\/discovery$/u);
      if (runDiscovery) {
        const run = manager.get(runDiscovery[1]);
        if (run === undefined) {
          send(res, 404, { ok: false, error: `${runDiscovery[1]} not found.` });
          return;
        }
        send(res, 200, { run: run.id, ...savedDiscovery(run) });
        return;
      }
      const runResources = url.pathname.match(/^\/api\/qa\/runs\/(RUN-\d{4,})\/resources$/u);
      if (runResources) {
        const run = manager.get(runResources[1]);
        if (run === undefined) {
          send(res, 404, { ok: false, error: `${runResources[1]} not found.` });
          return;
        }
        send(res, 200, { run: run.id, sessions: savedResources(run) });
        return;
      }
      // Root-level monitor reads (older bookmarks, the in-page links) follow the default run.
      if (PROXY_GET.has(url.pathname) || url.pathname.startsWith(PROXY_GET_PREFIX)) {
        await proxyToRun(req, res, defaultRunId(who.user), url.pathname, url.search, Buffer.alloc(0));
        return;
      }
    }

    if (req.method === 'POST') {
      if (url.pathname === '/api/qa/learned') {
        const result = recordLearnedDecision(who.user, parseJson(await readBody(req)));
        send(res, result.status, result.body);
        return;
      }
      if (url.pathname === '/api/qa/launch-url/check') {
        const raw = parseJson(await readBody(req)).url;
        const { ok, reasons, redacted, host, lan, hasToken } = checkLaunchUrl(raw);
        const game = ok ? gameForLaunchUrl(raw, loadManifests()) : undefined;
        const { gameKey, device } = ok ? launchUrlFacts(raw) : {};
        send(res, 200, {
          ok, reasons, redacted, host, lan, hasToken, gameKey, device,
          gameId: game?.gameId,
          gameName: game?.metadata?.launcherGameLabel ?? game?.gameId,
          registered: ok ? game !== undefined : undefined,
        });
        return;
      }
      if (url.pathname === '/api/qa/pad/run') {
        const result = manager.submitPad(who.user, parseJson(await readBody(req)));
        send(res, result.status, result.body);
        return;
      }
      if (url.pathname === '/api/qa/run') {
        const result = manager.submit(who.user, parseJson(await readBody(req)));
        send(res, result.status, result.body);
        return;
      }
      if (url.pathname === `/api/qa/runs/${CLI_RUN_ID}/stop`) {
        await proxyToRun(req, res, CLI_RUN_ID, '/api/stop', '', Buffer.from(JSON.stringify({ all: true })));
        return;
      }
      const runStop = url.pathname.match(/^\/api\/qa\/runs\/(RUN-\d{4,})\/stop$/u);
      if (runStop) {
        const result = manager.stop(who.user, runStop[1]);
        send(res, result.status, result.body);
        return;
      }
    }
    send(res, 404, { ok: false, error: 'not found' });
  } catch (error) {
    send(res, 500, { ok: false, error: String(error?.message ?? error) });
  }
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    manager.stopAll();
    process.exit(0);
  });
}

server.listen(port, '127.0.0.1', () => {
  const pageUrl = `http://127.0.0.1:${port}/`;
  process.env.SGAP_QA_PANEL_URL = `http://127.0.0.1:${server.address().port}`;
  const capacity = manager.capacity();
  void loadAnalytics(ALLURE_ROOT).catch(() => undefined);
  console.log(`SGAP control panel (local only): ${pageUrl}   (tester ${HOST_USER.name})`);
  console.log(
    `Capacity: up to ${capacity.maxBrowsers} game browsers at once (${capacity.limitedBy.detail})` +
      `${capacity.maxRuns ? `, ${capacity.maxRuns} runs` : ''}. Tune in .sgap/qa-server.json.`,
  );
  if (process.env.SGAP_QA_PAGE_NO_OPEN !== '1') {
    if (process.platform === 'win32') {
      spawn('cmd', ['/c', 'start', '""', pageUrl], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
    } else {
      spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', [pageUrl], { detached: true, stdio: 'ignore' }).unref();
    }
  }
});
