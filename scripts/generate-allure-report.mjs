/**
 * Build Allure HTML into a timestamped history folder (never overwrite prior runs),
 * refresh allure-report/ as the latest copy, rebuild the history index, then open
 * the index in the browser so every past report is one click away.
 *
 * Parallel workers write allure-results/w<laneId>. A single-process run writes
 * allure-results/. Prefer the worker folders when they exist so an older
 * root dump is not mixed into the same report.
 *
 * Layout:
 *   allure-history/run-YYYYMMDD-HHmmss/   — immutable per-run report
 *   allure-history/index.html             — browse all runs
 *   allure-report/                        — latest run (compat shortcut)
 *
 * Env:
 *   SGAP_SKIP_ALLURE=1       — skip generate + open
 *   SGAP_SKIP_ALLURE_OPEN=1  — generate only (no browser)
 *   SGAP_ALLURE_OPEN=0       — same as SKIP_ALLURE_OPEN
 *   SGAP_ALLURE_HISTORY_PORT — index server port (default 5055)
 */
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const allureBin = require.resolve('allure-commandline/bin/allure');
const REPORT_DIR = 'allure-report';
const HISTORY_DIR = 'allure-history';
const DEFAULT_HISTORY_PORT = 5055;

export function resolveAllureSources(rootDir = process.cwd()) {
  const resultsRoot = path.join(rootDir, 'allure-results');
  const laneIds = existsSync(resultsRoot)
    ? readdirSync(resultsRoot)
        .map((name) => /^w(\d+)$/u.exec(name)?.[1])
        .filter((id) => id !== undefined)
        .map(Number)
        .sort((a, b) => a - b)
    : [];
  const workerDirs = laneIds
    .map((id) => path.join(resultsRoot, `w${id}`))
    .filter((dir) => existsSync(dir) && hasResultFiles(dir));
  if (workerDirs.length > 0) {
    return workerDirs;
  }
  const root = path.join(rootDir, 'allure-results');
  if (existsSync(root) && hasResultFiles(root)) {
    return [root];
  }
  return [];
}

function hasResultFiles(dir) {
  try {
    return readdirSync(dir).some((name) => name.endsWith('-result.json'));
  } catch {
    return false;
  }
}

function runStamp(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return (
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  );
}

function readRunSummary(reportAbs) {
  const summaryPath = path.join(reportAbs, 'widgets', 'summary.json');
  if (!existsSync(summaryPath)) {
    return undefined;
  }
  try {
    const raw = JSON.parse(readFileSync(summaryPath, 'utf8'));
    const statistic = raw.statistic ?? {};
    return {
      passed: statistic.passed ?? 0,
      failed: statistic.failed ?? 0,
      broken: statistic.broken ?? 0,
      skipped: statistic.skipped ?? 0,
      unknown: statistic.unknown ?? 0,
      total: statistic.total ?? 0,
      durationMs: raw.time?.duration,
    };
  } catch {
    return undefined;
  }
}

function listHistoryRuns(cwd) {
  const root = path.join(cwd, HISTORY_DIR);
  if (!existsSync(root)) {
    return [];
  }
  return readdirSync(root)
    .filter((name) => name.startsWith('run-'))
    .map((name) => {
      const abs = path.join(root, name);
      let mtime = 0;
      try {
        mtime = statSync(abs).mtimeMs;
      } catch {
        mtime = 0;
      }
      return {
        id: name,
        abs,
        rel: path.join(HISTORY_DIR, name).replace(/\\/g, '/'),
        mtime,
        summary: readRunSummary(abs),
      };
    })
    .filter((entry) => existsSync(path.join(entry.abs, 'index.html')))
    .sort((a, b) => b.mtime - a.mtime);
}

function formatDuration(ms) {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) {
    return '—';
  }
  const sec = Math.round(ms / 1000);
  if (sec < 60) {
    return `${sec}s`;
  }
  const min = Math.floor(sec / 60);
  const rem = sec % 60;
  return `${min}m ${rem}s`;
}

