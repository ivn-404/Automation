/**
 * Drop URL/token-shaped keys and strings from a learned-game record.
 * Mirrors src/discovery/assess.ts stripLearnedSecrets so the panel never writes a session.
 */

export function stripLearnedSecrets(value) {
  if (Array.isArray(value)) return value.map(stripLearnedSecrets);
  if (value !== null && typeof value === 'object') {
    const out = {};
    for (const [key, child] of Object.entries(value)) {
      if (/token|refresh|password|secret|authorization|launchUrl/iu.test(key)) continue;
      if (typeof child === 'string' && /(?:^|[?&])(?:token|refresh_token)=/iu.test(child)) continue;
      out[key] = stripLearnedSecrets(child);
    }
    return out;
  }
  return value;
}
