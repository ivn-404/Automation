/**
 * Host-page HUD overlay for the parallel worker monitor.
 *
 * Staging launcher is HTTPS, so the page cannot fetch http://127.0.0.1.
 * Node pulls /api/status and pushes a snapshot into the overlay.
 */

import type { Page } from 'playwright';

const overlays = new WeakMap<Page, ReturnType<typeof setInterval>>();

export function isWorkerMonitorEnabled(): boolean {
  const value = process.env.SGAP_WORKER_MONITOR?.trim().toLowerCase();
  if (value === '0' || value === 'false' || value === 'no') {
    return false;
  }
  return typeof process.env.SGAP_MONITOR_URL === 'string' && process.env.SGAP_MONITOR_URL.length > 0;
}

const RENDER_BODY = `
  const data = payload.data;
  const workerId = payload.workerId;
  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, function (ch) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch];
    });
  }
  function bad(x) { return (x.failed || 0) + (x.timedOut || 0); }
  function doneOf(x) { return (x.passed || 0) + bad(x) + (x.skipped || 0); }
  if (!document.getElementById('sgap-worker-monitor-style')) {
    const style = document.createElement('style');
    style.id = 'sgap-worker-monitor-style';
    style.textContent = \`
      #sgap-worker-monitor {
        position: fixed !important;
        top: 10px; left: 10px;
        width: min(300px, 34vw);
        max-height: 70vh;
        z-index: 2147483646 !important;
        background: rgba(12, 13, 18, 0.92);
        color: #e8e9ee;
        font: 11px/1.4 "Segoe UI", system-ui, sans-serif;
        border: 1px solid rgba(255,255,255,0.08);
        border-radius: 8px;
        overflow: hidden;
        /* Let host chrome (Balance / Bet limit) receive clicks underneath. */
        pointer-events: none !important;
        display: flex; flex-direction: column;
      }
      #sgap-worker-monitor.collapsed { width: auto; max-width: min(340px, 40vw); }
      #sgap-worker-monitor header {
        display: flex; align-items: center; gap: 8px;
        padding: 6px 10px; cursor: pointer; user-select: none;
        pointer-events: auto; white-space: nowrap;
      }
      #sgap-worker-monitor .me { color: #7aa2ff; font-weight: 600; }
      #sgap-worker-monitor .count { color: #8a8f9c; font-variant-numeric: tabular-nums; }
      #sgap-worker-monitor .ok { color: #34c77b; }
      #sgap-worker-monitor .no { color: #f0506e; }
      #sgap-worker-monitor .now { color: #8a8f9c; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
      #sgap-worker-monitor .reader {
        margin-left: auto; pointer-events: auto; cursor: pointer;
        background: none; border: 0; padding: 0; color: #8a8f9c; font: inherit;
      }
      #sgap-worker-monitor .reader:hover { color: #e8e9ee; }
      #sgap-worker-monitor .bar { height: 2px; background: rgba(255,255,255,0.08); display: flex; }
      #sgap-worker-monitor .bar i { display: block; height: 100%; }
      #sgap-worker-monitor .body {
        overflow: auto; padding: 4px 6px 6px; pointer-events: auto;
        border-top: 1px solid rgba(255,255,255,0.06);
      }
      #sgap-worker-monitor.collapsed .body { display: none; }
      #sgap-worker-monitor ul { list-style: none; margin: 0; padding: 0; }
      #sgap-worker-monitor li {
        display: grid; grid-template-columns: 8px 56px 1fr auto;
        gap: 6px; padding: 3px 4px; align-items: baseline;
      }
      #sgap-worker-monitor .dot { width: 6px; height: 6px; border-radius: 50%; background: #5d6270; align-self: center; }
      #sgap-worker-monitor .passed .dot { background: #34c77b; }
      #sgap-worker-monitor .failed .dot, #sgap-worker-monitor .timedOut .dot { background: #f0506e; }
      #sgap-worker-monitor .running .dot { background: #f5b942; }
      #sgap-worker-monitor .queued .dot { background: transparent; box-shadow: inset 0 0 0 1px #5d6270; }
      #sgap-worker-monitor .code { color: #8a8f9c; font-variant-numeric: tabular-nums; }
      #sgap-worker-monitor .t { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      #sgap-worker-monitor .failed .t, #sgap-worker-monitor .timedOut .t { color: #f0506e; }
      #sgap-worker-monitor .queued .t { color: #8a8f9c; }
      #sgap-worker-monitor .d { color: #5d6270; font-variant-numeric: tabular-nums; }
      #sgap-worker-monitor .err { grid-column: 2 / -1; color: #f0506e; font-size: 10px; white-space: normal; }
      #sgap-worker-monitor .others {
        margin-top: 6px; padding-top: 6px; border-top: 1px solid rgba(255,255,255,0.06);
        color: #8a8f9c; display: flex; flex-direction: column; gap: 2px;
      }
    \`;
    (document.head || document.documentElement).appendChild(style);
  }
  let root = document.getElementById('sgap-worker-monitor');
  if (!root) {
    root = document.createElement('div');
    root.id = 'sgap-worker-monitor';
    root.className = 'collapsed';
    root.innerHTML = '<header></header><div class="bar"></div><div class="body"></div>';
    (document.documentElement || document.body).appendChild(root);
    root.querySelector('header').addEventListener('click', function (ev) {
      if (ev.target && ev.target.closest && ev.target.closest('.reader')) {
        ev.preventDefault();
        ev.stopPropagation();
        if (root.dataset.readerUrl) {
          window.open(root.dataset.readerUrl, 'sgap-backend-reader');
        }
        return;
      }
      root.classList.toggle('collapsed');
    });
  }
  root.dataset.readerUrl = payload.readerUrl || '';
  const workers = (data.workers || []).slice().sort(function (a, b) { return a.id - b.id; });
  const mine = workers.find(function (lane) { return lane.id === workerId; });
  const scope = mine || data.totals || {};
  const total = mine ? (mine.total || 0) : ((data.totals || {}).total || 0);
  const now = mine && mine.current ? mine.current.id : (mine ? (mine.status === 'done' ? 'done' : 'idle') : '');
  root.querySelector('header').innerHTML =
    '<span class="me">' + (mine ? 'W' + mine.id : 'SGAP') + '</span>' +
    '<span class="count">' + doneOf(scope) + '/' + total + '</span>' +
    '<span class="ok">✓' + (scope.passed || 0) + '</span>' +
    (bad(scope) > 0 ? '<span class="no">✕' + bad(scope) + '</span>' : '') +
    (now ? '<span class="now">' + esc(now) + '</span>' : '') +
    '<button type="button" class="reader" title="Open the backend reader">Reader</button>';
  const pct = function (n) { return total ? (100 * n / total) : 0; };
  root.querySelector('.bar').innerHTML =
    '<i style="width:' + pct(scope.passed || 0) + '%;background:#34c77b"></i>' +
    '<i style="width:' + pct(bad(scope)) + '%;background:#f0506e"></i>' +
    '<i style="width:' + pct(scope.running || 0) + '%;background:#f5b942"></i>';
  const lanes = mine ? [mine] : workers;
  const list = lanes.map(function (lane) {
    return (lane.tests || []).map(function (test) {
      const status = test.status || 'queued';
      const dur = test.durationMs ? Math.round(test.durationMs / 1000) + 's' : '';
      return '<li class="' + esc(status) + '">' +
        '<span class="dot"></span>' +
        '<span class="code">' + esc(test.id) + '</span>' +
        '<span class="t">' + esc(test.title) + '</span>' +
        '<span class="d">' + esc(dur) + '</span>' +
        (test.error && status !== 'passed' ? '<div class="err">' + esc(test.error) + '</div>' : '') +
        '</li>';
    }).join('');
  }).join('');
  const others = mine
    ? workers.filter(function (lane) { return lane.id !== mine.id; }).map(function (lane) {
        return '<span>W' + lane.id + ' · ' + esc(lane.gameName || lane.gameId || lane.category || '') + ' · ' +
          doneOf(lane) + '/' + (lane.total || 0) + (bad(lane) > 0 ? ' · <span class="no">✕' + bad(lane) + '</span>' : '') + '</span>';
      }).join('')
    : '';
  root.querySelector('.body').innerHTML =
    '<ul>' + (list || '<li><span></span><span></span><span class="t">Waiting for tests…</span></li>') + '</ul>' +
    (others ? '<div class="others">' + others + '</div>' : '');
`;

