/**
 * Scenario building blocks for the PAD cases beyond the P0 set: bought bonus rounds, autoplay
 * batches, recovery timing, hidden-window spans, cache control and `/bet` qualifiers.
 * SGAP vision helpers used here capture the page; PerfSession excludes those spans from stats.
 */

import type { Page, Response, TestInfo } from '@playwright/test';

import { parseBetResponseBody } from '../../src/data/parse-bet-response.js';
import { matchesBetUrl } from '../../src/network/bet-url.js';
import {
  AssetAudit,
  formatAssetReport,
  frameStats,
  readRenderInfo,
  round1,
  samplerInitScript,
  type AssetRecord,
  type AssetReport,
  type GameRenderInfo,
  type PerfWindow,
} from '../../src/perf/index.js';
import { onInteraction } from '../../src/reporting/interaction-journal.js';
import { locateControlByPhaser } from '../../src/runtime/phaser-locate.js';
import { readBackendSpin } from '../../src/verification/reel/backend-reader.js';
import { armBetResponses } from './autoplay-flow.js';
import { featureEnteredFromBody } from './buy-feature-verify.js';
import { buyFeatureForBet, dismissBuyFeaturePanel } from './canvas-bet-flow.js';
import { waitForIdleHud } from './canvas-healing.js';
import { drainFreeSpins } from './free-spin-flow.js';
import { prepareCanvasSpin } from './canvas-bet-control.js';
import { measureSpin, reloadGame, reopenGame, settle, type PadContext } from './pad-perf.js';

/** `SGAP_PAD_QUICK=1` shortens repeat counts and durations for a smoke pass of the suite. */
export function padQuick(): boolean {
  return process.env.SGAP_PAD_QUICK === '1';
}

export function count(full: number, quick: number): number {
  return padQuick() ? quick : full;
}

export function median(values: readonly number[]): number {
  const finite = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (finite.length === 0) return Number.NaN;
  const mid = Math.floor(finite.length / 2);
  return finite.length % 2 === 1 ? finite[mid]! : (finite[mid - 1]! + finite[mid]!) / 2;
}

export function mean(values: readonly number[]): number {
  const finite = values.filter(Number.isFinite);
  return finite.length === 0 ? Number.NaN : finite.reduce((a, b) => a + b, 0) / finite.length;
}

/** Values at a dotted path; `name[]` walks every array element (e.g. `slot.tumbles[].multiplier.current`). */
export function valuesAt(body: unknown, path: string): unknown[] {
  let current: unknown[] = [body];
  for (const part of path.split('.')) {
    const many = part.endsWith('[]');
    const key = many ? part.slice(0, -2) : part;
    const next: unknown[] = [];
    for (const value of current) {
      if (typeof value !== 'object' || value === null) continue;
      const child = (value as Record<string, unknown>)[key];
      if (many) {
        if (Array.isArray(child)) next.push(...child);
      } else if (child !== undefined) {
        next.push(child);
      }
    }
    current = next;
  }
  return current;
}

export interface BetFeatures {
  readonly win: number;
  readonly stake: number;
  /** Win ÷ stake. */
  readonly winX: number;
  readonly tumbles: number;
  readonly maxMultiplier: number;
  readonly scatters: number;
  readonly wilds: number;
  readonly featureEntered: boolean;
}

const TUMBLE_PATHS = ['slot.tumbles', 'data.slot.tumbles', 'result.slot.tumbles', 'tumbles'];

