/**
 * Monitor Worker recorder — network, console, websocket, game events and a
 * HUD / server / host balance timeline for one page, in one ordered stream.
 *
 * Game-agnostic: URLs are classified through the manifest's network patterns, the
 * HUD balance is read through the surface profile's `hudLabels.balance`, and game
 * events are derived from traffic and from the interaction journal — no title is
 * named here. Everything is redacted before it is stored or streamed.
 */

import type { ConsoleMessage, Frame, Page, Request, WebSocket } from 'playwright';

import type { GameManifest } from '../core/models/index.js';
import { parseBetResponseBody } from '../data/parse-bet-response.js';
import { matchesBetUrl, matchesBuyUrl, matchesInitializeUrl } from '../network/bet-url.js';
import { onInteraction, type InteractionEntry } from '../reporting/interaction-journal.js';
import { listPhaserTexts, type PhaserTextHit } from '../runtime/phaser-locate.js';
import { hudLabelPattern, loadSurfaceProfile } from '../surfaces/index.js';
import { clip, redactBody, redactHeaders, redactText, redactUrl } from './redact.js';
import type {
  BalanceObservation,
  ConsoleLevel,
  FrameOrigin,
  GameEventObservation,
  NetworkObservation,
  Observation,
  ObservationInput,
  ObservationSeverity,
} from './types.js';

export const INJECTED_HEADER = 'x-sgap-injected';

const REQUEST_BODY_LIMIT = 8_000;
const RESPONSE_BODY_LIMIT = 32_000;
const CONSOLE_TEXT_LIMIT = 2_000;
const WS_PAYLOAD_LIMIT = 4_000;
const MAX_CONSOLE = 3_000;
const MAX_WS_FRAMES = 3_000;
const UNHANDLED_TAG = '[sgap:unhandledrejection]';

const RELEVANT_RESOURCES = new Set(['xhr', 'fetch', 'document', 'eventsource', 'other']);

