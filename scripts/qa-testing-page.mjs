/**
 * SGAP control panel: the shared QA dashboard and execution manager.
 *
 * Users sign in, pick test families (Regression and Security / Pentesting kept
 * apart) or a preset, the games, optionally one case and the evidence options,
 * then Run. Every run is an independent execution (scripts/lib/execution-manager.mjs):
 * id RUN-0001…, its own folder under runs/, its own worker monitor and its owner's
 * staging players. Runs execute side by side as far as this host's CPU/RAM allow
 * (config/qa-server.json); beyond that they queue with the actual reason.
 *
 * Run-scoped pages and reads live under /runs/<id>/ and are forwarded to that run's
 * monitor through an allowlist; worker-only monitor endpoints are never reachable.
 *
 * Usage: node scripts/qa-testing-page.mjs [port] [--server | --share[=view]]   (default 3850)
 *   --server   shared QA server: listens on the network, QA accounts required
 *              (npx pnpm qa:users add <name>); this PC's own browser is the host admin
 *   --share    ad-hoc LAN link with an access key (scripts/lib/qa-access.mjs)
 * Env:   SGAP_QA_PAGE_NO_OPEN=1      do not open the browser
 *        SGAP_QA_SERVER=1            same as --server
 *        SGAP_QA_SHARE=control|view  same as --share
 *        SGAP_QA_SHARE_KEY=…         fixed access key instead of a random one per start
 */
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';

import { createExecutionManager } from './lib/execution-manager.mjs';
import { loadServerConfig } from './lib/host-resources.mjs';
import {
  SECURITY_HEADERS,
  checkAccess,
  corsHeaders,
  deniedPage,
  isLoopback,
  lanUrls,
  shareConfig,
} from './lib/qa-access.mjs';
import { familyCases, findSuite, loadCatalog, loadManifests, suiteCases } from './lib/qa-suites.mjs';
import { createAuth } from './lib/qa-users.mjs';
import { resolveTester, sanitizeTester } from './lib/sgap-tester.mjs';
import { UI_ASSETS } from './lib/sgap-worker-monitor-server.mjs';

const cwd = process.cwd();
const portArg = process.argv.slice(2).find((arg) => /^\d+$/u.test(arg));
const port = Number(portArg ?? process.env.SGAP_QA_PAGE_PORT ?? 3850);
const serverMode = process.argv.includes('--server') || process.env.SGAP_QA_SERVER === '1';
const share = serverMode ? undefined : shareConfig();
const config = loadServerConfig(cwd);
const auth = createAuth({ cwd, sessionHours: config.sessionHours });
const manager = createExecutionManager({ cwd, config });
const HOST_USER = { name: resolveTester() || sanitizeTester(os.userInfo().username) || 'host', role: 'admin' };

const LIB = path.join(cwd, 'scripts', 'lib');
const HTML_PATH = path.join(LIB, 'sgap-worker-monitor.html');
const READER_HTML_PATH = path.join(LIB, 'sgap-backend-reader.html');
const OBSERVE_HTML_PATH = path.join(LIB, 'sgap-monitor-worker.html');
const LOGIN_HTML_PATH = path.join(LIB, 'sgap-login.html');
const ALLURE_ROOT = path.resolve(process.env.SGAP_ALLURE_HISTORY_ROOT ?? path.join(cwd, 'allure-history'));

/** Per-run monitor endpoints the panel pages read; everything else there is worker-only. */
const PROXY_GET = new Set(['/api/status', '/api/reader', '/api/observe', '/api/observe/session']);
const PROXY_GET_PREFIX = '/reader/files/';
const RUN_PATH = /^\/runs\/(RUN-\d{4,})(\/.*)?$/u;

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

/** Forwards a read to one run's worker monitor; answers "offline" between packages or after the run. */
async function proxyToRun(req, res, runId, subPath, search, raw) {
  const base = runId ? manager.monitorUrl(runId) : undefined;
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
  return (live.find((run) => run.owner === user.name) ?? live[0])?.id;
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
    links: { allure: '/allure/' },
  };
}

/**
 * Who is calling.
 *   { ok: true, remote, user: { name, role } }
 *   { ok: false, status, message, login? }  — login: send the browser to /login
 */
function identify(req, url) {
  if (isLoopback(req)) {
    return { ok: true, remote: false, user: HOST_USER };
  }
  if (auth.enabled()) {
    const user = auth.current(req);
    return user ? { ok: true, remote: true, user } : { ok: false, status: 401, login: true, message: 'Sign in to use the QA panel.' };
  }
  if (share !== undefined) {
    const access = checkAccess(req, url, share);
    if (!access.ok) return access;
    return { ok: true, remote: true, user: { name: 'remote', role: access.role === 'view' ? 'viewer' : 'tester' } };
  }
  return {
    ok: false,
    status: 403,
    message: serverMode
      ? 'No QA accounts exist yet. On the server PC run: npx pnpm qa:users add <your-name> --role admin'
      : 'This panel only accepts connections from the host PC.',
  };
}