/** What a `/bet` result contains, from the manifest's paths and symbol kinds. */
export function betFeatures(ctx: PadContext, body: unknown): BetFeatures {
  const manifest = ctx.session.manifest;
  const fields = manifest.network?.fields;
  const parsed = fields === undefined || body === undefined ? undefined : parseBetResponseBody(body, fields);
  const win = Number(parsed?.win?.amount ?? 0);
  const stake = Number(parsed?.bet?.amount ?? Number.NaN);
  const tumblePath = manifest.reelValidation?.tumblesPath;
  const tumbleList = [tumblePath, ...TUMBLE_PATHS]
    .filter((path): path is string => path !== undefined)
    .map((path) => valuesAt(body, path)[0])
    .find(Array.isArray);
  const multiplierPath = manifest.metadata?.normalModeMultiplierPath;
  const multipliers = multiplierPath === undefined ? [] : valuesAt(body, multiplierPath).map(Number).filter(Number.isFinite);
  const kinds = new Map((manifest.reelValidation?.symbols ?? []).map((symbol) => [symbol.id, symbol.kind]));
  let scatters = 0;
  let wilds = 0;
  try {
    const read = readBackendSpin(body, {
      areaPath: manifest.reelValidation?.areaPath,
      tumblesPath: manifest.reelValidation?.tumblesPath,
      rowOrder: manifest.reelValidation?.rowOrder,
      areaLayout: manifest.reelValidation?.areaLayout,
      symbols: manifest.reelValidation?.symbols,
      gameId: manifest.gameId,
    });
    for (const row of read.boards[0]?.ids ?? []) {
      for (const id of row) {
        if (kinds.get(id) === 'scatter') scatters += 1;
        if (kinds.get(id) === 'wild') wilds += 1;
      }
    }
  } catch {
    // Unknown board layout: symbol counts stay 0.
  }
  return {
    win: Number.isFinite(win) ? win : 0,
    stake,
    winX: Number.isFinite(stake) && stake > 0 ? round1(win / stake) : Number.NaN,
    tumbles: Array.isArray(tumbleList) ? tumbleList.length : 0,
    maxMultiplier: multipliers.length > 0 ? Math.max(...multipliers) : 0,
    scatters,
    wilds,
    featureEntered: body !== undefined && featureEnteredFromBody(body),
  };
}

/** Win ÷ stake that counts as a "big win" (manifest `metadata.bigWinMultiplier`, default 10×). */
export function bigWinThreshold(ctx: PadContext): number {
  const raw = Number(ctx.session.manifest.metadata?.bigWinMultiplier ?? '10');
  return Number.isFinite(raw) && raw > 0 ? raw : 10;
}

export async function gameFrame(ctx: PadContext) {
  await ctx.perf.ensureSampler();
  return ctx.perf.currentFrame();
}

export async function renderInfo(ctx: PadContext): Promise<GameRenderInfo | undefined> {
  const frame = await gameFrame(ctx);
  return frame === null ? undefined : readRenderInfo(frame);
}

export async function textureCount(ctx: PadContext): Promise<number | undefined> {
  return (await renderInfo(ctx))?.textures.length;
}

export interface BoughtRound {
  readonly window: PerfWindow;
  readonly transitionIn: PerfWindow;
  readonly transitionOut: PerfWindow;
  readonly buyAt: number;
  readonly baseReadyAt: number;
  readonly buyBody: unknown;
  readonly heapBeforeMb?: number;
  readonly heapAfterMb?: number;
  readonly texturesBefore?: number;
  readonly texturesAfter?: number;
}

/** Entering / leaving a feature is the first / last few seconds of the bought round. */
const TRANSITION_MS = 6_000;

/**
 * Buy the feature, play it out to base game. The window runs from the buy click to the idle HUD.
 * `transitionIn` is the first 6 s after the buy response, `transitionOut` the last 6 s before
 * the base game was ready again.
 */
export async function playBoughtRound(
  ctx: PadContext,
  label: string,
  options?: { readonly gcHeap?: boolean },
): Promise<BoughtRound> {
  await settle(ctx);
  const heapBeforeMb = options?.gcHeap === true ? await ctx.perf.heapAfterGcMb() : undefined;
  const texturesBefore = await textureCount(ctx);
  ctx.perf.setStatus(`${label} · buying feature`);
  const token = ctx.perf.begin(label);
  ctx.perf.mark('click', 'buy');
  const buy = await buyFeatureForBet(ctx.session, ctx.driver, ctx.page, { settleAfter: false });
  const buyAt = Date.now();
  ctx.perf.setStatus(`${label} · playing feature`);
  await drainFreeSpins(ctx.session, ctx.driver, ctx.page, buy.raw);
  const baseReadyAt = Date.now();
  const window = await ctx.perf.end(token, {
    kind: 'bonus',
    win: buy.win?.amount,
    buyAfterMs: buyAt - token.startedAt,
  });
  const transitionIn = ctx.perf.windowBetween(`${label} in`, buyAt, Math.min(buyAt + TRANSITION_MS, baseReadyAt), {
    kind: 'transition-in',
  });
  const transitionOut = ctx.perf.windowBetween(
    `${label} out`,
    Math.max(buyAt, baseReadyAt - TRANSITION_MS),
    baseReadyAt,
    { kind: 'transition-out' },
  );
  const heapAfterMb = options?.gcHeap === true ? await ctx.perf.heapAfterGcMb() : undefined;
  const texturesAfter = await textureCount(ctx);
  return {
    window,
    transitionIn,
    transitionOut,
    buyAt,
    baseReadyAt,
    buyBody: buy.raw,
    ...(heapBeforeMb !== undefined ? { heapBeforeMb } : {}),
    ...(heapAfterMb !== undefined ? { heapAfterMb } : {}),
    ...(texturesBefore !== undefined ? { texturesBefore } : {}),
    ...(texturesAfter !== undefined ? { texturesAfter } : {}),
  };
}

