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
        meta: readRunMeta(abs),
      };
    })
    .filter((entry) => existsSync(path.join(entry.abs, 'index.html')))
    .sort((a, b) => b.mtime - a.mtime);
}

const RUN_META = 'sgap-run.json';

/** Who started a run managed by the execution manager (written next to its report). */
function readRunMeta(reportAbs) {
  try {
    return JSON.parse(readFileSync(path.join(reportAbs, RUN_META), 'utf8'));
  } catch {
    return undefined;
  }
}

function escHtml(value) {
  return String(value ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
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

export function writeHistoryIndex(cwd) {
  const runs = listHistoryRuns(cwd);
  const rows = runs
    .map((run, index) => {
      const s = run.summary;
      const when = run.id.replace(/^run-/, '').replace(
        /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})(?:-.+)?$/,
        '$1-$2-$3 $4:$5:$6',
      );
      const suiteType = run.meta?.label ?? run.meta?.suiteType ?? run.meta?.runId;
      const failed = s ? (s.failed ?? 0) + (s.broken ?? 0) : 0;
      const outcome = !s ? 'unknown' : failed > 0 ? 'failed' : s.passed > 0 ? 'passed' : 'unknown';
      const pct = (n) => (s && s.total ? ((100 * n) / s.total).toFixed(1) : 0);
      const stats = s
        ? `<div class="nums"><span class="ok">${s.passed} passed</span>` +
          (failed ? `<span class="bad">${failed} failed</span>` : '') +
          (s.skipped ? `<span class="muted">${s.skipped} skipped</span>` : '') +
          `<span class="muted">${s.total} total</span></div>` +
          `<div class="meter"><i class="ok" style="width:${pct(s.passed)}%"></i><i class="bad" style="width:${pct(failed)}%"></i></div>`
        : '<span class="muted">Summary unavailable</span>';
      const latest = index === 0 ? '<span class="tag">Latest</span>' : '';
      const meta = run.meta
        ? `<span class="mono">${escHtml(run.meta.runId)}</span><span class="muted">${escHtml(run.meta.owner ?? '—')}</span>`
        : '<span class="muted">—</span>';
      return `<tr class="${outcome}" data-outcome="${outcome}" data-text="${escHtml(`${suiteType ?? ''} ${when} ${run.meta?.runId ?? ''} ${run.meta?.owner ?? ''}`.toLowerCase())}">
  <td><a class="name" href="./${run.id}/index.html"><span class="bar"></span><span><b>${escHtml(suiteType ?? when)}</b>${latest}<span class="muted">${when}</span></span></a></td>
  <td class="who">${meta}</td>
  <td class="res">${stats}</td>
  <td class="muted mono">${formatDuration(s?.durationMs)}</td>
  <td class="act"><a class="btn" href="./${run.id}/index.html">Open report</a></td>
</tr>`;
    })
    .join('\n');
  const counts = runs.reduce(
    (acc, run) => {
      const s = run.summary;
      const failed = s ? (s.failed ?? 0) + (s.broken ?? 0) : 0;
      acc[!s ? 'unknown' : failed > 0 ? 'failed' : s.passed > 0 ? 'passed' : 'unknown'] += 1;
      return acc;
    },
    { passed: 0, failed: 0, unknown: 0 },
  );
  const latestSummary = runs[0]?.summary;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>SGAP Reports</title>
  <style>
    :root {
      --canvas: #101112; --sidebar: #191b1c; --surface: #242628; --elevated: #303237;
      --accent: #8b5cf6; --accent-strong: #a78bfa; --accent-soft: rgba(139, 92, 246, 0.16); --accent-line: rgba(139, 92, 246, 0.55);
      --pass: #57ba83; --pass-soft: rgba(87, 186, 131, 0.14); --run: #d6a34a; --fail: #de7474; --fail-soft: rgba(222, 116, 116, 0.14);
      --text: #f2f2f3; --muted: #a0a3a8; --faint: #6f7277; --line: rgba(255, 255, 255, 0.07); --line-soft: rgba(255, 255, 255, 0.05);
      --mono: "Geist Mono", "JetBrains Mono", "Cascadia Code", Consolas, monospace;
      --ease: cubic-bezier(0.2, 0, 0, 1);
      color-scheme: dark;
    }
    * { box-sizing: border-box; }
    html, body { height: 100%; }
    body {
      margin: 0; display: grid; grid-template-columns: 76px minmax(0, 1fr);
      background: var(--canvas); color: var(--text); line-height: 1.45;
      font: 14px "Geist", "Inter", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif;
    }
    a { color: inherit; text-decoration: none; }
    .mono { font-family: var(--mono); }
    .muted { color: var(--faint); }
    .rail {
      position: sticky; top: 0; height: 100vh; display: flex; flex-direction: column; align-items: center; gap: 8px;
      padding: 16px 0; background: var(--sidebar); border-right: 1px solid var(--line);
    }
    .rail .mark { width: 40px; height: 40px; border-radius: 12px; display: grid; place-items: center; background: #f4f4f4; color: #111; margin-bottom: 8px; }
    .rail a.nav { width: 40px; height: 40px; border-radius: 12px; display: grid; place-items: center; color: #c4c6ca; transition: background 0.14s var(--ease), color 0.14s var(--ease); }
    .rail a.nav:hover { background: var(--surface); color: #fff; }
    .rail a.nav.on { background: var(--elevated); color: #fff; box-shadow: inset 2px 0 0 var(--accent); }
    .rail svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
    .workspace { min-width: 0; padding: 0 24px 24px; display: flex; flex-direction: column; gap: 16px; }
    .utility {
      position: sticky; top: 0; z-index: 5; display: flex; align-items: center; gap: 10px; height: 60px;
      margin: 0 -24px; padding: 0 24px; background: var(--canvas); border-bottom: 1px solid var(--line-soft);
    }
    .crumbs { display: flex; gap: 8px; font-size: 13px; color: var(--faint); }
    .crumbs b { color: var(--text); font-weight: 600; }
    .spacer { flex: 1; }
    .search {
      width: 260px; height: 34px; padding: 0 12px; border-radius: 10px; border: 1px solid var(--line);
      background: var(--sidebar); color: var(--text); font: inherit; font-size: 13px; outline: none;
    }
    .search:focus { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
    h1 { margin: 0; font-size: 24px; font-weight: 650; letter-spacing: -0.02em; line-height: 1.15; }
    .sub { margin: 4px 0 0; color: var(--faint); font-size: 12px; }
    .sub code { font-family: var(--mono); color: var(--muted); }
    .pills { display: flex; flex-wrap: wrap; gap: 8px; }
    .kpi {
      display: inline-flex; align-items: center; gap: 8px; height: 32px; padding: 0 12px; border-radius: 999px;
      background: var(--sidebar); border: 1px solid var(--line); color: var(--muted); font-family: inherit; font-size: 12px; font-weight: 500; cursor: pointer;
      transition: background 0.14s var(--ease), border-color 0.14s var(--ease), color 0.14s var(--ease);
    }
    .kpi:hover { background: var(--surface); color: var(--text); }
    .kpi.on { border-color: var(--accent-line); background: var(--accent-soft); color: var(--text); }
    .kpi.static { cursor: default; }
    .kpi b { color: var(--text); font: 600 13px var(--mono); }
    .kpi .dot { width: 6px; height: 6px; border-radius: 50%; background: var(--accent); }
    .kpi.p .dot { background: var(--pass); } .kpi.p b { color: var(--pass); }
    .kpi.f .dot { background: var(--fail); } .kpi.f b { color: var(--fail); }
    .panel { background: var(--sidebar); border: 1px solid var(--line); border-radius: 18px; overflow: hidden; }
    .panel-head { display: flex; align-items: center; gap: 8px; min-height: 48px; padding: 0 16px; border-bottom: 1px solid var(--line-soft); }
    .panel-head h2 { margin: 0; font-size: 14px; font-weight: 600; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th { text-align: left; color: var(--faint); font-weight: 600; font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; padding: 10px 16px; border-bottom: 1px solid var(--line); }
    td { padding: 12px 16px; border-top: 1px solid var(--line-soft); vertical-align: middle; }
    tbody tr { transition: background 0.14s var(--ease); }
    tbody tr:hover { background: var(--surface); }
    .name { display: flex; gap: 12px; align-items: stretch; }
    .name .bar { width: 3px; border-radius: 3px; background: var(--faint); flex: none; }
    tr.passed .name .bar { background: var(--pass); }
    tr.failed .name .bar { background: var(--fail); }
    .name b { font-weight: 600; margin-right: 8px; }
    .name .muted { display: block; font-size: 12px; }
    .who span { display: block; }
    .who .muted { font-size: 12px; }
    .res { min-width: 240px; }
    .nums { display: flex; gap: 10px; font-size: 12px; }
    .ok { color: var(--pass); }
    .bad { color: var(--fail); }
    .meter { display: flex; height: 4px; margin-top: 6px; border-radius: 999px; overflow: hidden; background: var(--elevated); max-width: 260px; }
    .meter .ok { background: var(--pass); }
    .meter .bad { background: var(--fail); }
    .tag { font-size: 11px; font-weight: 600; padding: 2px 8px; border-radius: 999px; background: var(--accent-soft); color: var(--accent-strong); vertical-align: middle; }
    .act { text-align: right; }
    .btn {
      display: inline-flex; align-items: center; height: 30px; padding: 0 12px; border-radius: 10px; font-size: 12px; font-weight: 600;
      background: var(--surface); border: 1px solid var(--line); color: var(--text); white-space: nowrap;
      transition: background 0.14s var(--ease), border-color 0.14s var(--ease);
    }
    .btn:hover { background: var(--accent); border-color: var(--accent); color: #fff; }
    .empty { padding: 40px 16px; text-align: center; color: var(--faint); }
    @media (max-width: 900px) {
      .who, th:nth-child(2), td:nth-child(4), th:nth-child(4) { display: none; }
    }
    @media (max-width: 640px) {
      body { grid-template-columns: 1fr; }
      .rail { display: none; }
      .workspace { padding: 0 12px 12px; }
      .utility { margin: 0 -12px; padding: 0 12px; }
      .search { width: 100%; }
      .crumbs { display: none; }
      .res { min-width: 0; }
    }
  </style>
</head>
<body>
  <aside class="rail" aria-label="Navigation">
    <div class="mark" title="SGAP"><svg viewBox="0 0 24 24"><path d="M12 2 3 7v10l9 5 9-5V7z"/><path d="m3 7 9 5 9-5M12 12v10"/></svg></div>
    <a class="nav" data-page="/dashboard" title="Dashboard"><svg viewBox="0 0 24 24"><path d="M3 3v18h18"/><path d="M7 15v3M11 11v7M15 13v5M19 7v11"/></svg></a>
    <a class="nav" data-page="/" title="Test runner"><svg viewBox="0 0 24 24"><path d="M7 4.5v15a1 1 0 0 0 1.5.86l12-7.5a1 1 0 0 0 0-1.72l-12-7.5A1 1 0 0 0 7 4.5z"/></svg></a>
    <a class="nav" data-page="/observe" title="Observer"><svg viewBox="0 0 24 24"><path d="M3 12h4l3-8 4 16 3-8h4"/></svg></a>
    <a class="nav" data-page="/reader" title="Backend Reader"><svg viewBox="0 0 24 24"><ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5"/><path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/></svg></a>
    <a class="nav on" href="./" title="Reports" aria-current="page"><svg viewBox="0 0 24 24"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M9 17v-3M12 17v-6M15 17v-2"/></svg></a>
  </aside>
  <div class="workspace">
    <header class="utility">
      <nav class="crumbs" aria-label="Breadcrumb"><span>QA Workspace</span><span>/</span><b>Reports</b></nav>
      <div class="spacer"></div>
      <input class="search" id="search" type="search" placeholder="Search reports, runs, owners" aria-label="Search reports" autocomplete="off" />
    </header>
    <div>
      <h1>Reports</h1>
      <p class="sub">${runs.length} saved Allure report${runs.length === 1 ? '' : 's'} · each run is kept separately under <code>allure-history/</code></p>
    </div>
    <div class="pills" id="pills" role="toolbar" aria-label="Filter by outcome">
      <button type="button" class="kpi on" data-filter="all"><span class="dot"></span><span>All</span><b>${runs.length}</b></button>
      <button type="button" class="kpi p" data-filter="passed"><span class="dot"></span><span>Passed</span><b>${counts.passed}</b></button>
      <button type="button" class="kpi f" data-filter="failed"><span class="dot"></span><span>With failures</span><b>${counts.failed}</b></button>
      ${latestSummary ? `<span class="kpi static"><span>Latest run</span><b>${latestSummary.passed}/${latestSummary.total}</b></span>` : ''}
    </div>
    <section class="panel" aria-label="Report history">
      <div class="panel-head"><h2>Report history</h2><span class="muted" style="font-size:12px">newest first</span></div>
      <table>
        <thead>
          <tr><th>Run</th><th>Started by</th><th>Results</th><th>Duration</th><th></th></tr>
        </thead>
        <tbody id="rows">
${rows || '<tr><td colspan="5" class="empty">No reports yet. Reports appear here after a run publishes Allure.</td></tr>'}
        </tbody>
      </table>
      <div class="empty" id="no-match" hidden>No reports match this filter.</div>
    </section>
  </div>
  <script>
    const panel = location.port === '5055' || location.protocol === 'file:' ? 'http://127.0.0.1:3850' : '';
    document.querySelectorAll('a[data-page]').forEach((a) => { a.href = panel + a.dataset.page; });
    let filter = 'all';
    const search = document.getElementById('search');
    function apply() {
      const q = search.value.trim().toLowerCase();
      let shown = 0;
      document.querySelectorAll('#rows tr[data-outcome]').forEach((tr) => {
        const ok = (filter === 'all' || tr.dataset.outcome === filter) && (!q || tr.dataset.text.includes(q));
        tr.hidden = !ok;
        if (ok) shown += 1;
      });
      document.getElementById('no-match').hidden = shown > 0 || !document.querySelector('#rows tr[data-outcome]');
      document.querySelectorAll('#pills [data-filter]').forEach((b) => b.classList.toggle('on', b.dataset.filter === filter));
    }
    document.getElementById('pills').addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-filter]');
      if (!b) return;
      filter = filter === b.dataset.filter ? 'all' : b.dataset.filter;
      apply();
    });
    search.addEventListener('input', apply);
    document.addEventListener('keydown', (ev) => {
      if (ev.key === '/' && document.activeElement !== search) { ev.preventDefault(); search.focus(); }
      if (ev.key === 'Escape') { search.value = ''; filter = 'all'; apply(); search.blur(); }
    });
  </script>
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

const NOT_CONFIGURED_CATEGORY = {
  name: 'NOT CONFIGURED',
  matchedStatuses: ['failed', 'broken'],
  messageRegex: '(?s).*NOT CONFIGURED —.*',
};

const INCONCLUSIVE_CATEGORY = {
  name: 'INCONCLUSIVE',
  matchedStatuses: ['skipped'],
  messageRegex: '(?s).*INCONCLUSIVE —.*',
};

const PREPEND_CATEGORIES = [SERVER_CATEGORY, NOT_CONFIGURED_CATEGORY, INCONCLUSIVE_CATEGORY];

/**
 * Keep Allure buckets for server errors, capability-gate configuration gaps,
 * and bounded INCONCLUSIVE skips ahead of product/test defects. Writes only the
 * current allure-results source; historical allure-history/ reports are not rewritten.
 */
function ensureReportCategories(sourceAbs) {
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
  const prependNames = new Set(PREPEND_CATEGORIES.map((entry) => entry.name));
  const rest = categories.filter((entry) => !prependNames.has(entry?.name));
  const next = [...PREPEND_CATEGORIES, ...rest];
  if (JSON.stringify(categories) === JSON.stringify(next)) {
    return;
  }
  writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
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
    ensureReportCategories(path.join(cwd, source));
  }

  const stamp = options.stamp ?? (options.runId ? `${runStamp()}-${options.runId}` : runStamp());
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

  writeFileSync(
    path.join(historyAbs, RUN_META),
    `${JSON.stringify(
      {
        runId: options.runId ?? stamp,
        owner: options.owner ?? 'sgap',
        label: options.label ?? options.runId ?? stamp,
        suiteType: options.label ?? options.runId ?? 'Test',
      },
      null,
      2,
    )}\n`,
    'utf8',
  );

  // Latest shortcut for old habits / CI that expect allure-report/
  if (options.latestShortcut !== false) {
    try {
      rmSync(path.join(cwd, REPORT_DIR), { recursive: true, force: true });
      cpSync(historyAbs, path.join(cwd, REPORT_DIR), { recursive: true });
    } catch (error) {
      console.log(`Allure: could not refresh ${REPORT_DIR}: ${error.message}`);
    }
  }

  const runs = writeHistoryIndex(cwd);
  console.log(`Allure: report written to ${historyAbs}`);
  console.log(`Allure: history index ${path.join(cwd, HISTORY_DIR, 'index.html')} (${runs.length} run(s))`);
  if (options.latestShortcut !== false) console.log(`Allure: latest shortcut → ${path.join(cwd, REPORT_DIR)}`);

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
