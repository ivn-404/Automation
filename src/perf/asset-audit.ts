/**
 * Network asset inventory for PAD asset cases. Every response the page sees (launcher and game
 * iframe) is recorded; GET bodies are hashed so the same bytes under two URLs show up as
 * duplicates. Responses are grouped by where they came from:
 *   - game: loaded inside the game iframe from the game's own origin;
 *   - game-third-party: loaded inside the game iframe from another origin (CDN, analytics, fonts);
 *   - launcher: loaded by the host/launcher page, not by the game.
 */

import { createHash } from 'node:crypto';

import type { CDPSession, Frame, Page, Response } from 'playwright';

import { matchesBetOrBuyUrl, PLATFORM_ROUTES } from '../network/bet-url.js';
import { redactText, redactUrl } from '../observability/redact.js';

export type AssetOrigin = 'game' | 'game-third-party' | 'launcher';
export type AssetKind = 'image' | 'audio' | 'video' | 'font' | 'script' | 'style' | 'json' | 'binary' | 'document' | 'other';

/**
 * Why a record has (or lacks) a content hash:
 * hashed; not-hashed (hashing off); too-large; not-200 (redirect, 304, error);
 * unavailable (the browser would not hand over the body); empty.
 */
export type AssetBodyStatus = 'hashed' | 'not-hashed' | 'too-large' | 'not-200' | 'unavailable' | 'empty';

export interface AssetRecord {
  readonly at: number;
  /** Credentials in the query are redacted. */
  readonly url: string;
  readonly host: string;
  readonly origin: AssetOrigin;
  readonly kind: AssetKind;
  readonly status: number;
  readonly bytes: number;
  /** Bytes that crossed the network (0 when served from the HTTP cache). */
  readonly transferBytes?: number;
  readonly fromCache: boolean;
  readonly sha256?: string;
  readonly mime?: string;
  readonly method?: string;
  readonly resourceType?: string;
  /** Request start to last body byte, from Playwright resource timing. */
  readonly durationMs?: number;
  /** `cdp` when Chrome reported the cache use, `heuristic` when inferred from sizes or status. */
  readonly cacheSource?: 'cdp' | 'heuristic';
  readonly bodyStatus?: AssetBodyStatus;
  readonly requestHeaders?: Readonly<Record<string, string>>;
  readonly responseHeaders?: Readonly<Record<string, string>>;
}

export interface AssetAuditOptions {
  /** Read and hash response bodies (default true). Off keeps the audit to headers and sizes. */
  readonly hash?: boolean;
  /** Called once per recorded response, as it arrives. */
  readonly onRecord?: (record: AssetRecord) => void;
}

const KEPT_RESPONSE_HEADERS = [
  'content-type',
  'content-length',
  'content-encoding',
  'cache-control',
  'etag',
  'last-modified',
  'expires',
  'age',
  'vary',
  'x-cache',
  'cf-cache-status',
  'server',
  'access-control-allow-origin',
];
const KEPT_REQUEST_HEADERS = ['accept', 'accept-encoding', 'range', 'if-none-match', 'if-modified-since', 'referer'];