/**
 * One autoplay batch at normal speed (the manifest's selected spin count). Returns the window
 * and the time of every `/bet` so callers can cut per-spin segments.
 */
export async function measureAutoplayBatch(
  ctx: PadContext,
  label: string,
): Promise<{ readonly window: PerfWindow; readonly betTimes: readonly number[] }> {
  const metadata = ctx.session.manifest.metadata ?? {};
  const spins = Number(metadata.autoplaySelectedSpins ?? '10');
  const startOptions = {
    timeoutMs: 30_000,
    ...(metadata.autoplaySpinCountAction !== undefined ? { spinCountAction: metadata.autoplaySpinCountAction } : {}),
  };
  await settle(ctx);
  await waitForAutoplayControl(ctx, 30_000);
  ctx.perf.setStatus(`${label} · autoplay ${spins}`);
  const betTimes: number[] = [];
  let lastBody: Promise<unknown> | undefined;
  const onBet = (response: Response): void => {
    if (response.request().method() === 'POST' && matchesBetUrl(response.url())) {
      betTimes.push(Date.now());
      lastBody = response.json().catch(() => undefined);
    }
  };
  ctx.page.on('response', onBet);
  const token = ctx.perf.begin(label);
  try {
    let responses = armBetResponses(ctx.page, spins, 90_000);
    try {
      await ctx.session.autoplay.start(startOptions);
    } catch (error) {
      responses.catch(() => undefined);
      console.log(`[pad] ${label}: autoplay start failed (${(error as Error).message.split('\n')[0]}); recovering once`);
      ctx.session.autoplay.acknowledgeStopped();
      await dismissBuyFeaturePanel(ctx.session, ctx.driver, ctx.page);
      await settle(ctx);
      responses = armBetResponses(ctx.page, spins, 90_000);
      await ctx.session.autoplay.start(startOptions);
    }
    await responses;
    const idle = await waitForIdleHud(ctx.page, ctx.driver, ctx.session.manifest, 30_000);
    if (!idle.healed) {
      console.log(`[pad] ${label}: HUD not idle after ${spins} autoplay bets (${idle.detail}); stopping autoplay`);
      await ctx.session.autoplay.stop({ timeoutMs: 15_000 }).catch(() => undefined);
      await waitForIdleHud(ctx.page, ctx.driver, ctx.session.manifest, 30_000);
    }
  } finally {
    ctx.page.off('response', onBet);
    ctx.session.autoplay.acknowledgeStopped();
  }
  const window = await ctx.perf.end(token, { kind: 'autoplay', spins, bets: betTimes.length });
  const body = await lastBody;
  if (body !== undefined && featureEnteredFromBody(body)) {
    ctx.perf.setStatus(`${label} · draining feature round`);
    await drainFreeSpins(ctx.session, ctx.driver, ctx.page, body);
  }
  return { window, betTimes };
}

/**
 * The spin control can read as idle while the last autoplay spin still animates and the HUD keeps
 * the autoplay button hidden; starting then makes the controller fall back to blind taps.
 */
async function waitForAutoplayControl(ctx: PadContext, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const found = await locateControlByPhaser(ctx.page, ctx.session.manifest, ctx.driver.iframeSelector, 'autoplay');
    if (found.found || found.detail.startsWith('no Phaser band')) return;
    await ctx.page.waitForTimeout(500);
  }
}

/**
 * How long after `from` the frame rate first holds within 3 FPS of `baselineFps` for a full
 * second. Undefined when it never does inside the frames recorded.
 */
export function timeToBaselineMs(ctx: PadContext, from: number, to: number, baselineFps: number): number | undefined {
  const spans = ctx.perf.excludedSpans();
  for (let start = from; start + 1_000 <= to; start += 250) {
    const stats = frameStats(ctx.perf.framesIn(start, start + 1_000), spans);
    if (stats.frames > 0 && stats.avgFps >= baselineFps - 3) {
      return start + 1_000 - from;
    }
  }
  return undefined;
}

