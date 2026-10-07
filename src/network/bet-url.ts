/**
 * The one place that knows what a bet / buy / initialize URL looks like.
 *
 * A game's `network.*UrlPattern` in its manifest is authoritative. The constants
 * below are the platform's default route shapes, kept only so code paths without a
 * manifest (probes, calibrators) still recognise traffic. They describe the
 * platform API, not any single game, so a new title needs no change here — only a
 * manifest pattern if its routes differ.
 */
import type { GameManifest, NetworkConfig } from '../core/models/index.js';

/**
 * Minimal glob matcher for Playwright-style URL patterns (supports ** wildcards).
 * Query strings and hashes are ignored for matching.
 */
export function matchesUrlPattern(url: string, pattern: string): boolean {
  let pathname = url;
  try {
    const parsed = new URL(url);
    pathname = `${parsed.origin}${parsed.pathname}`;
  } catch {
    pathname = url.split('?')[0]?.split('#')[0] ?? url;
  }

  const escaped = pattern
    .replace(/[.+?^${}()|[\]\\]/gu, '\\$&')
    .replace(/\*\*/gu, '___DOUBLE_STAR___')
    .replace(/\*/gu, '[^/]*')
    .replace(/___DOUBLE_STAR___/gu, '.*');
  return new RegExp(`^${escaped}$`, 'u').test(pathname);
}

/** Platform default routes, overridable per game via the manifest. */
export const PLATFORM_ROUTES = {
  bet: '/api/v1/slots/bet',
  buy: '/api/v1/slots/buy',
  initialize: '/api/v1/slots/initialize',
  unresolvedSpin: '/api/v1/unresolved-spin/',
} as const;

type NetworkSource = GameManifest | NetworkConfig | undefined;

function network(source: NetworkSource): NetworkConfig | undefined {
  if (source === undefined) {
    return undefined;
  }
  return 'betUrlPattern' in source ? source : source.network;
}

/** True when `url` is this game's bet/spin endpoint. */
export function matchesBetUrl(url: string, source?: NetworkSource): boolean {
  const pattern = network(source)?.betUrlPattern;
  if (pattern !== undefined && matchesUrlPattern(url, pattern)) {
    return true;
  }
  return url.includes(PLATFORM_ROUTES.bet);
}

/** True when `url` is a buy-feature purchase endpoint. */
export function matchesBuyUrl(url: string, source?: NetworkSource): boolean {
  const pattern = network(source)?.buyUrlPattern;
  if (pattern !== undefined && matchesUrlPattern(url, pattern)) {
    return true;
  }
  return url.includes(PLATFORM_ROUTES.buy);
}

/** True when `url` is the session initialize endpoint. */
export function matchesInitializeUrl(url: string, source?: NetworkSource): boolean {
  const pattern = network(source)?.initializeUrlPattern;
  if (pattern !== undefined && matchesUrlPattern(url, pattern)) {
    return true;
  }
  return url.includes(PLATFORM_ROUTES.initialize);
}

/** Either a spin or a purchase — both debit the balance. */
export function matchesBetOrBuyUrl(url: string, source?: NetworkSource): boolean {
  return matchesBetUrl(url, source) || matchesBuyUrl(url, source);
}