function keptHeaders(headers: Readonly<Record<string, string>>, names: readonly string[]): Record<string, string> | undefined {
  const out: Record<string, string> = {};
  for (const name of names) {
    const value = headers[name];
    if (value !== undefined) out[name] = redactText(value);
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

export interface DuplicateGroup {
  readonly sha256: string;
  readonly bytes: number;
  readonly urls: readonly string[];
  readonly wastedBytes: number;
}

export interface RepeatDownload {
  readonly url: string;
  readonly downloads: number;
  readonly bytes: number;
}

export interface AssetReport {
  readonly total: number;
  readonly totalBytes: number;
  readonly byOrigin: Readonly<Record<AssetOrigin, { readonly count: number; readonly bytes: number; readonly hosts: readonly string[] }>>;
  readonly byKind: Readonly<Record<string, { readonly count: number; readonly bytes: number }>>;
  readonly duplicates: readonly DuplicateGroup[];
  readonly repeats: readonly RepeatDownload[];
  readonly cache: { readonly hits: number; readonly misses: number; readonly hitBytes: number; readonly missBytes: number; readonly byteRatio: number };
  readonly records: readonly AssetRecord[];
}

const HASH_LIMIT_BYTES = 40 * 1024 * 1024;

function kindOf(url: string, mime: string | undefined, resourceType: string): AssetKind {
  const path = new URL(url).pathname.toLowerCase();
  const ext = path.slice(path.lastIndexOf('.') + 1);
  const type = (mime ?? '').toLowerCase();
  if (type.startsWith('image/') || ['png', 'jpg', 'jpeg', 'webp', 'avif', 'gif', 'ktx', 'ktx2', 'basis', 'svg'].includes(ext)) return 'image';
  if (type.startsWith('audio/') || ['mp3', 'ogg', 'm4a', 'wav', 'aac', 'opus'].includes(ext)) return 'audio';
  if (type.startsWith('video/') || ['mp4', 'webm'].includes(ext)) return 'video';
  if (type.includes('font') || ['woff', 'woff2', 'ttf', 'otf', 'fnt'].includes(ext)) return 'font';
  if (type.includes('javascript') || ext === 'js' || ext === 'mjs') return 'script';
  if (type.includes('css') || ext === 'css') return 'style';
  if (type.includes('json') || ['json', 'atlas', 'skel'].includes(ext)) return ext === 'skel' ? 'binary' : 'json';
  if (resourceType === 'document' || type.includes('html')) return 'document';
  if (type.includes('octet-stream') || ['bin', 'wasm'].includes(ext)) return 'binary';
  return 'other';
}

function isApiCall(url: string, method: string): boolean {
  return method !== 'GET' || matchesBetOrBuyUrl(url) || url.includes(PLATFORM_ROUTES.unresolvedSpin);
}

export class AssetAudit {
  private records: AssetRecord[] = [];
  /** Unredacted URL per record, only to pair records with CDP cache events. */
  private rawUrls: string[] = [];
  private pending: Promise<void>[] = [];
  /** Per URL, in arrival order: whether Chrome served that response from memory/disk cache. */
  private cdpCached = new Map<string, boolean[]>();
  private readonly cdpSessions: CDPSession[] = [];
  private readonly cdpFrames = new Set<Frame>();
  private readonly onResponse = (response: Response): void => {
    this.pending.push(this.record(response).catch(() => undefined));
  };
  private readonly onFrame = (frame: Frame): void => {
    this.pending.push(this.attachCdp(frame).catch(() => undefined));
  };

  private readonly seenByUrl = new Map<string, number>();

  private constructor(
    private readonly page: Page,
    private readonly gameOrigin: () => string | undefined,
    private readonly options: AssetAuditOptions,
  ) {}

  /** `gameOrigin` is read per response so a reload onto a new iframe URL is followed. */
  static start(page: Page, gameOrigin: () => string | undefined, options: AssetAuditOptions = {}): AssetAudit {
    const audit = new AssetAudit(page, gameOrigin, options);
    page.on('response', audit.onResponse);
    page.on('framenavigated', audit.onFrame);
    audit.pending.push(audit.attachCdp(page).catch(() => undefined));
    for (const frame of page.frames()) audit.onFrame(frame);
    return audit;
  }

  /**
   * Playwright's `request.sizes()` reports body sizes for cache hits too, so cache use is read
   * from CDP. `newCDPSession(frame)` only succeeds for out-of-process iframes; in-process frames
   * are covered by the page session.
   */
  private async attachCdp(target: Page | Frame): Promise<void> {
    if (target !== this.page) {
      const frame = target as Frame;
      if (frame === this.page.mainFrame() || this.cdpFrames.has(frame)) return;
      this.cdpFrames.add(frame);
    }
    const session = await this.page.context().newCDPSession(target);
    this.cdpSessions.push(session);
    const servedFromCache = new Set<string>();
    session.on('Network.requestServedFromCache', (event) => {
      servedFromCache.add(event.requestId);
    });
    session.on('Network.responseReceived', (event) => {
      const { url, fromDiskCache, fromPrefetchCache, fromServiceWorker } = event.response;
      const cached = servedFromCache.delete(event.requestId) || fromDiskCache === true || fromPrefetchCache === true || fromServiceWorker === true;
      const list = this.cdpCached.get(url);
      if (list === undefined) this.cdpCached.set(url, [cached]);
      else list.push(cached);
    });
    await session.send('Network.enable');
  }

  private async record(response: Response): Promise<void> {
    const request = response.request();
    const url = response.url();
    if (!url.startsWith('http') || isApiCall(url, request.method())) {
      return;
    }
    const status = response.status();
    const frame = request.frame();
    const inIframe = frame !== this.page.mainFrame();
    const host = new URL(url).host;
    const origin: AssetOrigin = !inIframe
      ? 'launcher'
      : new URL(url).origin === this.gameOrigin()
        ? 'game'
        : 'game-third-party';
    const headers = await response.allHeaders().catch(() => ({}) as Record<string, string>);
    const mime = headers['content-type']?.split(';')[0]?.trim();
    const sizes = await request.sizes().catch(() => undefined);
    const hash = this.options.hash ?? true;
    let body: Buffer | undefined;
    let bodyStatus: AssetBodyStatus = hash ? 'unavailable' : 'not-hashed';
    if (status !== 200) {
      bodyStatus = 'not-200';
    } else if (hash) {
      const declared = Number(headers['content-length'] ?? '0');
      if (declared > HASH_LIMIT_BYTES) {
        bodyStatus = 'too-large';
      } else {
        body = await response.body().catch(() => undefined);
        if (body !== undefined) bodyStatus = body.length > 0 ? 'hashed' : 'empty';
      }
    }
    // Chrome can report a negative body size (encoded length below header size); that is "unknown", not a size.
    const transferBytes = sizes !== undefined && sizes.responseBodySize >= 0 ? sizes.responseBodySize : undefined;
    const bytes = body?.length ?? Number(headers['content-length'] ?? transferBytes ?? 0);
    const index = this.seenByUrl.get(url) ?? 0;
    this.seenByUrl.set(url, index + 1);
    const cdpCached = this.cdpCached.get(url)?.[index];
    const heuristic = status === 304 || response.fromServiceWorker() || (transferBytes === 0 && bytes > 0);
    const timing = request.timing();
    const durationMs = timing.responseEnd >= 0 ? Math.round(timing.responseEnd) : undefined;
    const requestHeaders = keptHeaders(await request.allHeaders().catch(() => ({})), KEPT_REQUEST_HEADERS);
    const responseHeaders = keptHeaders(headers, KEPT_RESPONSE_HEADERS);
    const record: AssetRecord = {
      at: Date.now(),
      url: redactUrl(url),
      host,
      origin,
      kind: kindOf(url, mime, request.resourceType()),
      status,
      bytes,
      ...(transferBytes !== undefined ? { transferBytes } : {}),
      fromCache: heuristic || cdpCached === true,
      ...(body !== undefined && body.length > 0 ? { sha256: createHash('sha256').update(body).digest('hex') } : {}),
      ...(mime !== undefined ? { mime } : {}),
      method: request.method(),
      resourceType: request.resourceType(),
      ...(durationMs !== undefined ? { durationMs } : {}),
      cacheSource: cdpCached !== undefined ? 'cdp' : 'heuristic',
      bodyStatus,
      ...(requestHeaders !== undefined ? { requestHeaders } : {}),
      ...(responseHeaders !== undefined ? { responseHeaders } : {}),
    };
    this.records.push(record);
    this.rawUrls.push(url);
    this.options.onRecord?.(record);
  }

  /** Records from now on only (e.g. after a cache clear and reload). */
  reset(): void {
    this.records = [];
    this.rawUrls = [];
    this.cdpCached = new Map();
    this.seenByUrl.clear();
  }

  /** Pairs each record with the CDP response for the same URL, in arrival order. */
  private resolved(): AssetRecord[] {
    const seen = new Map<string, number>();
    return this.records.map((record, position) => {
      const url = this.rawUrls[position] ?? record.url;
      const index = seen.get(url) ?? 0;
      seen.set(url, index + 1);
      const cached = this.cdpCached.get(url)?.[index];
      return cached === undefined ? record : { ...record, fromCache: record.fromCache || cached, cacheSource: 'cdp' };
    });
  }

  async settle(): Promise<void> {
    while (this.pending.length > 0) {
      const batch = this.pending.splice(0);
      await Promise.all(batch);
    }
  }

  async report(filter?: (record: AssetRecord) => boolean): Promise<AssetReport> {
    await this.settle();
    const all = this.resolved();
    const records = filter === undefined ? all : all.filter(filter);
    const byOrigin = {
      game: { count: 0, bytes: 0, hosts: new Set<string>() },
      'game-third-party': { count: 0, bytes: 0, hosts: new Set<string>() },
      launcher: { count: 0, bytes: 0, hosts: new Set<string>() },
    };
    const byKind: Record<string, { count: number; bytes: number }> = {};
    for (const record of records) {
      const bucket = byOrigin[record.origin];
      bucket.count += 1;
      bucket.bytes += record.bytes;
      bucket.hosts.add(record.host);
      const kind = (byKind[record.kind] ??= { count: 0, bytes: 0 });
      kind.count += 1;
      kind.bytes += record.bytes;
    }

    const byHash = new Map<string, AssetRecord[]>();
    for (const record of records) {
      if (record.sha256 !== undefined) {
        byHash.set(record.sha256, [...(byHash.get(record.sha256) ?? []), record]);
      }
    }
    const duplicates: DuplicateGroup[] = [];
    for (const [sha256, group] of byHash) {
      const urls = [...new Set(group.map((record) => record.url.split('?')[0]!))];
      if (urls.length > 1) {
        const bytes = group[0]!.bytes;
        duplicates.push({ sha256, bytes, urls, wastedBytes: bytes * (urls.length - 1) });
      }
    }
    duplicates.sort((a, b) => b.wastedBytes - a.wastedBytes);

    const byUrl = new Map<string, AssetRecord[]>();
    for (const record of records) {
      if (!record.fromCache && record.status === 200) {
        byUrl.set(record.url, [...(byUrl.get(record.url) ?? []), record]);
      }
    }
    const repeats: RepeatDownload[] = [...byUrl.entries()]
      .filter(([, group]) => group.length > 1)
      .map(([url, group]) => ({ url, downloads: group.length, bytes: group.reduce((n, r) => n + r.bytes, 0) }))
      .sort((a, b) => b.bytes - a.bytes);

    const hits = records.filter((record) => record.fromCache);
    const misses = records.filter((record) => !record.fromCache);
    const hitBytes = hits.reduce((n, r) => n + r.bytes, 0);
    const missBytes = misses.reduce((n, r) => n + r.bytes, 0);
    return {
      total: records.length,
      totalBytes: records.reduce((n, r) => n + r.bytes, 0),
      byOrigin: {
        game: { ...byOrigin.game, hosts: [...byOrigin.game.hosts].sort() },
        'game-third-party': { ...byOrigin['game-third-party'], hosts: [...byOrigin['game-third-party'].hosts].sort() },
        launcher: { ...byOrigin.launcher, hosts: [...byOrigin.launcher.hosts].sort() },
      },
      byKind,
      duplicates,
      repeats,
      cache: {
        hits: hits.length,
        misses: misses.length,
        hitBytes,
        missBytes,
        byteRatio: hitBytes + missBytes > 0 ? hitBytes / (hitBytes + missBytes) : Number.NaN,
      },
      records,
    };
  }

  async stop(): Promise<void> {
    this.page.off('response', this.onResponse);
    this.page.off('framenavigated', this.onFrame);
    await this.settle();
    await Promise.all(this.cdpSessions.splice(0).map((session) => session.detach().catch(() => undefined)));
  }
}

export function formatAssetReport(report: AssetReport): string {
  const kb = (bytes: number): string => `${(bytes / 1024).toFixed(1)} KB`;
  const lines = [
    `Responses: ${report.total} (${kb(report.totalBytes)})`,
    ...(['game', 'game-third-party', 'launcher'] as const).map((key) => {
      const value = report.byOrigin[key];
      return `  ${key.padEnd(17)} ${String(value.count).padStart(4)} files  ${kb(value.bytes).padStart(12)}  hosts: ${value.hosts.join(', ') || '-'}`;
    }),
    'By kind:',
    ...Object.entries(report.byKind)
      .sort((a, b) => b[1].bytes - a[1].bytes)
      .map(([kind, value]) => `  ${kind.padEnd(9)} ${String(value.count).padStart(4)} files  ${kb(value.bytes).padStart(12)}`),
    `Cache: ${report.cache.hits} hits / ${report.cache.misses} network, ` +
      `${Number.isFinite(report.cache.byteRatio) ? (report.cache.byteRatio * 100).toFixed(1) : '-'}% of bytes from cache`,
    `Duplicate content (same bytes, different URL): ${report.duplicates.length} group(s), ` +
      `${kb(report.duplicates.reduce((n, d) => n + d.wastedBytes, 0))} wasted`,
    ...report.duplicates.slice(0, 30).map((d) => `  ${kb(d.bytes)} × ${d.urls.length}: ${d.urls.join('  |  ')}`),
    `Downloaded more than once (same URL, not from cache): ${report.repeats.length}`,
    ...report.repeats.slice(0, 30).map((r) => `  ${r.downloads}× ${kb(r.bytes)} ${r.url}`),
  ];
  return lines.join('\n');
}