async function windowId(page: Page): Promise<{ session: Awaited<ReturnType<ReturnType<Page['context']>['newCDPSession']>>; windowId: number }> {
  const session = await page.context().newCDPSession(page);
  const { windowId } = await session.send('Browser.getWindowForTarget');
  return { session, windowId };
}

/**
 * Minimises the browser window (the page becomes hidden, rAF stops) for `ms`, then restores it.
 * PerfSession turns the hidden period into an excluded span from the frame's visibility events.
 */
export async function hideWindow(ctx: PadContext, ms: number): Promise<{ readonly hiddenAt: number; readonly shownAt: number; readonly wasHidden: boolean }> {
  const { session, windowId: id } = await windowId(ctx.page);
  const hiddenAt = Date.now();
  await session.send('Browser.setWindowBounds', { windowId: id, bounds: { windowState: 'minimized' } });
  await ctx.page.waitForTimeout(Math.min(ms, 1_500));
  const frame = await gameFrame(ctx);
  const wasHidden = frame === null ? false : await frame.evaluate(() => document.visibilityState === 'hidden').catch(() => false);
  await ctx.page.waitForTimeout(Math.max(0, ms - 1_500));
  await session.send('Browser.setWindowBounds', { windowId: id, bounds: { windowState: 'normal' } });
  const shownAt = Date.now();
  ctx.perf.mark('window-restored');
  await session.detach().catch(() => undefined);
  if (!wasHidden) {
    ctx.perf.exclude(hiddenAt, shownAt, 'window-minimised');
  }
  return { hiddenAt, shownAt, wasHidden };
}

/** Empties the browser HTTP cache (cold load). */
export async function clearHttpCache(page: Page): Promise<void> {
  const session = await page.context().newCDPSession(page);
  await session.send('Network.enable').catch(() => undefined);
  await session.send('Network.clearBrowserCache');
  await session.detach().catch(() => undefined);
}

export function startAssetAudit(ctx: PadContext): AssetAudit {
  return AssetAudit.start(ctx.page, () => {
    const url = ctx.perf.currentFrame()?.url();
    try {
      return url === undefined ? undefined : new URL(url).origin;
    } catch {
      return undefined;
    }
  });
}

/** Host page JS heap after a forced GC (launcher side, for PAD-030). */
export async function hostHeapAfterGcMb(page: Page): Promise<number | undefined> {
  const session = await page.context().newCDPSession(page);
  try {
    await session.send('HeapProfiler.collectGarbage');
    const usage = await session.send('Runtime.getHeapUsage');
    return round1(usage.usedSize / (1024 * 1024));
  } catch {
    return undefined;
  } finally {
    await session.detach().catch(() => undefined);
  }
}

function findVersion(value: unknown, depth: number): string | undefined {
  if (typeof value !== 'object' || value === null || depth > 3) return undefined;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (/^(game_?)?(version|build)$/iu.test(key) && (typeof child === 'string' || typeof child === 'number')) {
      return String(child);
    }
  }
  for (const child of Object.values(value as Record<string, unknown>)) {
    const found = findVersion(child, depth + 1);
    if (found !== undefined) return found;
  }
  return undefined;
}

/** Game build label: `SGAP_GAME_BUILD`, else a version field in `/initialize`, else Phaser's game config. */
export async function gameBuild(ctx: PadContext): Promise<string> {
  const fromEnv = process.env.SGAP_GAME_BUILD?.trim();
  if (fromEnv) return fromEnv;
  const fromInit = findVersion(ctx.session.platform.getInitializeBody(), 0);
  if (fromInit !== undefined) return fromInit;
  const frame = await gameFrame(ctx);
  const fromGame = frame === null
    ? undefined
    : await frame
        .evaluate(() => {
          const w = window as unknown as Record<string, any>;
          const g = w.phaserGame ?? (Array.isArray(w.Phaser?.GAMES) ? w.Phaser.GAMES[0] : undefined);
          const version = g?.config?.gameVersion;
          return typeof version === 'string' && version.length > 0 ? version : undefined;
        })
        .catch(() => undefined);
  return fromGame ?? 'unknown';
}

/** `chrome` / `edge` plus major version, from the game frame's user agent. */
export async function browserLabel(ctx: PadContext): Promise<string> {
  const ua = (await renderInfo(ctx))?.userAgent ?? '';
  const edge = /Edg\/(\d+)/u.exec(ua);
  if (edge !== null) return `edge ${edge[1]}`;
  const chrome = /Chrome\/(\d+)/u.exec(ua);
  return chrome !== null ? `chrome ${chrome[1]}` : 'unknown';
}