function accessView(who) {
  const base = {
    remote: who.remote,
    user: who.user,
    role: who.user.role === 'viewer' ? 'view' : 'control',
    authRequired: auth.enabled(),
    server: serverMode,
  };
  if (share !== undefined) {
    return { ...base, share: { mode: share.mode, ...(who.remote ? {} : { urls: lanUrls(port, share.key) }) } };
  }
  if (serverMode && !who.remote) {
    return { ...base, share: { mode: 'accounts', urls: lanUrls(port, '').map((entry) => entry.replace(/\?key=$/u, '')) } };
  }
  return { ...base, share: null };
}

async function handleRunScoped(req, res, url, who, runId, subPath) {
  const run = manager.get(runId);
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
    if (run.owner !== who.user.name && who.user.role !== 'admin') {
      send(res, 403, { ok: false, error: `${runId} belongs to ${run.owner}; only they or an admin can stop it.` });
      return;
    }
    const body = parseJson(raw);
    if (body.all === true) {
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
    if (req.method === 'GET' && url.pathname === '/login') {
      send(res, 200, readFileSync(LOGIN_HTML_PATH, 'utf8'), 'text/html; charset=utf-8');
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/qa/login') {
      const body = parseJson(await readBody(req));
      const result = auth.login(req, body.name, body.password);
      if (!result.ok) {
        send(res, result.status, { ok: false, error: result.error });
        return;
      }
      send(res, 200, { ok: true, user: result.user }, undefined, { 'Set-Cookie': result.cookie });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/qa/logout') {
      send(res, 200, { ok: true }, undefined, { 'Set-Cookie': auth.logout(req) });
      return;
    }

    const who = identify(req, url);
    if (!who.ok) {
      if (who.status === 302) {
        redirect(res, who.redirect, { 'Set-Cookie': who.cookie });
      } else if (url.pathname.startsWith('/api/') || RUN_PATH.test(url.pathname) && url.pathname.includes('/api/')) {
        send(res, who.status, { ok: false, error: who.message, login: who.login === true });
      } else if (who.login) {
        redirect(res, `/login?next=${encodeURIComponent(url.pathname + url.search)}`);
      } else {
        send(res, who.status, deniedPage(who.message), 'text/html; charset=utf-8');
      }
      return;
    }
    if (req.method === 'POST' && who.user.role === 'viewer') {
      send(res, 403, { ok: false, error: 'View-only account: ask an admin for tester access to run or stop tests.' });
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
        send(res, 200, accessView(who));
        return;
      }
      if (url.pathname === '/api/qa/catalog') {
        send(res, 200, catalogView());
        return;
      }
      if (url.pathname === '/api/qa/runs') {
        send(res, 200, { me: who.user, capacity: manager.capacity(), runs: manager.list() });
        return;
      }
      const runRead = url.pathname.match(/^\/api\/qa\/runs\/(RUN-\d{4,})$/u);
      if (runRead) {
        const run = manager.get(runRead[1]);
        if (run === undefined) {
          send(res, 404, { ok: false, error: `${runRead[1]} not found.` });
          return;
        }
        send(res, 200, { run, log: manager.log(run.id, Number(url.searchParams.get('since') ?? 0)) });
        return;
      }
      // Root-level monitor reads (older bookmarks, the in-page links) follow the default run.
      if (PROXY_GET.has(url.pathname) || url.pathname.startsWith(PROXY_GET_PREFIX)) {
        await proxyToRun(req, res, defaultRunId(who.user), url.pathname, url.search, Buffer.alloc(0));
        return;
      }
    }

    if (req.method === 'POST') {
      if (url.pathname === '/api/qa/run') {
        const result = manager.submit(who.user, parseJson(await readBody(req)));
        send(res, result.status, result.body);
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

server.listen(port, serverMode || share !== undefined ? '0.0.0.0' : '127.0.0.1', () => {
  const pageUrl = `http://127.0.0.1:${port}/`;
  const capacity = manager.capacity();
  console.log(`SGAP control panel: ${pageUrl}   (this PC signs in as ${HOST_USER.name}, admin)`);
  console.log(
    `Capacity: up to ${capacity.maxBrowsers} game browsers at once (${capacity.limitedBy.detail})` +
      `${capacity.maxRuns ? `, ${capacity.maxRuns} runs` : ''}. Tune in .sgap/qa-server.json.`,
  );
  if (serverMode) {
    const urls = lanUrls(port, '').map((entry) => entry.replace(/\?key=$/u, ''));
    console.log('Shared QA server — teammates open:');
    for (const entry of urls.length > 0 ? urls : [`http://<this-pc-ip>:${port}/`]) console.log(`  ${entry}`);
    console.log(
      auth.enabled()
        ? 'Each QA signs in with their own account (npx pnpm qa:users list).'
        : 'No QA accounts yet — remote sign-in is closed until you add one: npx pnpm qa:users add <name> --role admin',
    );
  } else if (share !== undefined) {
    const urls = lanUrls(port, share.key);
    console.log(`Shared on the local network (${share.mode === 'view' ? 'view only' : 'control'}) — open on the other PC:`);
    for (const entry of urls.length > 0 ? urls : [`http://<this-pc-ip>:${port}/?key=${share.key}`]) console.log(`  ${entry}`);
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
