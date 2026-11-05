/*
 * SGAP control panel shared UI helpers (served at /ui.js next to /ui.css).
 * window.SGAP: icon(name), confirm(options), toast(options), access (after mountChrome).
 * Pure presentation: no automation logic lives here.
 */
(function () {
  const ICONS = {
    logo: '<path d="M12 2 3 7v10l9 5 9-5V7z"/><path d="m3 7 9 5 9-5M12 12v10"/>',
    dashboard: '<path d="M3 3v18h18"/><path d="M7 15v3M11 11v7M15 13v5M19 7v11"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/>',
    left: '<path d="m15 6-6 6 6 6"/>',
    right: '<path d="m9 6 6 6-6 6"/>',
    workers: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    observer: '<path d="M3 12h4l3-8 4 16 3-8h4"/>',
    gauge: '<path d="M4 18a8 8 0 1 1 16 0"/><path d="m12 18 4-6"/><circle cx="12" cy="18" r="1"/>',
    reader: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5"/><path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>',
    reports: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M9 17v-3M12 17v-6M15 17v-2"/>',
    play: '<path d="M7 4.5v15a1 1 0 0 0 1.5.86l12-7.5a1 1 0 0 0 0-1.72l-12-7.5A1 1 0 0 0 7 4.5z"/>',
    stop: '<rect x="5" y="5" width="14" height="14" rx="2"/>',
    terminal: '<path d="m5 8 4 4-4 4M12 17h7"/><rect x="2" y="3" width="20" height="18" rx="2"/>',
    external: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
    lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
    monitor: '<rect x="2" y="4" width="20" height="13" rx="2"/><path d="M8 21h8M12 17v4"/>',
    download: '<path d="M12 3v12M7 10l5 5 5-5M5 21h14"/>',
    x: '<path d="M18 6 6 18M6 6l12 12"/>',
    check: '<path d="m5 12 5 5L20 7"/>',
    alert: '<path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/>',
    copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/>',
    rerun: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>',
    sliders: '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
  };

  function icon(name) {
    const body = ICONS[name];
    if (!body) return '';
    const filled = name === 'play' || name === 'stop';
    return '<svg viewBox="0 0 24 24" aria-hidden="true" fill="' + (filled ? 'currentColor' : 'none') +
      '" stroke="currentColor" stroke-width="' + (filled ? '0' : '1.8') + '" stroke-linecap="round" stroke-linejoin="round">' + body + '</svg>';
  }

  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  }

  // ── Confirm dialog (replaces window.confirm; same yes/no contract) ──────────
  function confirmDialog(options) {
    const opts = Object.assign({ title: 'Are you sure?', lines: [], warning: '', confirmLabel: 'Confirm', cancelLabel: 'Cancel', danger: false }, options);
    return new Promise((resolve) => {
      const modal = document.createElement('div');
      modal.className = 'modal open';
      modal.setAttribute('role', 'dialog');
      modal.setAttribute('aria-modal', 'true');
      modal.innerHTML =
        '<div class="modal-card">' +
          '<header><h2>' + esc(opts.title) + '</h2>' +
            '<button type="button" class="btn ghost sm icon" data-act="cancel" aria-label="Close">' + icon('x') + '</button></header>' +
          '<div class="modal-body">' + opts.lines.map((line) => '<p>' + esc(line) + '</p>').join('') +
            (opts.warning ? '<div class="warn-line">' + esc(opts.warning) + '</div>' : '') + '</div>' +
          '<footer>' +
            '<button type="button" class="btn ghost" data-act="cancel">' + esc(opts.cancelLabel) + '</button>' +
            '<button type="button" class="btn ' + (opts.danger ? 'danger solid' : 'primary') + '" data-act="ok">' + esc(opts.confirmLabel) + '</button>' +
          '</footer>' +
        '</div>';
      const previous = document.activeElement;
      const close = (answer) => {
        document.removeEventListener('keydown', onKey, true);
        modal.remove();
        if (previous && typeof previous.focus === 'function') previous.focus();
        resolve(answer);
      };
      const onKey = (ev) => {
        if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); close(false); }
        else if (ev.key === 'Enter') {
          ev.preventDefault(); ev.stopPropagation();
          const focused = document.activeElement && document.activeElement.closest ? document.activeElement.closest('[data-act]') : null;
          close(focused ? focused.dataset.act === 'ok' : true);
        }
        else ev.stopPropagation();
      };
      modal.addEventListener('click', (ev) => {
        const act = ev.target.closest('[data-act]');
        if (act) close(act.dataset.act === 'ok');
        else if (ev.target === modal) close(false);
      });
      document.addEventListener('keydown', onKey, true);
      document.body.appendChild(modal);
      modal.querySelector('[data-act="ok"]').focus();
    });
  }

  // ── Toasts ──────────────────────────────────────────────────────────────────
  let toastHost;
  function toast(options) {
    const opts = typeof options === 'string' ? { title: options } : Object.assign({}, options);
    if (!toastHost) {
      toastHost = document.createElement('div');
      toastHost.className = 'toasts';
      toastHost.setAttribute('role', 'status');
      toastHost.setAttribute('aria-live', 'polite');
      document.body.appendChild(toastHost);
    }
    const kind = opts.kind || 'info';
    const el = document.createElement('div');
    el.className = 'toast ' + kind;
    el.innerHTML = '<div class="t-body"><div class="t-title">' + esc(opts.title || '') + '</div>' +
      (opts.text ? '<div class="t-text">' + esc(opts.text) + '</div>' : '') + '</div>' +
      '<button type="button" class="btn ghost sm icon" aria-label="Dismiss">' + icon('x') + '</button>';
    el.querySelector('button').addEventListener('click', () => el.remove());
    toastHost.appendChild(el);
    setTimeout(() => el.remove(), opts.ms || (kind === 'error' ? 8000 : 4000));
  }

  // ── Header: app navigation + access badge ───────────────────────────────────
  const servedByQa = window.SGAP_QA_API === '';
  const qaApi = window.SGAP_QA_API !== undefined ? window.SGAP_QA_API : 'http://127.0.0.1:3850';
  // Pages served by the control panel follow one run: /runs/RUN-0007/, …/observe, …/reader.
  let runId = window.SGAP_RUN_ID || '';
  const page = (p) => p.replace(/^\/runs\/RUN-\d+/, '') || '/';
  const NAV = [
    { key: 'dashboard', href: servedByQa ? '/dashboard' : qaApi + '/dashboard', label: 'Dashboard', title: 'Dashboard — pass/fail analytics by day, week, month and year', match: (p) => p.startsWith('/dashboard') },
    { key: 'workers', icon: 'play', sub: '/', label: 'Test runner', title: 'Test runner — start runs and watch live workers', match: (p) => page(p) === '/' || page(p) === '/index.html' },
    { key: 'pad', icon: 'gauge', href: servedByQa ? '/pad' : qaApi + '/pad', label: 'PAD Tester', title: 'PAD Tester — FPS and performance runs on their own screen, one game at a time', match: (p) => p.startsWith('/pad') },
    { key: 'observer', sub: '/observe', label: 'Observer', title: 'Monitor Worker — network, console, WebSocket, events and balance per test', match: (p) => page(p).startsWith('/observe') },
    { key: 'reader', sub: '/reader', label: 'Backend Reader', title: 'Backend Reader — idle/spin frames against backend grid and payload', match: (p) => page(p).startsWith('/reader') },
    { key: 'reports', href: servedByQa ? '/allure/' : 'http://127.0.0.1:5055/', label: 'Reports', title: 'Allure history — every published run', external: true, match: () => false },
  ];
  function navHref(item) {
    if (item.href) return item.href;
    return servedByQa && runId ? '/runs/' + runId + (item.sub === '/' ? '/' : item.sub) : item.sub;
  }

  const access = { user: null };

  function renderNav() {
    const path = location.pathname;
    document.querySelectorAll('[data-appnav]').forEach((nav) => {
      nav.innerHTML = NAV.map((item) =>
        '<a href="' + esc(navHref(item)) + '" title="' + esc(item.title + (item.sub && runId ? ' · ' + runId : '')) + '"' + (item.match(path) ? ' class="on" aria-current="page"' : '') +
        (item.external ? ' target="_blank" rel="noreferrer"' : '') + '>' + icon(item.icon || item.key) + '<span>' + esc(item.label) + '</span></a>').join('');
    });
  }
  function setRun(id) {
    runId = id || '';
    renderNav();
  }

  async function loadAccess() {
    const badge = document.getElementById('access');
    try {
      const res = await fetch(qaApi + '/api/qa/access', { cache: 'no-store' });
      if (!res.ok) throw new Error(res.statusText);
      Object.assign(access, await res.json());
    } catch {
      if (badge) badge.hidden = true;
      return access;
    }
    if (badge) {
      badge.hidden = false;
      badge.className = 'access';
      badge.innerHTML = icon('lock') + '<span>Local only</span>';
      badge.title = 'The control panel only accepts connections from this PC.';
    }
    return access;
  }

  function mountRailPin() {
    const pin = document.getElementById('rail-pin');
    if (!pin) return;
    const apply = (on) => {
      document.body.classList.toggle('rail-pinned', on);
      pin.setAttribute('aria-pressed', String(on));
      pin.title = on ? 'Collapse the navigation' : 'Pin the navigation open';
    };
    try { apply(localStorage.getItem('sgap.railPinned') === '1'); } catch { apply(false); }
    pin.addEventListener('click', () => {
      const on = !document.body.classList.contains('rail-pinned');
      apply(on);
      try { localStorage.setItem('sgap.railPinned', on ? '1' : '0'); } catch { /* storage blocked */ }
    });
  }

  function mountChrome() {
    renderNav();
    document.querySelectorAll('[data-icon]').forEach((el) => {
      el.insertAdjacentHTML('afterbegin', icon(el.dataset.icon));
    });
    mountRailPin();
    return loadAccess();
  }

  window.SGAP = { icon, esc, confirm: confirmDialog, toast, access, mountChrome, qaApi, setRun };
})();