function writeHistoryIndex(cwd) {
  const runs = listHistoryRuns(cwd);
  const rows = runs
    .map((run, index) => {
      const s = run.summary;
      const when = run.id.replace(/^run-/, '').replace(
        /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})$/,
        '$1-$2-$3 $4:$5:$6',
      );
      const stats = s
        ? `<span class="ok">${s.passed} passed</span>` +
          (s.failed || s.broken
            ? ` · <span class="bad">${(s.failed ?? 0) + (s.broken ?? 0)} failed</span>`
            : '') +
          (s.skipped ? ` · <span class="muted">${s.skipped} skipped</span>` : '') +
          ` · <span class="muted">${s.total} total</span>`
        : '<span class="muted">summary unavailable</span>';
      const latest = index === 0 ? ' <span class="tag">latest</span>' : '';
      return `<tr>
  <td><a href="./${run.id}/index.html">${when}</a>${latest}</td>
  <td>${stats}</td>
  <td class="muted">${formatDuration(s?.durationMs)}</td>
  <td><a class="btn" href="./${run.id}/index.html">Open</a></td>
</tr>`;
    })
    .join('\n');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>SGAP Allure history</title>
  <style>
    :root { color-scheme: light dark; font-family: ui-sans-serif, system-ui, sans-serif; }
    body { margin: 0; padding: 2rem; line-height: 1.45; }
    h1 { margin: 0 0 0.25rem; font-size: 1.5rem; }
    p { margin: 0 0 1.25rem; opacity: 0.75; }
    table { width: 100%; border-collapse: collapse; }
    th, td { text-align: left; padding: 0.65rem 0.75rem; border-bottom: 1px solid color-mix(in srgb, currentColor 18%, transparent); }
    th { font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.04em; opacity: 0.65; }
    a { color: inherit; }
    .btn { display: inline-block; padding: 0.25rem 0.7rem; border-radius: 999px; border: 1px solid color-mix(in srgb, currentColor 30%, transparent); text-decoration: none; font-size: 0.9rem; }
    .btn:hover { background: color-mix(in srgb, currentColor 8%, transparent); }
    .ok { color: #1a7f37; }
    .bad { color: #cf222e; }
    .muted { opacity: 0.65; }
    .tag { font-size: 0.7rem; padding: 0.1rem 0.4rem; border-radius: 999px; background: color-mix(in srgb, #1a7f37 18%, transparent); color: #1a7f37; margin-left: 0.35rem; vertical-align: middle; }
    @media (prefers-color-scheme: dark) {
      .ok { color: #3fb950; }
      .bad { color: #ff7b72; }
      .tag { color: #3fb950; background: color-mix(in srgb, #3fb950 18%, transparent); }
    }
  </style>
</head>
<body>
  <h1>SGAP Allure history</h1>
  <p>${runs.length} saved report${runs.length === 1 ? '' : 's'} · each run is kept separately under <code>allure-history/</code></p>
  <table>
    <thead>
      <tr><th>Run</th><th>Results</th><th>Duration</th><th></th></tr>
    </thead>
    <tbody>
${rows || '<tr><td colspan="4" class="muted">No reports yet.</td></tr>'}
    </tbody>
  </table>
</body>
</html>
`;

  const historyRoot = path.join(cwd, HISTORY_DIR);
  mkdirSync(historyRoot, { recursive: true });
  writeFileSync(path.join(historyRoot, 'index.html'), html, 'utf8');
  return runs;
}

function historyPort() {
  const raw = process.env.SGAP_ALLURE_HISTORY_PORT?.trim();
  const n = raw ? Number(raw) : DEFAULT_HISTORY_PORT;
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_HISTORY_PORT;
}

async function portOpen(port) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/', timeout: 400 }, (res) => {
      res.resume();
      resolve(true);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
  });
}

/**
 * Serve allure-history/ on a fixed port (reuses if already up).
 */
export async function ensureHistoryServer(options = {}) {
  const cwd = options.cwd ?? process.cwd();
  const port = options.port ?? historyPort();
  if (await portOpen(port)) {
    return { ok: true, port, reused: true, url: `http://127.0.0.1:${port}/` };
  }

  const serverScript = path.join(path.dirname(fileURLToPath(import.meta.url)), 'serve-allure-history.mjs');
  const child = spawn(process.execPath, [serverScript, String(port)], {
    cwd,
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    env: { ...process.env, SGAP_ALLURE_HISTORY_ROOT: path.join(cwd, HISTORY_DIR) },
  });
  child.unref();

  for (let i = 0; i < 20; i += 1) {
    await new Promise((r) => setTimeout(r, 150));
    if (await portOpen(port)) {
      return { ok: true, port, reused: false, url: `http://127.0.0.1:${port}/` };
    }
  }
  return { ok: false, port, url: `http://127.0.0.1:${port}/` };
}

function openBrowser(url) {
  const platform = process.platform;
  if (platform === 'win32') {
    spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref();
    return;
  }
  if (platform === 'darwin') {
    spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
    return;
  }
  spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
}

const SERVER_CATEGORY = {
  name: 'Server-side failures',
  matchedStatuses: ['failed', 'broken'],
  messageRegex: '(?s).*SERVER:.*',
};

/** Backend rejections (ScratchHubServerError etc.) get their own bucket ahead of product/test defects. */
function ensureServerCategory(sourceAbs) {
  const file = path.join(sourceAbs, 'categories.json');
  let categories = [];
  if (existsSync(file)) {
    try {
      const parsed = JSON.parse(readFileSync(file, 'utf8'));
      categories = Array.isArray(parsed) ? parsed : [];
    } catch {
      categories = [];
    }
  }
  if (categories.some((entry) => entry?.name === SERVER_CATEGORY.name)) {
    return;
  }
  writeFileSync(file, `${JSON.stringify([SERVER_CATEGORY, ...categories], null, 2)}\n`, 'utf8');
}

export function generateAllureReport(options = {}) {
  const cwd = options.cwd ?? process.cwd();
  const sources = (options.sources ?? resolveAllureSources(cwd)).map((dir) =>
    path.isAbsolute(dir) ? path.relative(cwd, dir) : dir,
  );
  if (sources.length === 0) {
    console.log('Allure: no result files found');
    return { ok: false, sources: [] };
  }
  for (const source of sources) {
    ensureServerCategory(path.join(cwd, source));
  }

  const stamp = options.stamp ?? runStamp();
  const historyRel = path.join(HISTORY_DIR, `run-${stamp}`);
  const historyAbs = path.join(cwd, historyRel);
  mkdirSync(path.dirname(historyAbs), { recursive: true });

  console.log('');
  console.log(`Allure: generating report from ${sources.join(', ')}`);
  console.log(`Allure: history → ${historyRel}`);
  const result = spawnSync(
    process.execPath,
    [allureBin, 'generate', ...sources, '--clean', '-o', historyRel],
    { cwd, stdio: 'inherit' },
  );
  const ok = result.status === 0;
  if (!ok) {
    console.log(`Allure: generate failed (exit ${result.status ?? 1})`);
    return { ok: false, sources, status: result.status ?? 1 };
  }

  // Latest shortcut for old habits / CI that expect allure-report/
  try {
    rmSync(path.join(cwd, REPORT_DIR), { recursive: true, force: true });
    cpSync(historyAbs, path.join(cwd, REPORT_DIR), { recursive: true });
  } catch (error) {
    console.log(`Allure: could not refresh ${REPORT_DIR}: ${error.message}`);
  }

  const runs = writeHistoryIndex(cwd);
  console.log(`Allure: report written to ${historyAbs}`);
  console.log(`Allure: history index ${path.join(cwd, HISTORY_DIR, 'index.html')} (${runs.length} run(s))`);
  console.log(`Allure: latest shortcut → ${path.join(cwd, REPORT_DIR)}`);

  return {
    ok: true,
    sources,
    status: 0,
    historyDir: historyRel,
    historyAbs,
    reportDir: REPORT_DIR,
    stamp,
    runs: runs.length,
  };
}

/**
 * Open the history index (all runs) in the browser. Falls back to latest report.
 */
export async function openAllureReport(options = {}) {
  if (
    process.env.SGAP_SKIP_ALLURE_OPEN === '1' ||
    process.env.SGAP_ALLURE_OPEN === '0'
  ) {
    console.log('Allure: open skipped (SGAP_SKIP_ALLURE_OPEN / SGAP_ALLURE_OPEN=0)');
    return { ok: false, skipped: true };
  }

  const cwd = options.cwd ?? process.cwd();
  writeHistoryIndex(cwd);

  if (options.reportDir !== undefined) {
    const reportDir = options.reportDir;
    const absolute = path.isAbsolute(reportDir) ? reportDir : path.join(cwd, reportDir);
    if (!existsSync(absolute)) {
      console.log(`Allure: nothing to open at ${absolute}`);
      return { ok: false };
    }
    console.log(`Allure: opening ${absolute}`);
    const child = spawn(process.execPath, [allureBin, 'open', reportDir], {
      cwd,
      detached: true,
      stdio: 'ignore',
      windowsHide: false,
    });
    child.unref();
    return { ok: true, pid: child.pid };
  }

  const server = await ensureHistoryServer({ cwd });
  if (!server.ok) {
    console.log(`Allure: history server did not start on port ${server.port}`);
    return { ok: false };
  }
  console.log(`Allure: opening history index ${server.url}`);
  openBrowser(server.url);
  return { ok: true, url: server.url, port: server.port };
}

/**
 * Generate then open the history index. Used by every staging/parallel/regression runner.
 */
export async function publishAllureReport(options = {}) {
  if (process.env.SGAP_SKIP_ALLURE === '1') {
    console.log('Allure: skipped (SGAP_SKIP_ALLURE=1)');
    return { ok: false, skipped: true };
  }
  const generated = generateAllureReport(options);
  if (!generated.ok) {
    return { ...generated, opened: false };
  }
  const opened = await openAllureReport(options);
  return { ...generated, opened: opened.ok === true, url: opened.url };
}

const scriptName = process.argv[1] !== undefined ? path.normalize(process.argv[1]) : '';
const isDirectGenerate = scriptName.endsWith(`${path.sep}generate-allure-report.mjs`);

if (isDirectGenerate) {
  const { ok } = generateAllureReport();
  process.exit(ok ? 0 : 1);
}
