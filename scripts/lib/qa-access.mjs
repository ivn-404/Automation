/**
 * Who may use the SGAP control panel server (scripts/qa-testing-page.mjs).
 *
 * Default: bound to 127.0.0.1, so only this PC can open it.
 * Shared (`--share` / SGAP_QA_SHARE=control|view): bound to every interface so another
 * PC on the LAN can open http://<this-pc>:<port>/?key=<access key>. Remote browsers
 * must present the key once (it becomes an HttpOnly session cookie); loopback
 * callers never need it. Remote browsers only reach the endpoints the panel uses;
 * tests, browsers, files and the per-run monitor stay on this PC.
 */
import { randomBytes, timingSafeEqual } from 'node:crypto';
import os from 'node:os';

const COOKIE = 'sgap_qa_key';
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const LOOPBACK_ORIGIN = /^http:\/\/(127\.0\.0\.1|localhost|\[::1\]):\d+$/u;

/** @returns {{ mode: 'control' | 'view', key: string } | undefined} */
export function shareConfig(argv = process.argv, env = process.env) {
  const flag = argv.find((arg) => arg === '--share' || arg.startsWith('--share='));
  const raw = (flag ? (flag.split('=')[1] ?? 'control') : env.SGAP_QA_SHARE ?? '').trim().toLowerCase();
  if (raw === '' || raw === '0' || raw === 'off' || raw === 'false') {
    return undefined;
  }
  const mode = raw === 'view' ? 'view' : 'control';
  const key = env.SGAP_QA_SHARE_KEY?.trim() || randomBytes(18).toString('base64url');
  return { mode, key };
}

export function isLoopback(req) {
  return LOOPBACK.has(req.socket.remoteAddress ?? '');
}

/** CORS only for the per-run monitor pages on this PC (http://127.0.0.1:<port>). */
export function corsHeaders(req) {
  const origin = req.headers.origin;
  if (typeof origin !== 'string' || !LOOPBACK_ORIGIN.test(origin)) {
    return {};
  }
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    Vary: 'Origin',
  };
}

export const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
};

function sameKey(candidate, key) {
  const a = Buffer.from(String(candidate ?? ''));
  const b = Buffer.from(key);
  return a.length === b.length && timingSafeEqual(a, b);
}

function cookieKey(req) {
  const header = req.headers.cookie ?? '';
  for (const part of header.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === COOKIE) {
      return decodeURIComponent(rest.join('='));
    }
  }
  return undefined;
}

/**
 * Decides one request. Returns
 *   { ok: true, remote, role }                          — serve it
 *   { ok: false, status, redirect?, cookie?, message }  — answer with this instead
 */
export function checkAccess(req, url, share) {
  if (isLoopback(req)) {
    return { ok: true, remote: false, role: 'control' };
  }
  if (share === undefined) {
    return { ok: false, status: 403, message: 'This panel only accepts connections from the host PC.' };
  }
  const offered = url.searchParams.get('key');
  if (offered !== null) {
    if (!sameKey(offered, share.key)) {
      return { ok: false, status: 401, message: 'That access key is not valid. Use the link shown on the host PC.' };
    }
    url.searchParams.delete('key');
    return {
      ok: false,
      status: 302,
      redirect: url.pathname + (url.search || ''),
      cookie: `${COOKIE}=${encodeURIComponent(share.key)}; HttpOnly; SameSite=Strict; Path=/`,
    };
  }
  if (!sameKey(cookieKey(req), share.key)) {
    return { ok: false, status: 401, message: 'Access key required. Open the link shown on the host PC (it ends in ?key=…).' };
  }
  return { ok: true, remote: true, role: share.mode };
}

export function lanUrls(port, key) {
  const urls = [];
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family === 'IPv4' && !entry.internal) {
        urls.push(`http://${entry.address}:${port}/?key=${key}`);
      }
    }
  }
  return urls;
}

export function deniedPage(message) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>SGAP · access required</title><link rel="stylesheet" href="/ui.css"></head>
<body style="display:grid;place-items:center;padding:24px"><div class="card" style="max-width:440px;width:100%">
<div class="card-head"><span class="card-title">SGAP control panel</span></div>
<div class="card-body"><p style="margin:0 0 8px">${message.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))}</p>
<p class="hint" style="margin:0">Tests run on the host PC. Ask whoever started the panel for the shared link.</p></div></div></body></html>`;
}
