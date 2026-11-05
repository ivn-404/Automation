/**
 * Pasted game URLs ("Game URL" in the Test runner and PAD Tester).
 *
 * A launch URL usually carries a live session token. The raw URL is held only in this
 * process's memory, keyed by an unguessable reference; runs, logs, env vars and argv carry
 * the reference and the redacted form. Workers fetch the raw URL from the control panel
 * over loopback while their run is active.
 */
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const POLICY_FILE = path.join('config', 'custom-url-policy.json');
const SECRET_PARAM =
  /^(?:access_token|token|refresh_token|id_token|auth|sessiontoken|session_token|launch_token|launchtoken|signature|sig|key|apikey|api_key|sid|session|session_id|sessionid|ticket|jwt|password|secret)$/iu;
const JWT = /eyJ[\w-]{6,}\.[\w-]{6,}\.[\w-]{6,}/gu;

function loadPolicy(cwd) {
  const file = path.join(cwd, POLICY_FILE);
  const policy = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
  return {
    allowedHostSuffixes: (policy.allowedHostSuffixes ?? []).map((s) => String(s).toLowerCase()),
    allowedHosts: (policy.allowedHosts ?? []).map((s) => String(s).toLowerCase()),
    allowPrivateLan: policy.allowPrivateLan === true,
  };
}

function privateLan(host) {
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/u);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

function loopbackHost(host) {
  return host === 'localhost' || host === '[::1]' || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/u.test(host);
}

/** The URL with every secret-looking query value (and any JWT anywhere) replaced. */
export function redactLaunchUrl(raw) {
  try {
    const url = new URL(raw);
    for (const name of [...url.searchParams.keys()]) {
      if (SECRET_PARAM.test(name) || JWT.test(url.searchParams.get(name) ?? '')) url.searchParams.set(name, '[redacted]');
      JWT.lastIndex = 0;
    }
    url.username = '';
    url.password = '';
    return url.toString().replace(/%5Bredacted%5D/gu, '[redacted]').replace(JWT, '[jwt]');
  } catch {
    return '[unparseable URL]';
  }
}

/**
 * Validates a pasted URL against the allowlist.
 * @returns {{ ok: boolean, reasons: string[], redacted?: string, host?: string, origin?: string, lan?: boolean, hasToken?: boolean }}
 */
export function checkLaunchUrl(raw, cwd = process.cwd()) {
  const text = String(raw ?? '').trim();
  if (text.length === 0) return { ok: false, reasons: ['Paste a game URL.'] };
  if (text.length > 4096) return { ok: false, reasons: ['URL is longer than 4096 characters.'] };
  let url;
  try {
    url = new URL(text);
  } catch {
    return { ok: false, reasons: ['Not a valid URL.'] };
  }
  const reasons = [];
  if (url.protocol !== 'http:' && url.protocol !== 'https:') reasons.push(`Only http and https URLs can be opened (got ${url.protocol}).`);
  if (url.username || url.password) reasons.push('URLs with a user name or password in them are refused.');
  const host = url.hostname.toLowerCase();
  const policy = loadPolicy(cwd);
  const lan = privateLan(host) || loopbackHost(host);
  const allowed =
    policy.allowedHosts.includes(host) ||
    policy.allowedHostSuffixes.some((suffix) => host.endsWith(suffix)) ||
    (policy.allowPrivateLan && privateLan(host));
  const panel = process.env.SGAP_QA_PANEL_URL ? new URL(process.env.SGAP_QA_PANEL_URL) : undefined;
  if (panel && loopbackHost(host) && url.port === panel.port) {
    reasons.push('This is the SGAP control panel itself, not a game. Paste the game link: a staging launch URL (…dijoker.com/<game>/?token=…) or your local dev server address.');
  }
  if (!allowed) reasons.push(`${host} is not an allowed host. Allowed: ${[...policy.allowedHostSuffixes.map((s) => `*${s}`), ...policy.allowedHosts, ...(policy.allowPrivateLan ? ['LAN dev servers'] : [])].join(', ')} (config/custom-url-policy.json).`);
  const hasToken = [...url.searchParams.keys()].some((name) => SECRET_PARAM.test(name));
  return { ok: reasons.length === 0, reasons, redacted: redactLaunchUrl(text), host, origin: url.origin, lan, hasToken };
}

/**
 * The manifest whose `metadata.launcherGameKey` names a path segment or host label of the URL
 * (e.g. `/gnome_mans_land/`), or undefined.
 * @param {Map<string, { gameId: string, metadata?: { launcherGameKey?: string } }>} manifests
 */
export function gameForLaunchUrl(raw, manifests) {
  let url;
  try {
    url = new URL(String(raw ?? '').trim());
  } catch {
    return undefined;
  }
  const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/gu, '');
  const parts = new Set(
    [...url.pathname.split('/'), ...url.hostname.split('.')].map((s) => norm(decodeURIComponent(s))).filter(Boolean),
  );
  for (const manifest of manifests.values()) {
    const raw = manifest.metadata?.launcherGameKey;
    const key = typeof raw === 'string' ? norm(raw) : '';
    if (key && parts.has(key)) return manifest;
  }
  return undefined;
}

/** Non-secret facts of a launch URL: its game key (first path segment) and `device` parameter. */
export function launchUrlFacts(raw) {
  try {
    const url = new URL(String(raw ?? '').trim());
    const segment = url.pathname.split('/').find((part) => part.length > 0);
    return {
      gameKey: segment ? decodeURIComponent(segment) : `${url.hostname}-${url.port || (url.protocol === 'https:' ? '443' : '80')}`,
      device: url.searchParams.get('device') ?? undefined,
    };
  } catch {
    return {};
  }
}

/** In-memory store: run id → raw URL, looked up by an unguessable reference. */
export function createLaunchUrlVault() {
  const byRef = new Map();
  return {
    put(runId, raw) {
      const ref = randomBytes(24).toString('hex');
      byRef.set(ref, { runId, raw });
      return ref;
    },
    take(ref) {
      return typeof ref === 'string' ? byRef.get(ref)?.raw : undefined;
    },
    release(runId) {
      for (const [ref, entry] of byRef) if (entry.runId === runId) byRef.delete(ref);
    },
  };
}