/**
 * PAD-022 scenario: cache cleared → game reload → `spins` measured spins → one bought round
 * (when the game has Buy Feature). Returns the inventory of everything downloaded meanwhile.
 */
export async function coldAssetSession(
  ctx: PadContext,
  audit: AssetAudit,
  spins: number,
): Promise<{ readonly report: AssetReport; readonly windows: readonly PerfWindow[] }> {
  const windows: PerfWindow[] = [];
  await clearHttpCache(ctx.page);
  audit.reset();
  await reloadGame(ctx);
  for (let i = 1; i <= spins; i += 1) {
    windows.push(await measureSpin(ctx, `cold session spin ${i}/${spins}`));
  }
  if (ctx.session.supports('buyFeature')) {
    windows.push((await playBoughtRound(ctx, 'cold session bonus')).window);
  }
  return { report: await audit.report(), windows };
}

export async function attachAssetReport(testInfo: TestInfo, name: string, report: AssetReport): Promise<string> {
  const text = formatAssetReport(report);
  await testInfo.attach(`${name}.txt`, { body: text, contentType: 'text/plain' });
  await testInfo.attach(`${name}.json`, { body: JSON.stringify(report, null, 1), contentType: 'application/json' });
  console.log(`[pad] ${name}\n${text}`);
  return text;
}

/** A download this close to a slow frame counts as inside it (response time is header arrival). */
const DOWNLOAD_SLACK_MS = 100;

/** Game downloads (not cache hits) that arrived during a slow frame of the window. */
export function downloadsInSlowFrames(
  w: PerfWindow,
  records: readonly AssetRecord[],
  minFrameMs = 0,
): string[] {
  const hits: string[] = [];
  for (const frame of w.slowFrames.filter((f) => f.ms > minFrameMs)) {
    for (const r of records) {
      if (
        r.origin !== 'launcher' &&
        !r.fromCache &&
        r.at >= frame.at - DOWNLOAD_SLACK_MS &&
        r.at <= frame.at + frame.ms + DOWNLOAD_SLACK_MS
      ) {
        hits.push(`${frame.ms} ms frame at +${frame.offsetMs} ms ↔ ${r.kind} ${r.url}`);
      }
    }
  }
  return hits;
}

export function kb(bytes: number): string {
  return `${(bytes / 1024).toFixed(1)} KB`;
}

/**
 * Compact comparison profile (PAD-039/040): 20 s idle, 5 spins and one bought round when the
 * game has Buy Feature. Metric names ending in `Fps` are better higher, `Ms` better lower.
 */
export async function measureProfile(
  ctx: PadContext,
  label: string,
): Promise<{ readonly metrics: Record<string, number>; readonly windows: readonly PerfWindow[] }> {
  const windows: PerfWindow[] = [];
  await settle(ctx);
  const idle = await measureIdleWindow(ctx, `${label} idle`, count(20_000, 10_000));
  windows.push(idle);
  const spins: PerfWindow[] = [];
  for (let i = 1; i <= count(5, 2); i += 1) spins.push(await measureSpin(ctx, `${label} spin ${i}`));
  windows.push(...spins);
  const metrics: Record<string, number> = {
    idleAvgFps: idle.stats.avgFps,
    idleP95Ms: idle.stats.p95Ms,
    spinAvgFps: round1(mean(spins.map((w) => w.stats.avgFps))),
    spinP95Ms: round1(median(p95s(spins))),
    spinLow1Fps: round1(Math.min(...spins.map((w) => w.stats.low1Fps))),
  };
  if (ctx.session.supports('buyFeature')) {
    const bonus = (await playBoughtRound(ctx, `${label} bonus`)).window;
    windows.push(bonus);
    metrics.bonusAvgFps = bonus.stats.avgFps;
    metrics.bonusP95Ms = bonus.stats.p95Ms;
  }
  return { metrics, windows };
}

async function measureIdleWindow(ctx: PadContext, label: string, ms: number): Promise<PerfWindow> {
  await ctx.perf.pull();
  const token = ctx.perf.begin(label);
  await ctx.page.waitForTimeout(ms);
  return ctx.perf.end(token, { kind: 'idle', ms });
}

