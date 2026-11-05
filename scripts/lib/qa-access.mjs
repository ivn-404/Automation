/**
 * The SGAP control panel (scripts/qa-testing-page.mjs) is local only: it binds to
 * 127.0.0.1 and answers loopback callers. Tests, browsers, files and the per-run
 * monitor stay on this PC.
 */
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const LOOPBACK_ORIGIN = /^http:\/\/(127\.0\.0\.1|localhost|\[::1\]):\d+$/u;

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
  'X-Frame-Options': 'SAMEORIGIN',
  'Referrer-Policy': 'no-referrer',
};