/** Game assets fetched over XHR by the engine loader; counted, stored only when they fail. */
const STATIC_ASSET = /\.(png|jpe?g|webp|gif|svg|ogg|mp3|m4a|wav|atlas|json|fnt|xml|ttf|otf|woff2?|glsl|bin|skel)(\?|#|$)/iu;

/** Texts a game paints for dialogs worth putting on the timeline. */
const NOTABLE_TEXT =
  /error|insufficient|not enough|balance too low|session|connection|disconnect|reconnect|retry|refund|failed|maintenance|unavailable|expired|try again/iu;
const INSUFFICIENT_TEXT = /insufficient|not enough|balance too low/iu;

/** Inputs the eye / healer use to clear a dialog, as opposed to game controls. */
const DISMISS_ACTION =
  /^(errorOk|acknowledge|acknowledgeAlt|dismiss|skip|closeOverlay|press-anywhere|splash-play|splashPlay|dialogConfirm|enter|tapDetected|continue)/iu;

export interface ObservationRecorderOptions {
  readonly manifest?: GameManifest;
  /** CSS selector of the game iframe; needed for the HUD balance sampler. */
  readonly iframeSelector?: string;
  /** HUD sampling period in ms; 0 disables the sampler. */
  readonly sampleMs?: number;
  /** Origins never recorded (the monitor itself). */
  readonly ignoreOrigins?: readonly string[];
  /** Called for every stored observation (streaming to the monitor). */
  readonly sink?: (observation: Observation) => void;
}

interface PendingRequest {
  readonly startedAt: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function cents(value: number): number {
  return Math.round(value * 100) / 100;
}

function parseAmount(text: string | undefined): number | undefined {
  if (text === undefined) {
    return undefined;
  }
  const match = /-?[\d,]+(?:\.\d+)?/u.exec(text);
  if (match === null) {
    return undefined;
  }
  const value = Number(match[0].replace(/,/gu, ''));
  return Number.isFinite(value) ? value : undefined;
}

function hasKey(value: unknown, pattern: RegExp, depth = 0): boolean {
  if (depth > 6 || value === null || typeof value !== 'object') {
    return false;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (pattern.test(key) || hasKey(child, pattern, depth + 1)) {
      return true;
    }
  }
  return false;
}

export class ObservationRecorder {
  private readonly page: Page;
  private readonly options: ObservationRecorderOptions;
  private readonly entries: Observation[] = [];
  private readonly pending = new Map<Request, PendingRequest>();
  private readonly balanceLabel: RegExp | undefined;
  private seq = 0;
  private socketSeq = 0;
  private consoleCount = 0;
  private wsFrames = 0;
  private wsPings = 0;
  private assetLoads = 0;
  private running = false;
  private stopping = false;
  private samplerDone: Promise<void> = Promise.resolve();
  private unsubscribeJournal: (() => void) | undefined;
  private lastServer: number | undefined;
  private lastHud: number | undefined;
  private lastHost: number | undefined;
  private lastRecorded: { hud?: number; server?: number; host?: number } = {};
  private shownTexts = new Set<string>();
  private lastUnhandled: { text: string; at: number } | undefined;

  constructor(page: Page, options: ObservationRecorderOptions = {}) {
    this.page = page;
    this.options = options;
    this.balanceLabel =
      options.manifest !== undefined
        ? hudLabelPattern(loadSurfaceProfile(options.manifest), 'balance')
        : undefined;
  }

  async start(): Promise<void> {
    if (this.running) {
      return;
    }
    this.running = true;
    await this.page
      .addInitScript((tag: string) => {
        const target = globalThis as unknown as {
          addEventListener(type: string, listener: (event: { reason?: unknown }) => void): void;
        };
        target.addEventListener('unhandledrejection', (event) => {
          const reason = event.reason as { message?: string; stack?: string } | string | undefined;
          const text =
            typeof reason === 'string' ? reason : (reason?.stack ?? reason?.message ?? String(reason));
          console.error(`${tag} ${text}`);
        });
      }, UNHANDLED_TAG)
      .catch(() => undefined);

    this.page.on('request', this.onRequest);
    this.page.on('requestfinished', this.onRequestFinished);
    this.page.on('requestfailed', this.onRequestFailed);
    this.page.on('console', this.onConsole);
    this.page.on('pageerror', this.onPageError);
    this.page.on('websocket', this.onWebSocket);
    this.unsubscribeJournal = onInteraction(this.page, this.onInteractionEntry);

    const sampleMs = this.options.sampleMs ?? 500;
    if (sampleMs > 0 && this.options.iframeSelector !== undefined) {
      this.samplerDone = this.sampleLoop(sampleMs);
    }
  }

  async stop(): Promise<void> {
    if (!this.running) {
      return;
    }
    this.stopping = true;
    this.running = false;
    await this.samplerDone.catch(() => undefined);
    // One last reading so the timeline ends on the state the test finished in.
    await this.sampleOnce('test end').catch(() => undefined);
    this.page.off('request', this.onRequest);
    this.page.off('requestfinished', this.onRequestFinished);
    this.page.off('requestfailed', this.onRequestFailed);
    this.page.off('console', this.onConsole);
    this.page.off('pageerror', this.onPageError);
    this.page.off('websocket', this.onWebSocket);
    this.unsubscribeJournal?.();
  }

  observations(): readonly Observation[] {
    return this.entries;
  }

  stats(): {
    readonly wsPings: number;
    readonly assetLoads: number;
    readonly droppedConsole: number;
    readonly droppedWsFrames: number;
  } {
    return {
      wsPings: this.wsPings,
      assetLoads: this.assetLoads,
      droppedConsole: Math.max(0, this.consoleCount - MAX_CONSOLE),
      droppedWsFrames: Math.max(0, this.wsFrames - MAX_WS_FRAMES),
    };
  }

  /** Record a runtime / game event from test or framework code. */
  event(
    name: string,
    detail?: string,
    options?: { readonly severity?: ObservationSeverity; readonly data?: unknown; readonly relatedSeq?: number },
  ): GameEventObservation {
    return this.push({
      kind: 'event',
      severity: options?.severity ?? 'info',
      summary: detail === undefined ? name : `${name} — ${detail}`,
      name,
      detail: detail === undefined ? undefined : redactText(detail),
      data: options?.data,
      relatedSeq: options?.relatedSeq,
    }) as GameEventObservation;
  }

  /** Take a balance reading now (HUD + host), tagged with what prompted it. */
  async sampleBalance(trigger: string, relatedSeq?: number): Promise<void> {
    await this.sampleOnce(trigger, relatedSeq);
  }

  private push(input: ObservationInput): Observation {
    this.seq += 1;
    const observation = { ...input, seq: this.seq, at: input.at ?? Date.now() } as Observation;
    this.entries.push(observation);
    try {
      this.options.sink?.(observation);
    } catch {
      // Streaming is best-effort.
    }
    return observation;
  }

  private frameOrigin(frame: Frame | undefined | null): FrameOrigin {
    if (frame === undefined || frame === null) {
      return 'other';
    }
    return frame === this.page.mainFrame() ? 'host' : 'game';
  }

  private requestFrame(request: Request): FrameOrigin {
    try {
      return this.frameOrigin(request.frame());
    } catch {
      return 'other';
    }
  }

  private isRelevant(request: Request): boolean {
    const url = request.url();
    if (url.startsWith('data:') || url.startsWith('blob:')) {
      return false;
    }
    if ((this.options.ignoreOrigins ?? []).some((origin) => origin.length > 0 && url.startsWith(origin))) {
      return false;
    }
    return RELEVANT_RESOURCES.has(request.resourceType());
  }

  private tagsFor(url: string): string[] {
    const manifest = this.options.manifest;
    const tags: string[] = [];
    if (matchesBetUrl(url, manifest)) tags.push('bet');
    if (matchesBuyUrl(url, manifest)) tags.push('buy');
    if (matchesInitializeUrl(url, manifest)) tags.push('initialize');
    return tags;
  }

  private readonly onRequest = (request: Request): void => {
    if (!this.isRelevant(request)) {
      return;
    }
    this.pending.set(request, { startedAt: Date.now() });
    const tags = this.tagsFor(request.url());
    if (tags.includes('bet') || tags.includes('buy')) {
      const body = redactBody(request.postData(), REQUEST_BODY_LIMIT);
      const fields =
        body !== null && typeof body === 'object'
          ? Object.entries(body as Record<string, unknown>)
              .filter(([, value]) => typeof value !== 'object')
              .map(([key, value]) => `${key}=${String(value)}`)
              .join(' ')
          : '';
      this.event(tags.includes('buy') ? 'buy-feature-attempted' : 'bet-attempted', fields || undefined, {
        data: body,
      });
    }
  };

  private readonly onRequestFinished = (request: Request): void => {
    void this.completeRequest(request, undefined);
  };

  private readonly onRequestFailed = (request: Request): void => {
    void this.completeRequest(request, request.failure()?.errorText ?? 'request failed');
  };

  private async completeRequest(request: Request, failure: string | undefined): Promise<void> {
    const pending = this.pending.get(request);
    if (pending === undefined) {
      return;
    }
    this.pending.delete(request);
    try {
      const url = request.url();
      const tags = this.tagsFor(url);
      const response = failure === undefined ? await request.response().catch(() => null) : null;
      const status = response?.status();
      const asset = tags.length === 0 && STATIC_ASSET.test(url.split('?')[0] ?? url);
      if (asset && failure === undefined && (status === undefined || status < 400)) {
        this.assetLoads += 1;
        return;
      }
      const responseHeaders = response?.headers();
      const injected = responseHeaders?.[INJECTED_HEADER] !== undefined;
      const contentType = responseHeaders?.['content-type'] ?? '';
      const readable =
        response !== null &&
        response !== undefined &&
        request.resourceType() !== 'document' &&
        /json|text|xml|javascript/iu.test(contentType);
      const responseText = readable ? await response.text().catch(() => undefined) : undefined;
      const responseBody = redactBody(responseText, RESPONSE_BODY_LIMIT);
      const timing = request.timing();
      const durationMs =
        timing.responseEnd >= 0 ? Math.round(timing.responseEnd) : Date.now() - pending.startedAt;
      const important = tags.length > 0 || failure !== undefined || (status !== undefined && status >= 400);
      const severity: ObservationSeverity =
        !asset && (failure !== undefined || (status !== undefined && status >= 500))
          ? 'error'
          : failure !== undefined || (status !== undefined && status >= 400)
            ? 'warn'
            : 'info';
      const method = request.method();
      const shortUrl = redactUrl(url).replace(/^https?:\/\/[^/]+/u, '');
      const network = this.push({
        kind: 'network',
        severity,
        summary: `${method} ${shortUrl} → ${failure ?? status ?? '?'}${injected ? ' (injected by test)' : ''} ${durationMs}ms`,
        startedAt: pending.startedAt,
        method,
        url: redactUrl(url),
        resourceType: request.resourceType(),
        frame: this.requestFrame(request),
        tags,
        status,
        durationMs,
        failure,
        injected,
        requestHeaders: important ? redactHeaders(request.headers()) : undefined,
        responseHeaders: important ? redactHeaders(responseHeaders) : undefined,
        requestBody: redactBody(request.postData(), REQUEST_BODY_LIMIT),
        responseBody,
      }) as NetworkObservation;
      this.deriveFromResponse(network, responseText);
    } catch {
      // Page closed mid-read; nothing to record.
    }
  }

  private deriveFromResponse(network: NetworkObservation, responseText: string | undefined): void {
    const ok = network.status !== undefined && network.status < 400 && network.failure === undefined;
    const isBet = network.tags.includes('bet');
    const isBuy = network.tags.includes('buy');
    const isInit = network.tags.includes('initialize');
    if (!isBet && !isBuy && !isInit) {
      return;
    }
    if (!ok) {
      const message =
        network.responseBody !== null && typeof network.responseBody === 'object'
          ? String((network.responseBody as Record<string, unknown>).message ?? '')
          : typeof network.responseBody === 'string'
            ? network.responseBody.slice(0, 160)
            : '';
      this.event(
        isBuy ? 'buy-feature-failed' : isInit ? 'initialize-failed' : 'bet-failed',
        `HTTP ${network.failure ?? network.status}${network.injected ? ' (injected by test)' : ''}${message ? `: ${message}` : ''}`,
        { severity: 'error', relatedSeq: network.seq },
      );
      return;
    }

    let parsed: unknown;
    try {
      parsed = responseText === undefined ? undefined : (JSON.parse(responseText) as unknown);
    } catch {
      parsed = undefined;
    }
    const fields = this.options.manifest?.network?.fields;
    let snapshot = parsed !== undefined && fields !== undefined ? parseBetResponseBody(parsed, fields) : undefined;
    const envelope = (parsed as { data?: unknown } | undefined)?.data;
    if (snapshot?.balance === undefined && envelope !== undefined && fields !== undefined) {
      snapshot = parseBetResponseBody(envelope, fields);
    }
    const balance = parseAmount(snapshot?.balance?.amount);
    const win = snapshot?.win?.amount;
    const stake =
      network.requestBody !== null && typeof network.requestBody === 'object'
        ? (network.requestBody as Record<string, unknown>).bet
        : undefined;

    if (isInit) {
      this.event('game-initialized', balance === undefined ? undefined : `balance=${balance}`, {
        relatedSeq: network.seq,
      });
    } else {
      const parts = [
        stake === undefined ? undefined : `stake=${String(stake)}`,
        win === undefined ? undefined : `win=${win}`,
        balance === undefined ? undefined : `balance=${balance}`,
        snapshot?.transactionState === undefined ? undefined : `state=${snapshot.transactionState}`,
      ].filter((part): part is string => part !== undefined);
      this.event(isBuy ? 'buy-feature' : 'spin-completed', parts.join(' ') || undefined, {
        relatedSeq: network.seq,
      });
    }
    if (parsed !== undefined && hasKey(parsed, /refund/iu)) {
      this.event('refund-received', 'response carries a refund field', { relatedSeq: network.seq });
    }
    if (balance !== undefined) {
      const previous = this.lastServer;
      this.lastServer = balance;
      if (previous !== undefined && cents(previous) !== cents(balance)) {
        this.event('server-balance-changed', `${previous} → ${balance} (Δ ${cents(balance - previous)})`, {
          relatedSeq: network.seq,
        });
      }
      void this.sampleOnce(isInit ? 'initialize response' : isBuy ? 'buy response' : 'bet response', network.seq);
    }
  }

  private readonly onConsole = (message: ConsoleMessage): void => {
    this.consoleCount += 1;
    if (this.consoleCount > MAX_CONSOLE) {
      return;
    }
    const type = message.type();
    const rawText = message.text();
    let level: ConsoleLevel =
      type === 'error' ? 'error' : type === 'warning' ? 'warn' : type === 'info' ? 'info' : type === 'debug' ? 'debug' : 'log';
    let text = rawText;
    if (rawText.startsWith(UNHANDLED_TAG)) {
      level = 'unhandledrejection';
      text = rawText.slice(UNHANDLED_TAG.length).trim();
      this.lastUnhandled = { text: text.split('\n')[0] ?? text, at: Date.now() };
    }
    const location = message.location();
    const where = location.url ? `${redactUrl(location.url)}:${location.lineNumber}:${location.columnNumber}` : undefined;
    let frame: FrameOrigin = 'other';
    try {
      frame = this.frameOrigin(message.page()?.mainFrame() === undefined ? undefined : this.frameOf(location.url));
    } catch {
      frame = 'other';
    }
    const clean = clip(redactText(text), CONSOLE_TEXT_LIMIT);
    this.push({
      kind: 'console',
      severity: level === 'error' || level === 'unhandledrejection' ? 'error' : level === 'warn' ? 'warn' : 'info',
      summary: `console.${level}: ${clean.split('\n')[0]?.slice(0, 200) ?? ''}`,
      level,
      text: clean,
      frame,
      location: where,
      stack: level === 'unhandledrejection' && clean.includes('\n') ? clean : undefined,
    });
  };

  private frameOf(url: string | undefined): Frame | undefined {
    if (url === undefined || url.length === 0) {
      return undefined;
    }
    const origin = (() => {
      try {
        return new URL(url).origin;
      } catch {
        return undefined;
      }
    })();
    if (origin === undefined) {
      return undefined;
    }
    return this.page.frames().find((frame) => {
      try {
        return new URL(frame.url()).origin === origin;
      } catch {
        return false;
      }
    });
  }

  private readonly onPageError = (error: Error): void => {
    const first = error.message.split('\n')[0] ?? error.message;
    if (
      this.lastUnhandled !== undefined &&
      Date.now() - this.lastUnhandled.at < 2_000 &&
      this.lastUnhandled.text.includes(first)
    ) {
      return;
    }
    const text = clip(redactText(error.message), CONSOLE_TEXT_LIMIT);
    this.push({
      kind: 'console',
      severity: 'error',
      summary: `uncaught exception: ${text.split('\n')[0]?.slice(0, 200) ?? ''}`,
      level: 'pageerror',
      text,
      frame: 'other',
      stack: error.stack === undefined ? undefined : clip(redactText(error.stack), CONSOLE_TEXT_LIMIT),
    });
  };

  private readonly onWebSocket = (socket: WebSocket): void => {
    this.socketSeq += 1;
    const socketId = this.socketSeq;
    const url = redactUrl(socket.url());
    const shortUrl = url.replace(/^wss?:\/\/[^/]+/u, '');
    this.push({
      kind: 'websocket',
      severity: 'info',
      summary: `ws#${socketId} open ${shortUrl}`,
      socketId,
      url,
      event: 'open',
    });
    this.event('websocket-connected', `ws#${socketId} ${shortUrl}`);

    const onFrame = (direction: 'sent' | 'received') => (frame: { payload: string | Buffer }) => {
      const raw = typeof frame.payload === 'string' ? frame.payload : `[binary ${frame.payload.length} bytes]`;
      const records = raw.split('\u001e').filter((record) => record.trim().length > 0);
      const parsed = records.map((record) => {
        try {
          return JSON.parse(record) as Record<string, unknown>;
        } catch {
          return undefined;
        }
      });
      // Keep-alives (SignalR type 6, JSON ping/pong) carry nothing; count them instead of storing.
      if (parsed.length > 0 && parsed.every((record) => record?.type === 6 || record?.type === 'ping' || record?.type === 'pong')) {
        this.wsPings += 1;
        return;
      }
      this.wsFrames += 1;
      if (this.wsFrames > MAX_WS_FRAMES) {
        return;
      }
      const targets = parsed
        .map((record) => (typeof record?.target === 'string' ? record.target : undefined))
        .filter((target): target is string => target !== undefined);
      const closeError = parsed.find((record) => record?.type === 7 && record.error !== undefined);
      const completionError = parsed.find((record) => record?.type === 3 && record.error !== undefined);
      const severity: ObservationSeverity = closeError !== undefined || completionError !== undefined ? 'error' : 'info';
      const payloadText = clip(redactText(raw), WS_PAYLOAD_LIMIT);
      let payload: unknown = payloadText;
      if (parsed.length === 1 && parsed[0] !== undefined && raw.length <= WS_PAYLOAD_LIMIT) {
        payload = redactBody(records[0], WS_PAYLOAD_LIMIT);
      }
      const label = targets.length > 0 ? targets.join(',') : (payloadText.split('\n')[0]?.slice(0, 120) ?? '');
      const observation = this.push({
        kind: 'websocket',
        severity,
        summary: `ws#${socketId} ${direction === 'sent' ? '→' : '←'} ${label}`,
        socketId,
        url,
        event: direction,
        bytes: raw.length,
        targets,
        payload,
      });
      if (severity === 'error') {
        this.event('websocket-error', `ws#${socketId} ${String((closeError ?? completionError)?.error)}`, {
          severity: 'error',
          relatedSeq: observation.seq,
        });
      }
      for (const target of targets) {
        if (/startround|cashout|scratch|reveal/iu.test(target)) {
          this.event('scratch', `${direction} ${target}`, { relatedSeq: observation.seq });
        }
      }
    };
    socket.on('framesent', onFrame('sent'));
    socket.on('framereceived', onFrame('received'));
    socket.on('socketerror', (message: string) => {
      const observation = this.push({
        kind: 'websocket',
        severity: 'error',
        summary: `ws#${socketId} error ${redactText(message)}`,
        socketId,
        url,
        event: 'error',
        payload: redactText(message),
      });
      this.event('websocket-error', `ws#${socketId} ${redactText(message)}`, {
        severity: 'error',
        relatedSeq: observation.seq,
      });
    });
    socket.on('close', () => {
      const observation = this.push({
        kind: 'websocket',
        severity: this.stopping ? 'info' : 'warn',
        summary: `ws#${socketId} closed${this.stopping ? ' (test end)' : ''}`,
        socketId,
        url,
        event: 'close',
      });
      if (!this.stopping) {
        this.event('websocket-disconnected', `ws#${socketId} ${shortUrl}`, {
          severity: 'warn',
          relatedSeq: observation.seq,
        });
      }
    });
  };

  private readonly onInteractionEntry = (entry: InteractionEntry): void => {
    const name =
      entry.action === 'spin'
        ? 'spin-started'
        : DISMISS_ACTION.test(entry.action)
          ? 'modal-dismiss-tap'
          : /buyFeature/iu.test(entry.action)
            ? 'buy-feature-click'
            : /scratch/iu.test(entry.action)
              ? 'scratch-click'
              : 'click';
    const point = entry.point === undefined ? '' : ` @${entry.point.x.toFixed(3)},${entry.point.y.toFixed(3)}`;
    this.event(
      name,
      `${entry.action} via ${entry.strategy}${entry.fallback ? ' (fallback)' : ''}${point}${entry.detail ? ` — ${entry.detail}` : ''}`,
      { severity: entry.confidence === 'low' ? 'warn' : 'info' },
    );
  };

  private async sampleLoop(periodMs: number): Promise<void> {
    while (this.running) {
      await this.sampleOnce('sample').catch(() => undefined);
      await sleep(periodMs);
    }
  }

  private async readHud(): Promise<{ hud?: number; texts: readonly PhaserTextHit[] }> {
    const selector = this.options.iframeSelector;
    if (selector === undefined || this.page.isClosed()) {
      return { texts: [] };
    }
    const texts = await listPhaserTexts(this.page, selector).catch(() => [] as PhaserTextHit[]);
    const label = this.balanceLabel === undefined ? undefined : texts.find((hit) => this.balanceLabel!.test(hit.text));
    if (label === undefined) {
      return { texts };
    }
    const value = texts
      .filter((hit) => /^[^\d-]{0,4}[\d,]+\.\d{1,2}$/u.test(hit.text) && hit.y > label.y && hit.y - label.y < 40)
      .sort((a, b) => Math.abs(a.x - label.x) - Math.abs(b.x - label.x))[0];
    return { hud: parseAmount(value?.text), texts };
  }

  private async readHost(): Promise<number | undefined> {
    if (this.page.isClosed()) {
      return undefined;
    }
    const text = await this.page
      .evaluate(() => {
        const doc = (globalThis as unknown as { document: { body: { innerText: string } | null } }).document;
        const match = /Balance:\s*([\d.,]+)/iu.exec(doc.body?.innerText ?? '');
        return match?.[1];
      })
      .catch(() => undefined);
    return parseAmount(text);
  }

  private trackTexts(texts: readonly PhaserTextHit[]): void {
    const notable = new Set(
      texts.map((hit) => hit.text.replace(/\s+/gu, ' ').trim()).filter((text) => NOTABLE_TEXT.test(text)),
    );
    for (const text of notable) {
      if (!this.shownTexts.has(text)) {
        const insufficient = INSUFFICIENT_TEXT.test(text);
        this.event(insufficient ? 'insufficient-balance' : 'modal-opened', `"${clip(redactText(text), 200)}"`, {
          severity: insufficient || /error|failed/iu.test(text) ? 'error' : 'warn',
        });
      }
    }
    for (const text of this.shownTexts) {
      if (!notable.has(text)) {
        this.event('modal-closed', `"${clip(redactText(text), 200)}"`);
      }
    }
    this.shownTexts = notable;
  }

  private async sampleOnce(trigger: string, relatedSeq?: number): Promise<void> {
    if (this.page.isClosed()) {
      return;
    }
    const [{ hud, texts }, host] = await Promise.all([this.readHud(), this.readHost()]);
    this.trackTexts(texts);
    if (hud !== undefined) {
      if (this.lastHud !== undefined && cents(this.lastHud) !== cents(hud)) {
        this.event('hud-balance-changed', `${this.lastHud} → ${hud} (Δ ${cents(hud - this.lastHud)})`);
      }
      this.lastHud = hud;
    }
    if (host !== undefined) {
      this.lastHost = host;
    }
    const current = { hud: this.lastHud, server: this.lastServer, host: this.lastHost };
    const unchanged =
      current.hud === this.lastRecorded.hud &&
      current.server === this.lastRecorded.server &&
      current.host === this.lastRecorded.host;
    if (trigger === 'sample' && unchanged) {
      return;
    }
    if (current.hud === undefined && current.server === undefined && current.host === undefined) {
      return;
    }
    this.lastRecorded = current;
    const diff =
      current.hud !== undefined && current.server !== undefined ? cents(current.hud - current.server) : undefined;
    const fmt = (value: number | undefined): string => (value === undefined ? '—' : String(value));
    this.push({
      kind: 'balance',
      severity: diff !== undefined && diff !== 0 ? 'warn' : 'info',
      summary: `HUD ${fmt(current.hud)} · server ${fmt(current.server)} · host ${fmt(current.host)}${diff === undefined ? '' : ` · Δ ${diff}`} (${trigger})`,
      ...current,
      diff,
      trigger,
      relatedSeq,
    } as Omit<BalanceObservation, 'seq' | 'at'>);
  }
}

const recorders = new WeakMap<Page, ObservationRecorder>();

/** The recorder installed on this page by the observation fixture, if any. */
export function observationFor(page: Page): ObservationRecorder | undefined {
  return recorders.get(page);
}

export async function startObservation(
  page: Page,
  options: ObservationRecorderOptions,
): Promise<ObservationRecorder> {
  const existing = recorders.get(page);
  if (existing !== undefined) {
    return existing;
  }
  const recorder = new ObservationRecorder(page, options);
  recorders.set(page, recorder);
  await recorder.start();
  return recorder;
}

export async function stopObservation(page: Page): Promise<ObservationRecorder | undefined> {
  const recorder = recorders.get(page);
  if (recorder === undefined) {
    return undefined;
  }
  await recorder.stop();
  recorders.delete(page);
  return recorder;
}
