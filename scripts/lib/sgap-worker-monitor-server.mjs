/**
 * Live HTTP status board for parallel Playwright workers.
 *
 * Workers POST events; the dedicated Chrome overlay and in-page HUDs GET /api/status.
 */
import http from 'node:http';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HTML_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), 'sgap-worker-monitor.html');
const READER_HTML_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), 'sgap-backend-reader.html');
const OBSERVE_HTML_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), 'sgap-monitor-worker.html');
/** Shared control panel design system, served at /ui.css and /ui.js by every SGAP page server. */
export const UI_ASSETS = {
  '/ui.css': { file: path.join(path.dirname(fileURLToPath(import.meta.url)), 'sgap-ui.css'), type: 'text/css; charset=utf-8' },
  '/ui.js': { file: path.join(path.dirname(fileURLToPath(import.meta.url)), 'sgap-ui.js'), type: 'text/javascript; charset=utf-8' },
};
const OBSERVE_KEEP_SESSIONS = 80;
const OBSERVE_MAX_PER_SESSION = 25_000;
const READER_ROOT = path.join(process.cwd(), 'test-results', 'tmp', 'backend-reader');
const DEFAULT_KEEP = 50;

function emptyLane(lane) {
  return {
    id: Number(lane.id),
    category: lane.category ?? '',
    categories: Array.isArray(lane.categories) ? lane.categories.join(' ') : (lane.categories ?? ''),
    playerId: lane.playerId ?? '',
    gameId: lane.gameId ?? '',
    gameName: lane.gameName ?? '',
    packageId: lane.packageId ?? '',
    project: lane.project ?? `w${lane.id}-${lane.category ?? ''}`,
    status: 'waiting',
    tests: [],
    current: null,
    passed: 0,
    failed: 0,
    timedOut: 0,
    skipped: 0,
    running: 0,
    queued: 0,
    total: 0,
  };
}

function recount(lane) {
  const counts = { passed: 0, failed: 0, timedOut: 0, skipped: 0, running: 0, queued: 0 };
  for (const test of lane.tests) {
    const status = test.status ?? 'queued';
    if (status === 'passed') counts.passed += 1;
    else if (status === 'failed' || status === 'interrupted') counts.failed += 1;
    else if (status === 'timedOut') counts.timedOut += 1;
    else if (status === 'skipped') counts.skipped += 1;
    else if (status === 'running') counts.running += 1;
    else counts.queued += 1;
  }
  Object.assign(lane, counts);
  lane.total = lane.tests.length;
  lane.current = lane.tests.find((test) => test.status === 'running') ?? null;
  if (lane.running > 0) {
    lane.status = 'running';
  } else if (lane.total > 0 && lane.queued === 0) {
    lane.status = 'done';
  } else if (lane.total > 0) {
    lane.status = 'waiting';
  }
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve(raw.length === 0 ? {} : JSON.parse(raw));
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

function slugLabel(label) {
  const slug = String(label ?? 'sequence')
    .trim()
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return slug.length > 0 ? slug : 'sequence';
}

function ensureReaderRoot() {
  mkdirSync(READER_ROOT, { recursive: true });
}

function resetReaderRoot() {
  rmSync(READER_ROOT, { recursive: true, force: true });
  mkdirSync(READER_ROOT, { recursive: true });
}

function safeReaderFile(rel) {
  const resolved = path.resolve(READER_ROOT, rel);
  const root = path.resolve(READER_ROOT);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    return undefined;
  }
  return resolved;
}

function send(res, status, body, contentType = 'application/json; charset=utf-8') {
  const payload = typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': contentType,
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(payload);
}

