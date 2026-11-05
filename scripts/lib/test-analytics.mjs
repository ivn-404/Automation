/**
 * Historical test analytics for the SGAP dashboard, read from the published
 * Allure reports under allure-history/run-* (one folder per run, never rewritten).
 *
 * Each run folder is parsed once and cached by folder name + mtime, in memory and
 * in allure-history/.sgap-analytics.json, so restarts and polls stay cheap.
 * Reads are async so a cold parse never blocks the control panel.
 *
 * Shape returned by loadAnalytics():
 *   runs:  [{ id, at, label, owner, runId, passed, failed, skipped, total, durationMs }]
 *   tests: [[runIndex, at, caseId, gameId, packageId, feature, status, durationMs, category, message]]
 * Retried attempts (retry/hidden) are dropped: only each test's final result counts.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';

const CACHE_FILE = '.sgap-analytics.json';
const CACHE_VERSION = 1;
const cache = new Map();
let diskLoaded = false;
let pending;

async function readJson(file) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return undefined;
  }
}

/** run-20261021-141131[-label] → local timestamp in ms. */
function stampTime(name) {
  const m = /^run-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})/u.exec(name);
  return m ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime() : undefined;
}

function label(labels, name) {
  return labels.find((entry) => entry.name === name)?.value;
}

async function parseRun(abs, name, mtime) {
  const summary = await readJson(path.join(abs, 'widgets', 'summary.json'));
  const meta = (await readJson(path.join(abs, 'sgap-run.json'))) ?? {};
  const stat_ = summary?.statistic ?? {};
  const dir = path.join(abs, 'data', 'test-cases');
  let files = [];
  try {
    files = (await readdir(dir)).filter((file) => file.endsWith('.json'));
  } catch {
    files = [];
  }
  const cases = await Promise.all(files.map((file) => readJson(path.join(dir, file))));
  const tests = [];
  let firstStart;
  for (const tc of cases) {
    if (tc === undefined || tc.retry === true || tc.hidden === true) continue;
    const labels = Array.isArray(tc.labels) ? tc.labels : [];
    const start = tc.time?.start;
    if (Number.isFinite(start) && (firstStart === undefined || start < firstStart)) firstStart = start;
    tests.push({
      at: start,
      caseId: label(labels, 'manualTestId') ?? /^([A-Z]+-\d+)/u.exec(tc.name ?? '')?.[1] ?? tc.name ?? '',
      gameId: label(labels, 'gameId') ?? '',
      packageId: label(labels, 'packageId') ?? '',
      feature: label(labels, 'feature') ?? label(labels, 'subSuite') ?? '',
      status: tc.status === 'broken' ? 'failed' : tc.status ?? 'unknown',
      durationMs: tc.time?.duration ?? 0,
      category: tc.extra?.categories?.[0]?.name ?? '',
      message: typeof tc.statusMessage === 'string' ? tc.statusMessage.split('\n')[0].slice(0, 200) : '',
    });
  }
  const at = firstStart ?? stampTime(name) ?? mtime;
  return {
    run: {
      id: name,
      at,
      label: meta.label ?? meta.suiteType ?? name,
      owner: meta.owner ?? '',
      runId: meta.runId ?? '',
      passed: stat_.passed ?? 0,
      failed: (stat_.failed ?? 0) + (stat_.broken ?? 0),
      skipped: stat_.skipped ?? 0,
      total: stat_.total ?? 0,
      durationMs: summary?.time?.duration ?? 0,
    },
    tests: tests.map((t) => ({ ...t, at: t.at ?? at })),
  };
}

function loadDiskCache(root) {
  diskLoaded = true;
  try {
    const raw = JSON.parse(readFileSync(path.join(root, CACHE_FILE), 'utf8'));
    if (raw.version !== CACHE_VERSION) return;
    for (const [name, entry] of Object.entries(raw.entries ?? {})) cache.set(name, entry);
  } catch {
    /* no cache yet */
  }
}

async function build(root) {
  if (!diskLoaded) loadDiskCache(root);
  const names = (await readdir(root)).filter((name) => name.startsWith('run-'));
  let changed = false;
  const parsed = [];
  for (const name of names) {
    const abs = path.join(root, name);
    let mtime;
    try {
      if (!existsSync(path.join(abs, 'index.html'))) continue;
      mtime = (await stat(abs)).mtimeMs;
    } catch {
      continue;
    }
    let hit = cache.get(name);
    if (hit === undefined || hit.mtime !== mtime) {
      hit = { mtime, data: await parseRun(abs, name, mtime) };
      cache.set(name, hit);
      changed = true;
    }
    parsed.push(hit.data);
  }
  for (const name of [...cache.keys()]) {
    if (!names.includes(name)) {
      cache.delete(name);
      changed = true;
    }
  }
  if (changed) {
    try {
      writeFileSync(path.join(root, CACHE_FILE), JSON.stringify({ version: CACHE_VERSION, entries: Object.fromEntries(cache) }));
    } catch {
      /* read-only history: keep the in-memory cache */
    }
  }
  parsed.sort((a, b) => a.run.at - b.run.at);
  const runs = parsed.map((entry) => entry.run);
  const tests = parsed.flatMap((entry, index) =>
    entry.tests.map((t) => [index, t.at, t.caseId, t.gameId, t.packageId, t.feature, t.status, t.durationMs, t.category, t.message]),
  );
  return { generatedAt: Date.now(), runs, tests };
}

/** Concurrent callers share one build. */
export async function loadAnalytics(historyRoot) {
  if (!existsSync(historyRoot)) return { generatedAt: Date.now(), runs: [], tests: [] };
  pending ??= build(historyRoot).finally(() => {
    pending = undefined;
  });
  return pending;
}