/** Metrics worse than the reference by more than `noise` (fraction), with direction by name. */
export function regressions(
  current: Readonly<Record<string, number>>,
  reference: Readonly<Record<string, number>>,
  noise = 0.1,
): string[] {
  const out: string[] = [];
  for (const [name, value] of Object.entries(current)) {
    const ref = reference[name];
    if (ref === undefined || !Number.isFinite(ref) || !Number.isFinite(value) || ref === 0) continue;
    const worse = name.endsWith('Ms') ? value > ref * (1 + noise) : value < ref * (1 - noise);
    if (worse) out.push(`${name} ${value} vs ${ref}`);
  }
  return out;
}

export function compareLines(
  current: Readonly<Record<string, number>>,
  reference: Readonly<Record<string, number>>,
): string {
  return Object.entries(current)
    .map(([name, value]) => `${name} ${reference[name] ?? '–'} → ${value}`)
    .join(', ');
}

export interface LoadTiming {
  /**
   * Game iframe document start → the last game asset fetched before SGAP's first game input has
   * arrived and frames have run under 34 ms for 0.5 s. Excludes how long SGAP takes to notice the
   * splash and tap through it.
   */
  readonly gameLoadMs: number;
  /** Game iframe document start → spin control ready, including SGAP's splash click-through. */
  readonly spinReadyMs: number;
  /** Launcher reload → spin ready, including SGAP's launcher clicks. */
  readonly totalMs: number;
  /** Frames from the iframe's first frame to spin ready. */
  readonly window: PerfWindow;
}

/**
 * One measured load. The sampler runs from document start (init script), so the load window holds
 * every frame the game drew while loading.
 */
const contextsWithInitSampler = new WeakSet<object>();

export async function measureLoad(ctx: PadContext, label: string, cold: boolean): Promise<LoadTiming> {
  const context = ctx.page.context();
  if (!contextsWithInitSampler.has(context)) {
    await context.addInitScript(samplerInitScript);
    contextsWithInitSampler.add(context);
  }
  if (cold) await clearHttpCache(ctx.page);
  ctx.perf.setStatus(`${label} · loading`);
  const started = Date.now();
  const assetTimes: number[] = [];
  const inputTimes: number[] = [];
  const onAsset = (response: Response): void => {
    const request = response.request();
    if (request.method() === 'GET' && request.frame() !== ctx.page.mainFrame() && !matchesBetUrl(response.url())) {
      assetTimes.push(Date.now());
    }
  };
  ctx.page.on('response', onAsset);
  const stopInputs = onInteraction(ctx.page, () => {
    inputTimes.push(Date.now());
  });
  let readyAt: number;
  try {
    await reopenGame(ctx.session, ctx.driver, ctx.page);
    await ctx.perf.ensureSampler();
    if (!(await prepareCanvasSpin(ctx.session, ctx.driver, ctx.page))) {
      throw new Error(`${label}: spin control not ready after load`);
    }
    readyAt = Date.now();
  } finally {
    ctx.page.off('response', onAsset);
    stopInputs();
  }
  const frame = ctx.perf.currentFrame();
  const origin = frame === null ? Number.NaN : await frame.evaluate(() => performance.timeOrigin).catch(() => Number.NaN);
  await ctx.perf.pull();
  const from = Number.isFinite(origin) ? origin : started;
  const inputAt = inputTimes.find((t) => t >= from) ?? readyAt;
  const lastAsset = Math.max(from, ...assetTimes.filter((t) => t <= inputAt));
  const loadedAt = smoothFrom(ctx.perf.browserFramesIn(lastAsset, readyAt), 500, 34) ?? lastAsset;
  return {
    gameLoadMs: Math.round(loadedAt - from),
    spinReadyMs: Math.round(readyAt - from),
    totalMs: readyAt - started,
    window: ctx.perf.windowBetween(`${label} load`, from, readyAt, { kind: 'load', cold }),
  };
}

/** First frame time from which every interval stays under `maxMs` for `holdMs`. */
function smoothFrom(times: readonly number[], holdMs: number, maxMs: number): number | undefined {
  let start = 0;
  for (let i = 1; i < times.length; i += 1) {
    if (times[i]! - times[i - 1]! >= maxMs) {
      start = i;
    } else if (times[i]! - times[start]! >= holdMs) {
      return times[start];
    }
  }
  return undefined;
}

export function p95s(windows: readonly PerfWindow[]): number[] {
  return windows.map((w) => w.stats.p95Ms);
}