export function createWorkerMonitorServer(options = {}) {
  const startedAt = Date.now();
  const onStop = typeof options.onStop === 'function' ? options.onStop : undefined;
  const workers = new Map();
  for (const lane of options.lanes ?? []) {
    workers.set(Number(lane.id), emptyLane(lane));
  }
  const expectedWorkers = options.lanes?.length ?? 0;
  const html = existsSync(HTML_PATH)
    ? readFileSync(HTML_PATH, 'utf8')
    : '<!doctype html><title>SGAP Worker Monitor</title><p>Dashboard HTML missing.</p>';

  function loadReaderHtml() {
    return existsSync(READER_HTML_PATH)
      ? readFileSync(READER_HTML_PATH, 'utf8')
      : '<!doctype html><title>SGAP Backend Reader</title><p>Reader HTML missing.</p>';
  }

  let readerSeq = 0;
  const readerSequences = [];
  const readerKeep = Math.max(1, Number(process.env.SGAP_READER_KEEP ?? DEFAULT_KEEP) || DEFAULT_KEEP);
  resetReaderRoot();

  function pruneReader() {
    while (readerSequences.length > readerKeep) {
      const oldest = readerSequences.shift();
      if (oldest?.dir) {
        rmSync(path.join(READER_ROOT, oldest.dir), { recursive: true, force: true });
      }
    }
  }

  function readerSnapshot() {
    const statusCounts = { passed: 0, failed: 0, timedOut: 0, skipped: 0, running: 0, unknown: 0 };
    for (const entry of readerSequences) {
      const status = entry.testStatus;
      if (status === 'passed') statusCounts.passed += 1;
      else if (status === 'failed' || status === 'interrupted') statusCounts.failed += 1;
      else if (status === 'timedOut') statusCounts.timedOut += 1;
      else if (status === 'skipped') statusCounts.skipped += 1;
      else if (status === 'running') statusCounts.running += 1;
      else statusCounts.unknown += 1;
    }
    return {
      updatedAt: Date.now(),
      keep: readerKeep,
      statusCounts,
      sequences: readerSequences.map((entry) => ({
        seq: entry.seq,
        eventId: entry.eventId,
        open: Boolean(entry.open),
        workerId: entry.workerId,
        testId: entry.testId,
        testTitle: entry.testTitle,
        testStatus: entry.testStatus,
        testError: entry.testError,
        testDurationMs: entry.testDurationMs,
        testRetry: entry.testRetry,
        label: entry.label,
        columns: entry.columns,
        rows: entry.rows,
        catalogId: entry.catalogId,
        totalWin: entry.totalWin,
        sourcePath: entry.sourcePath,
        featureSpinsTarget: entry.featureSpinsTarget,
        featureSpinsSeen: entry.featureSpinsSeen,
        requestUrl: entry.requestUrl,
        payloadUrl: entry.payloadFile ? `/reader/files/${entry.dir}/${entry.payloadFile}` : undefined,
        hasPayload: Boolean(entry.payloadFile),
        at: entry.at,
        boards: entry.boards,
        steps: (entry.steps ?? []).map((step) => ({
          key: step.key,
          title: step.title,
          spinIndex: step.spinIndex,
          kind: step.kind,
          boardKind: step.boardKind,
          columns: step.columns,
          rows: step.rows,
          ids: step.ids,
          names: step.names,
          shotQuality: step.shotQuality,
          sourcePath: step.sourcePath,
          payloadSnippet: step.payloadSnippet,
          shotUrl: step.file ? `/reader/files/${entry.dir}/${step.file}` : undefined,
        })),
        shots: (entry.shots ?? []).map((shot) => ({
          name: shot.name,
          title: shot.title,
          url: `/reader/files/${entry.dir}/${shot.file}`,
        })),
      })),
    };
  }

  function writePayloadFile(abs, record, payload) {
    if (payload === undefined || payload === null) {
      return undefined;
    }
    const file = 'payload.json';
    writeFileSync(path.join(abs, file), JSON.stringify(payload, null, 2));
    record.payloadFile = file;
    return file;
  }

  function writeShotFile(abs, record, shot) {
    const raw = typeof shot?.pngBase64 === 'string' ? shot.pngBase64 : '';
    if (!raw) {
      return undefined;
    }
    const index = record.shots.length;
    const name = slugLabel(shot.name ?? shot.key ?? shot.title ?? `frame-${index + 1}`).toLowerCase();
    const file = `${String(index).padStart(3, '0')}-${name}.png`;
    writeFileSync(path.join(abs, file), Buffer.from(raw, 'base64'));
    const saved = {
      name: shot.name ?? shot.key ?? name,
      title: shot.title ?? shot.name ?? `Shot ${index + 1}`,
      file,
    };
    record.shots.push(saved);
    return saved;
  }

  function appendSteps(record, body) {
    const abs = path.join(READER_ROOT, record.dir);
    const incomingSteps = Array.isArray(body.steps) ? body.steps : [];
    if (incomingSteps.length > 0) {
      for (const step of incomingSteps) {
        const key = typeof step.key === 'string' ? step.key : undefined;
        const existing = key
          ? record.steps.find((entry) => entry.key === key)
          : undefined;

        const saved = writeShotFile(abs, record, {
          pngBase64: step.pngBase64,
          name: step.key,
          key: step.key,
          title: step.title,
        });

        if (existing) {
          if (step.title) existing.title = step.title;
          if (step.kind) existing.kind = step.kind;
          if (step.boardKind) existing.boardKind = step.boardKind;
          if (step.ids) existing.ids = step.ids;
          if (step.names) existing.names = step.names;
          if (Number(step.columns) > 0) existing.columns = Number(step.columns);
          if (Number(step.rows) > 0) existing.rows = Number(step.rows);
          if (step.shotQuality) existing.shotQuality = step.shotQuality;
          if (step.sourcePath) existing.sourcePath = step.sourcePath;
          if (step.payloadSnippet !== undefined) existing.payloadSnippet = step.payloadSnippet;
          if (saved?.file) existing.file = saved.file;
          const board = record.boards.find((entry) => entry.key === key);
          if (board) {
            board.title = existing.title;
            board.ids = existing.ids;
            board.names = existing.names;
            board.columns = existing.columns;
            board.rows = existing.rows;
          }
          continue;
        }

        const board = {
          key: step.key,
          title: step.title,
          columns: Number(step.columns) || record.columns,
          rows: Number(step.rows) || record.rows,
          ids: step.ids,
          names: step.names,
        };
        record.boards.push(board);
        record.steps.push({
          key: step.key,
          title: step.title,
          spinIndex: Number(step.spinIndex) || record.steps.length + 1,
          kind: step.kind === 'spin' ? 'spin' : step.kind === 'idle' ? 'idle' : step.kind === 'tumble' ? 'tumble' : 'stop',
          boardKind: step.boardKind === 'tumble' ? 'tumble' : step.boardKind === 'stop' ? 'stop' : undefined,
          columns: board.columns,
          rows: board.rows,
          ids: Array.isArray(step.ids) ? step.ids : [],
          names: Array.isArray(step.names) ? step.names : [],
          shotQuality: step.shotQuality ?? (saved ? 'idle' : 'pending'),
          sourcePath: step.sourcePath,
          payloadSnippet: step.payloadSnippet,
          file: saved?.file,
        });
      }
      return;
    }

    const incomingShots = Array.isArray(body.shots) ? body.shots : [];
    incomingShots.forEach((shot) => {
      writeShotFile(abs, record, shot);
    });
    if (Array.isArray(body.boards) && body.boards.length > 0) {
      record.boards.push(...body.boards);
    }
  }

  async function storeReaderSequence(body) {
    ensureReaderRoot();
    const eventId = typeof body.eventId === 'string' && body.eventId.length > 0 ? body.eventId : undefined;
    const existing = eventId ? readerSequences.find((entry) => entry.eventId === eventId) : undefined;
    if (existing) {
      if (Number(body.columns) > 0) existing.columns = Number(body.columns);
      if (Number(body.rows) > 0) existing.rows = Number(body.rows);
      if (body.catalogId) existing.catalogId = body.catalogId;
      if (body.totalWin !== undefined) existing.totalWin = body.totalWin;
      if (body.sourcePath) existing.sourcePath = body.sourcePath;
      if (Number(body.featureSpinsTarget) > 0) {
        existing.featureSpinsTarget = Number(body.featureSpinsTarget);
      }
      if (Number(body.featureSpinsSeen) > 0) {
        existing.featureSpinsSeen = Number(body.featureSpinsSeen);
      }
      if (body.requestUrl) existing.requestUrl = body.requestUrl;
      if (body.payload !== undefined) {
        writePayloadFile(path.join(READER_ROOT, existing.dir), existing, body.payload);
      }
      existing.at = Date.now();
      // Do not reopen a sequence after the owning test already finished.
      if (isTerminalTestStatus(existing.testStatus)) {
        existing.open = false;
      } else {
        existing.open = body.done === false;
      }
      appendSteps(existing, body);
      writeFileSync(path.join(READER_ROOT, existing.dir, 'meta.json'), JSON.stringify({
        ...existing,
        shots: existing.shots,
        steps: existing.steps.map((step) => ({ ...step, pngBase64: undefined })),
      }, null, 2));
      return existing;
    }

    readerSeq += 1;
    const seq = readerSeq;
    const label = typeof body.label === 'string' && body.label.length > 0 ? body.label : 'Normal Spin';
    const dir = `seq-${String(seq).padStart(5, '0')}-${slugLabel(label)}`;
    const abs = path.join(READER_ROOT, dir);
    mkdirSync(abs, { recursive: true });

    const record = {
      seq,
      dir,
      eventId,
      open: body.done === false,
      workerId: Number(body.workerId) || undefined,
      testId: body.testId,
      testTitle: body.testTitle,
      testStatus: undefined,
      testError: undefined,
      testDurationMs: undefined,
      testRetry: undefined,
      label,
      columns: Number(body.columns) || 0,
      rows: Number(body.rows) || 0,
      catalogId: body.catalogId,
      totalWin: body.totalWin,
      sourcePath: body.sourcePath,
      featureSpinsTarget: Number(body.featureSpinsTarget) || undefined,
      featureSpinsSeen: Number(body.featureSpinsSeen) || undefined,
      requestUrl: body.requestUrl,
      payloadFile: undefined,
      at: Date.now(),
      boards: [],
      shots: [],
      steps: [],
    };
    // Inherit pass/fail/running from the monitor lane so mid-test sequences are tagged.
    const wid = Number(body.workerId);
    const lane = Number.isFinite(wid) && wid > 0 ? workers.get(wid) : undefined;
    const match = lane?.tests?.find((test) => test.id === body.testId);
    if (match?.status) {
      record.testStatus = match.status;
      record.testError = typeof match.error === 'string' ? match.error : undefined;
      record.testDurationMs = Number.isFinite(Number(match.durationMs))
        ? Number(match.durationMs)
        : undefined;
      record.testRetry = Number.isFinite(Number(match.retry)) ? Number(match.retry) : undefined;
    } else if (body.testId) {
      record.testStatus = 'running';
    }
    if (body.payload !== undefined) {
      writePayloadFile(abs, record, body.payload);
    }
    appendSteps(record, body);
    writeFileSync(path.join(abs, 'meta.json'), JSON.stringify({
      ...record,
      steps: record.steps.map((step) => ({ ...step, pngBase64: undefined })),
    }, null, 2));
    readerSequences.push(record);
    pruneReader();
    return record;
  }

  function ensureLane(partial) {
    const id = Number(partial.id ?? partial.workerId);
    if (!Number.isFinite(id) || id <= 0) {
      return undefined;
    }
    if (!workers.has(id)) {
      workers.set(id, emptyLane({ ...partial, id }));
    }
    const lane = workers.get(id);
    if (partial.category) lane.category = partial.category;
    if (partial.categories) {
      lane.categories = Array.isArray(partial.categories)
        ? partial.categories.join(' ')
        : partial.categories;
    }
    if (partial.playerId) lane.playerId = partial.playerId;
    if (partial.project) lane.project = partial.project;
    return lane;
  }

  function isTerminalTestStatus(status) {
    return (
      status === 'passed' ||
      status === 'failed' ||
      status === 'timedOut' ||
      status === 'skipped' ||
      status === 'interrupted'
    );
  }

  function stampSequencesForTest(test, workerId) {
    if (test === undefined || test === null) {
      return;
    }
    const testId = typeof test.id === 'string' ? test.id : undefined;
    if (testId === undefined || testId.length === 0) {
      return;
    }
    const status = typeof test.status === 'string' ? test.status : undefined;
    if (status === undefined) {
      return;
    }
    const wid = Number(workerId);
    for (const entry of readerSequences) {
      if (entry.testId !== testId) {
        continue;
      }
      if (Number.isFinite(wid) && wid > 0 && entry.workerId !== undefined && entry.workerId !== wid) {
        continue;
      }
      // Keep finished history stable — retries create new sequences.
      if (status === 'running' && isTerminalTestStatus(entry.testStatus)) {
        continue;
      }
      entry.testStatus = status;
      entry.testError = typeof test.error === 'string' ? test.error : undefined;
      entry.testDurationMs = Number.isFinite(Number(test.durationMs))
        ? Number(test.durationMs)
        : entry.testDurationMs;
      entry.testRetry = Number.isFinite(Number(test.retry)) ? Number(test.retry) : entry.testRetry;
      // Terminal outcomes close the sequence so the UI stops looking "ongoing".
      if (isTerminalTestStatus(status)) {
        entry.open = false;
      }
      try {
        writeFileSync(
          path.join(READER_ROOT, entry.dir, 'meta.json'),
          JSON.stringify(
            {
              ...entry,
              shots: entry.shots,
              steps: entry.steps.map((step) => ({ ...step, pngBase64: undefined })),
            },
            null,
            2,
          ),
        );
      } catch {
        // Disk write is best-effort — the in-memory stamp still serves the UI.
      }
    }
  }

  function applyEvent(event) {
    const lane = ensureLane(event);
    if (lane === undefined) {
      return;
    }
    if (event.type === 'roster' && Array.isArray(event.tests)) {
      const previous = new Map(lane.tests.map((test) => [test.key, test]));
      lane.tests = event.tests.map((test) => previous.get(test.key) ?? { ...test, status: test.status ?? 'queued' });
      recount(lane);
      return;
    }
    if (event.type === 'start' && event.test) {
      const existing = lane.tests.find((test) => test.key === event.test.key);
      if (existing) {
        existing.status = 'running';
        existing.startedAt = event.test.startedAt ?? Date.now();
        existing.retry = event.test.retry ?? existing.retry ?? 0;
        existing.error = undefined;
        existing.durationMs = undefined;
      } else {
        lane.tests.push({ ...event.test, status: 'running' });
      }
      stampSequencesForTest({ ...event.test, status: 'running' }, lane.id);
      recount(lane);
      return;
    }
    if (event.type === 'end' && event.test) {
      const existing = lane.tests.find((test) => test.key === event.test.key);
      const next = {
        ...event.test,
        status: event.test.status ?? existing?.status ?? 'passed',
      };
      if (existing) {
        Object.assign(existing, next);
      } else {
        lane.tests.push(next);
      }
      stampSequencesForTest(next, lane.id);
      recount(lane);
      return;
    }
    if (event.type === 'lane-end') {
      lane.status = event.reason === 'stopped' ? 'stopped' : 'done';
      for (const test of lane.tests) {
        if (test.status === 'running' || test.status === 'queued') {
          test.status = 'skipped';
          stampSequencesForTest(test, lane.id);
        }
      }
      // Close any leftover open sequences on this worker.
      for (const entry of readerSequences) {
        if (entry.workerId === lane.id && entry.open) {
          entry.open = false;
          if (!isTerminalTestStatus(entry.testStatus)) {
            entry.testStatus = entry.testStatus === 'running' ? 'skipped' : (entry.testStatus || 'unknown');
          }
        }
      }
      recount(lane);
    }
  }

  // Monitor Worker: per-test observation streams (network / console / ws / events / balance).
  const observeSessions = new Map();

  function storeObservations(body) {
    const meta = body.session ?? {};
    const id = typeof meta.sessionId === 'string' && meta.sessionId.length > 0 ? meta.sessionId : undefined;
    if (id === undefined) {
      throw new Error('session.sessionId required');
    }
    let session = observeSessions.get(id);
    if (session === undefined) {
      session = {
        meta,
        status: 'running',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        observations: [],
        counts: { network: 0, console: 0, websocket: 0, event: 0, balance: 0, errors: 0, warnings: 0 },
        lastBalance: undefined,
      };
      observeSessions.set(id, session);
      while (observeSessions.size > OBSERVE_KEEP_SESSIONS) {
        const oldest = observeSessions.keys().next().value;
        observeSessions.delete(oldest);
      }
    }
    if (typeof body.status === 'string') {
      session.status = body.status;
    }
    for (const entry of Array.isArray(body.observations) ? body.observations : []) {
      if (session.observations.length >= OBSERVE_MAX_PER_SESSION) {
        break;
      }
      session.observations.push(entry);
      if (session.counts[entry.kind] !== undefined) session.counts[entry.kind] += 1;
      if (entry.severity === 'error') session.counts.errors += 1;
      else if (entry.severity === 'warn') session.counts.warnings += 1;
      if (entry.kind === 'balance') session.lastBalance = entry;
    }
    session.updatedAt = Date.now();
    return session;
  }

  function observeIndex() {
    return {
      updatedAt: Date.now(),
      sessions: [...observeSessions.entries()]
        .map(([id, session]) => ({
          id,
          ...session.meta,
          status: session.status,
          createdAt: session.createdAt,
          updatedAt: session.updatedAt,
          counts: session.counts,
          size: session.observations.length,
          lastBalance: session.lastBalance,
        }))
        .reverse(),
    };
  }

  function observeSession(id, since) {
    const session = observeSessions.get(id);
    if (session === undefined) {
      return undefined;
    }
    const after = Number.isFinite(since) ? since : 0;
    return {
      id,
      ...session.meta,
      status: session.status,
      counts: session.counts,
      updatedAt: session.updatedAt,
      observations: session.observations.filter((entry) => Number(entry.seq) > after),
    };
  }

  function snapshot() {
    const lanes = [...workers.values()].sort((a, b) => a.id - b.id);
    const totals = {
      passed: 0,
      failed: 0,
      timedOut: 0,
      skipped: 0,
      running: 0,
      queued: 0,
      total: 0,
      done: 0,
    };
    for (const lane of lanes) {
      totals.passed += lane.passed;
      totals.failed += lane.failed;
      totals.timedOut += lane.timedOut;
      totals.skipped += lane.skipped;
      totals.running += lane.running;
      totals.queued += lane.queued;
      totals.total += lane.total;
    }
    totals.done = totals.passed + totals.failed + totals.timedOut + totals.skipped;
    return {
      startedAt,
      updatedAt: Date.now(),
      expectedWorkers: Math.max(expectedWorkers, lanes.length),
      workerCount: lanes.length,
      totals,
      workers: lanes,
    };
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (req.method === 'OPTIONS') {
      send(res, 204, '');
      return;
    }
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      send(res, 200, html, 'text/html; charset=utf-8');
      return;
    }
    if (req.method === 'GET' && UI_ASSETS[url.pathname] !== undefined) {
      const asset = UI_ASSETS[url.pathname];
      send(res, 200, readFileSync(asset.file, 'utf8'), asset.type);
      return;
    }
    if (req.method === 'GET' && (url.pathname === '/reader' || url.pathname === '/reader.html')) {
      send(res, 200, loadReaderHtml(), 'text/html; charset=utf-8');
      return;
    }
    if (req.method === 'GET' && (url.pathname === '/observe' || url.pathname === '/observe.html')) {
      const page = existsSync(OBSERVE_HTML_PATH)
        ? readFileSync(OBSERVE_HTML_PATH, 'utf8')
        : '<!doctype html><title>SGAP Monitor Worker</title><p>Monitor Worker HTML missing.</p>';
      send(res, 200, page, 'text/html; charset=utf-8');
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/observe') {
      send(res, 200, observeIndex());
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/observe/session') {
      const found = observeSession(url.searchParams.get('id') ?? '', Number(url.searchParams.get('since') ?? '0'));
      send(res, found === undefined ? 404 : 200, found ?? { error: 'not found' });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/observe') {
      try {
        const session = storeObservations(await readJson(req));
        send(res, 200, { ok: true, size: session.observations.length });
      } catch (error) {
        send(res, 400, { ok: false, error: String(error?.message ?? error) });
      }
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/status') {
      send(res, 200, snapshot());
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/reader') {
      send(res, 200, readerSnapshot());
      return;
    }
    if (req.method === 'GET' && url.pathname.startsWith('/reader/files/')) {
      const rel = decodeURIComponent(url.pathname.slice('/reader/files/'.length));
      const filePath = safeReaderFile(rel);
      if (filePath === undefined || !existsSync(filePath)) {
        send(res, 404, { error: 'not found' });
        return;
      }
      const lower = filePath.toLowerCase();
      let type = 'application/octet-stream';
      if (lower.endsWith('.png')) type = 'image/png';
      else if (lower.endsWith('.json')) type = 'application/json; charset=utf-8';
      else {
        send(res, 404, { error: 'not found' });
        return;
      }
      res.writeHead(200, {
        'Content-Type': type,
        'Cache-Control': 'no-store',
        'Access-Control-Allow-Origin': '*',
      });
      res.end(readFileSync(filePath));
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/reader/sequence') {
      try {
        const body = await readJson(req);
        const record = await storeReaderSequence(body);
        send(res, 200, { ok: true, seq: record.seq, keep: readerKeep });
      } catch (error) {
        send(res, 400, { ok: false, error: String(error?.message ?? error) });
      }
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/stop') {
      if (onStop === undefined) {
        send(res, 503, { ok: false, error: 'stop handler not configured' });
        return;
      }
      try {
        const body = await readJson(req);
        const result = await onStop(body);
        send(res, 200, result ?? { ok: false, error: 'empty stop result' });
      } catch (error) {
        send(res, 500, { ok: false, error: String(error?.message ?? error) });
      }
      return;
    }
    if (req.method === 'POST' && (url.pathname === '/api/event' || url.pathname === '/api/bootstrap')) {
      try {
        const body = await readJson(req);
        if (Array.isArray(body.workers)) {
          for (const lane of body.workers) {
            ensureLane(lane);
          }
        } else {
          applyEvent(body);
        }
        send(res, 200, { ok: true, workerCount: workers.size });
      } catch (error) {
        send(res, 400, { ok: false, error: String(error?.message ?? error) });
      }
      return;
    }
    send(res, 404, { error: 'not found' });
  });

  return {
    server,
    snapshot,
    applyEvent,
    listen(port = 3847) {
      return new Promise((resolve, reject) => {
        const tryPort = (candidate) => {
          const onError = (error) => {
            server.off('error', onError);
            if (error.code === 'EADDRINUSE' && candidate < port + 20) {
              tryPort(candidate + 1);
              return;
            }
            reject(error);
          };
          server.once('error', onError);
          server.listen(candidate, '127.0.0.1', () => {
            server.off('error', onError);
            const address = server.address();
            const bound = typeof address === 'object' && address ? address.port : candidate;
            resolve({
              port: bound,
              url: `http://127.0.0.1:${bound}`,
              close: () =>
                new Promise((done) => {
                  server.close(() => done());
                  // A monitor tab polling every second keeps its keep-alive socket busy, so
                  // close() alone can wait forever after the run has finished.
                  setTimeout(() => server.closeAllConnections(), 2_000).unref();
                }),
            });
          });
        };
        tryPort(port);
      });
    },
  };
}

