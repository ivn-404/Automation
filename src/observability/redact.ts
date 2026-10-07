/**
 * Strip credentials before anything leaves the browser process.
 *
 * Observations are streamed to the monitor and attached to reports, so URLs (SignalR
 * hubs carry `access_token` in the query), headers, bodies, console text and
 * websocket frames all pass through here first.
 */

const SECRET_KEY = /token|authorization|cookie|secret|password|passwd|signature|jwt|api[-_]?key|session[-_]?key/iu;
const JWT = /eyJ[\w-]{6,}\.[\w-]{6,}\.[\w-]{6,}/gu;
const BEARER = /\b(Bearer|Basic)\s+[\w.~+/=-]{8,}/giu;
const SECRET_PARAM = /([?&](?:access_token|token|refresh_token|id_token|auth|sessionToken|signature)=)[^&#\s"']+/giu;
const SECRET_JSON_FIELD =
  /("(?:[\w-]*(?:token|authorization|secret|password|signature|jwt|apiKey|api_key)[\w-]*)"\s*:\s*)"[^"]*"/giu;

export const REDACTED = '[redacted]';

export function redactText(value: string): string {
  return value
    .replace(SECRET_JSON_FIELD, `$1"${REDACTED}"`)
    .replace(SECRET_PARAM, `$1${REDACTED}`)
    .replace(BEARER, `$1 ${REDACTED}`)
    .replace(JWT, '[jwt]');
}

export function redactUrl(url: string): string {
  return redactText(url);
}

export function redactHeaders(
  headers: Readonly<Record<string, string>> | undefined,
): Record<string, string> | undefined {
  if (headers === undefined) {
    return undefined;
  }
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    out[name] = SECRET_KEY.test(name) ? REDACTED : redactText(value);
  }
  return out;
}

/** Truncate to `limit` characters, saying how much was cut. */
export function clip(value: string, limit: number): string {
  if (value.length <= limit) {
    return value;
  }
  return `${value.slice(0, limit)}… [${value.length - limit} more chars]`;
}

/** Parse JSON when possible so the monitor can pretty-print it; text otherwise. */
export function redactBody(raw: string | undefined | null, limit: number): unknown {
  if (raw === undefined || raw === null || raw.length === 0) {
    return undefined;
  }
  const cleaned = redactText(raw);
  if (cleaned.length <= limit) {
    try {
      return JSON.parse(cleaned) as unknown;
    } catch {
      return cleaned;
    }
  }
  return clip(cleaned, limit);
}