export async function installWorkerMonitorOverlay(
  page: Page,
  options?: { readonly workerId?: number },
): Promise<void> {
  if (!isWorkerMonitorEnabled()) {
    return;
  }
  const previous = overlays.get(page);
  if (previous !== undefined) {
    clearInterval(previous);
  }

  const tick = async (): Promise<void> => {
    if (page.isClosed()) {
      const timer = overlays.get(page);
      if (timer !== undefined) {
        clearInterval(timer);
      }
      return;
    }
    const base = process.env.SGAP_MONITOR_URL;
    if (base === undefined || base.length === 0) {
      return;
    }
    try {
      const response = await fetch(`${base.replace(/\/$/, '')}/api/status`);
      const data = (await response.json()) as unknown;
      await page
        .evaluate(
          ({ body, payload }) => {
            // eslint-disable-next-line no-new-func
            new Function('payload', body)(payload);
          },
          {
            body: RENDER_BODY,
            payload: {
              data,
              workerId: options?.workerId,
              readerUrl: `${base.replace(/\/$/, '')}/reader`,
            },
          },
        )
        .catch(() => undefined);
    } catch {
      // Monitor is optional.
    }
  };

  await tick();
  const timer = setInterval(() => {
    void tick();
  }, 1000);
  overlays.set(page, timer);
  page.once('close', () => {
    clearInterval(timer);
    overlays.delete(page);
  });
}

export async function refreshWorkerMonitorOverlay(
  page: Page,
  options?: { readonly workerId?: number },
): Promise<void> {
  if (!isWorkerMonitorEnabled() || page.isClosed()) {
    return;
  }
  if (!overlays.has(page)) {
    await installWorkerMonitorOverlay(page, options);
  }
}