export function findChromiumExe(root) {
  if (!root || !existsSync(root)) {
    return undefined;
  }
  try {
    for (const name of readdirSync(root)) {
      if (!name.startsWith('chromium-')) {
        continue;
      }
      const exe = path.join(root, name, 'chrome-win64', 'chrome.exe');
      if (existsSync(exe)) {
        return exe;
      }
    }
  } catch {
    return undefined;
  }
  return undefined;
}

export function launchMonitorChrome(options) {
  const { url, chromeExe, screens = [], offset = 0 } = options;
  if (!chromeExe || !existsSync(chromeExe) || !url) {
    return undefined;
  }
  const screen = screens[0] ?? { left: 40, top: 40, width: 1920, height: 1080 };
  const width = Math.min(1180, Math.max(720, screen.width - 80));
  const height = Math.min(820, Math.max(480, Math.floor(screen.height * 0.72)));
  const left = screen.left + Math.max(20, Math.floor((screen.width - width) / 2)) + offset;
  const top = screen.top + 28 + offset;
  const profile = path.join(process.cwd(), 'test-results', 'sgap-monitor-profile');
  const child = spawn(
    chromeExe,
    [
      `--user-data-dir=${profile}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-sync',
      `--window-position=${left},${top}`,
      `--window-size=${width},${height}`,
      `--app=${url}`,
    ],
    {
      detached: true,
      stdio: 'ignore',
      windowsHide: false,
    },
  );
  child.unref();
  return child;
}

export async function postMonitorEvent(url, payload) {
  if (!url) {
    return;
  }
  try {
    await fetch(`${url.replace(/\/$/, '')}/api/event`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch {
    // Monitor is optional; never fail the suite.
  }
}
