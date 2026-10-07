/*
 * SGAP control panel shared UI helpers (served at /ui.js next to /ui.css).
 * window.SGAP: icon(name), confirm(options), toast(options), access (after mountChrome).
 * Pure presentation: no automation logic lives here.
 */
(function () {
  const ICONS = {
    logo: '<path d="M12 2 3 7v10l9 5 9-5V7z"/><path d="m3 7 9 5 9-5M12 12v10"/>',
    workers: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    observer: '<path d="M3 12h4l3-8 4 16 3-8h4"/>',
    reader: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5"/><path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>',
    reports: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M9 17v-3M12 17v-6M15 17v-2"/>',
    play: '<path d="M7 4.5v15a1 1 0 0 0 1.5.86l12-7.5a1 1 0 0 0 0-1.72l-12-7.5A1 1 0 0 0 7 4.5z"/>',
    stop: '<rect x="5" y="5" width="14" height="14" rx="2"/>',
    terminal: '<path d="m5 8 4 4-4 4M12 17h7"/><rect x="2" y="3" width="20" height="18" rx="2"/>',
    external: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
    share: '<path d="M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0"/><circle cx="12" cy="19.5" r="1"/><path d="M2 9a14 14 0 0 1 20 0"/>',
    lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
    monitor: '<rect x="2" y="4" width="20" height="13" rx="2"/><path d="M8 21h8M12 17v4"/>',
    download: '<path d="M12 3v12M7 10l5 5 5-5M5 21h14"/>',
    x: '<path d="M18 6 6 18M6 6l12 12"/>',
    check: '<path d="m5 12 5 5L20 7"/>',
    alert: '<path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/>',
    copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/>',
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
    { key: 'workers', sub: '/', label: 'Workers', title: 'Worker Monitor — runs, live lanes and the test runner', match: (p) => page(p) === '/' || page(p) === '/index.html' },
    { key: 'observer', sub: '/observe', label: 'Observer', title: 'Monitor Worker — network, console, WebSocket, events and balance per test', match: (p) => page(p).startsWith('/observe') },
    { key: 'reader', sub: '/reader', label: 'Backend Reader', title: 'Backend Reader — idle/spin frames against backend grid and payload', match: (p) => page(p).startsWith('/reader') },
    { key: 'reports', href: servedByQa ? '/allure/' : 'http://127.0.0.1:5055/', label: 'Reports', title: 'Allure history — every published run', external: true, match: () => false },
  ];
  function navHref(item) {
    if (item.href) return item.href;
    return servedByQa && runId ? '/runs/' + runId + (item.sub === '/' ? '/' : item.sub) : item.sub;
  }

  const access = { remote: false, role: 'control', share: null, user: null };

  function renderNav() {
    const path = location.pathname;
    document.querySelectorAll('[data-appnav]').forEach((nav) => {
      nav.innerHTML = NAV.map((item) =>
        '<a href="' + esc(navHref(item)) + '" title="' + esc(item.title + (item.sub && runId ? ' · ' + runId : '')) + '"' + (item.match(path) ? ' class="on" aria-current="page"' : '') +
        (item.external ? ' target="_blank" rel="noreferrer"' : '') + '>' + icon(item.key) + '<span>' + esc(item.label) + '</span></a>').join('');
    });
  }
  function setRun(id) {
    runId = id || '';
    renderNav();
  }
  async function signOut() {
    const ok = await confirmDialog({ title: 'Sign out of the QA panel?', lines: ['Your runs keep going on the server.'], confirmLabel: 'Sign out' });
    if (!ok) return;
    try { await fetch(qaApi + '/api/qa/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); } catch { /* offline */ }
    location.href = '/login';
  }

  function showShareDialog() {
    const urls = (access.share && access.share.urls) || [];
    const accounts = access.share && access.share.mode === 'accounts';
    const modal = document.createElement('div');
    modal.className = 'modal open';
    modal.innerHTML =
      '<div class="modal-card"><header><h2>' + (accounts ? 'Shared QA server' : 'Shared on the local network') + '</h2>' +
        '<button type="button" class="btn ghost sm icon" data-close aria-label="Close">' + icon('x') + '</button></header>' +
      '<div class="modal-body">' +
        '<p>' + (accounts
          ? 'Teammates open one of these and sign in with their own QA account (npx pnpm qa:users add &lt;name&gt; on this PC).'
          : 'Open one of these on the other PC. The link carries the access key; after the first visit the browser keeps a session cookie.') + '</p>' +
        urls.map((url) => '<div style="display:flex;gap:8px;align-items:center;margin:8px 0">' +
          '<code style="flex:1;word-break:break-all;color:var(--accent)">' + esc(url) + '</code>' +
          '<button type="button" class="btn sm" data-copy="' + esc(url) + '">' + icon('copy') + '<span>Copy</span></button></div>').join('') +
        (accounts
          ? '<p class="hint" style="margin-top:12px">Each run is its own execution with the owner\'s staging players. Testers stop their own runs; admins stop any. ' +
            'Remote browsers only reach the panel endpoints; tests, browsers and files stay on this PC.</p>'
          : '<p class="hint" style="margin-top:12px">Remote role: <b>' + esc(access.share.mode === 'view' ? 'view only' : 'control (run and stop tests)') + '</b>. ' +
            'Remote browsers only reach the runner and monitor endpoints; tests, browsers and files stay on this PC.</p>') +
      '</div></div>';
    modal.addEventListener('click', async (ev) => {
      const copy = ev.target.closest('[data-copy]');
      if (copy) {
        try { await navigator.clipboard.writeText(copy.dataset.copy); toast({ kind: 'success', title: 'Link copied' }); } catch { /* clipboard blocked */ }
        return;
      }
      if (ev.target === modal || ev.target.closest('[data-close]')) modal.remove();
    });
    document.body.appendChild(modal);
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
    document.body.classList.toggle('role-view', access.role === 'view');
    if (badge) {
      badge.hidden = false;
      badge.className = 'access';
      const user = access.user;
      if (access.remote && access.authRequired && user) {
        badge.classList.add('remote');
        badge.innerHTML = icon('monitor') + '<span>' + esc(user.name) + ' · ' + esc(user.role) + '</span>';
        badge.title = 'Signed in to the shared QA server. Click to sign out.';
        badge.onclick = signOut;
      } else if (access.remote) {
        badge.classList.add('remote');
        badge.innerHTML = icon('monitor') + '<span>Remote · ' + (access.role === 'view' ? 'view only' : 'control') + '</span>';
        badge.title = 'You are connected from another PC. Tests run on the host PC.';
      } else if (access.share && access.share.mode === 'accounts') {
        badge.classList.add('shared');
        badge.innerHTML = icon('share') + '<span>QA server · ' + esc(user ? user.name : 'host') + '</span>';
        badge.title = 'Shared QA server — click for the address teammates open';
        badge.onclick = showShareDialog;
      } else if (access.share) {
        badge.classList.add('shared');
        badge.innerHTML = icon('share') + '<span>Shared on LAN</span>';
        badge.title = 'Click for the link to open this panel from another PC';
        badge.onclick = showShareDialog;
      } else {
        badge.innerHTML = icon('lock') + '<span>Local only</span>';
        badge.title = 'Only this PC can open the panel. Start with "npx pnpm qa:server" to share it with the QA team.';
      }
    }
    return access;
  }

  function mountChrome() {
    renderNav();
    document.querySelectorAll('[data-icon]').forEach((el) => {
      el.insertAdjacentHTML('afterbegin', icon(el.dataset.icon));
    });
    return loadAccess();
  }

  window.SGAP = { icon, esc, confirm: confirmDialog, toast, access, mountChrome, qaApi, setRun };
})();
