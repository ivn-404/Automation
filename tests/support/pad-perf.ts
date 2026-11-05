/**
 * Shared PAD (Performance & Asset Diagnostics) flow. Measurement windows never include SGAP
 * vision screenshots: settling happens before a window opens and after it closes; inside a
 * window only the Phaser-located spin click and network waits run.
 */

import type { Page, TestInfo } from '@playwright/test';

import { parseBetResponseBody } from '../../src/data/parse-bet-response.js';
import type { PlaywrightGameDriver } from '../../src/driver/playwright-game-driver.js';
import { matchesBetOrBuyUrl } from '../../src/network/bet-url.js';
import { primeCanvasSession, settleCanvasToBaseGame } from '../../src/platform/index.js';
import {
  fpsBand,
  frameStats,
  LONG_FRAME_MS,
  PerfSession,
  readRenderInfo,
  round1,
  type PerfWindow,
} from '../../src/perf/index.js';
import { freeSpinItemsRemaining } from '../../src/shared/spin-payload-discovery.js';
import type { SgapSession } from '../fixtures/index.js';
import { prepareCanvasSpin } from './canvas-bet-control.js';
import { waitForIdleHud } from './canvas-healing.js';
import { drainFreeSpins } from './free-spin-flow.js';

export const PAD_BET_TIMEOUT_MS = 30_000;
/** Reels keep moving for a while after `/bet`; never close a spin window earlier than this. */
const MIN_AFTER_BET_MS = 3_000;
/** Scene must stay at its idle tween count this long to count as "round complete". */
const QUIET_MS = 1_500;
const SPIN_WINDOW_MAX_MS = 25_000;

export interface PadContext {
  readonly session: SgapSession;
  readonly driver: PlaywrightGameDriver;
  readonly page: Page;
  readonly testInfo: TestInfo;
  readonly perf: PerfSession;
  /** Body of the last `/bet` seen by `measureSpin` (qualifier checks read it). */
  readonly state: { betBody?: unknown };
}

export interface SpinOptions {
  /** Leave turbo on for this spin (PAD-005); default is normal speed. */
  readonly turbo?: boolean;
  /** Tap the skip control every 150 ms until shortly after `/bet` (PAD-010). */
  readonly skipSpam?: boolean;
  /** Longer cap for big-win celebrations. */
  readonly maxMs?: number;
  /** Runs alongside the spin, started right after the click (PAD-045 hides the window). */
  readonly during?: () => Promise<unknown>;
}

export async function startPad(
  session: SgapSession,
  driver: PlaywrightGameDriver,
  page: Page,
  testInfo: TestInfo,
  manualTestId: string,
): Promise<PadContext> {
  testInfo.annotations.push(
    { type: 'manualTestId', description: manualTestId },
    { type: 'category', description: 'PAD' },
    { type: 'gameId', description: session.manifest.gameId },
  );
  // PAD-003 and friends measure normal-speed reels; turbo has its own case (PAD-005).
  process.env.SGAP_DEFAULT_TURBO = '0';
  const workerId = Number(process.env.SGAP_WORKER_ID);
  const perf = await PerfSession.start(page, {
    iframeSelector: driver.iframeSelector,
    ...(Number.isFinite(workerId) ? { workerId } : {}),
  });
  perf.setStatus(`${manualTestId} · starting`);
  const ctx: PadContext = { session, driver, page, testInfo, perf, state: {} };
  const info = await waitForFrame(ctx).then(() => perf.ensureSampler()).then(async () => {
    const frame = await page.locator(driver.iframeSelector).first().elementHandle().then((h) => h?.contentFrame());
    return frame ? readRenderInfo(frame) : undefined;
  });
  if (info !== undefined) {
    await testInfo.attach('render-info.json', {
      body: JSON.stringify({ ...info, textureCount: info.textures.length }, null, 2),
      contentType: 'application/json',
    });
  }
  return ctx;
}

async function waitForFrame(ctx: PadContext): Promise<void> {
  await ctx.driver.gameCanvas().waitFor({ state: 'visible', timeout: 90_000 });
}

/** Fresh game load in the same browser session (same launcher flow as SM-006). */
export async function reloadGame(ctx: PadContext): Promise<number> {
  ctx.perf.setStatus('reloading game');
  const started = Date.now();
  await reopenGame(ctx.session, ctx.driver, ctx.page);
  const loadMs = Date.now() - started;
  await ctx.perf.ensureSampler();
  return loadMs;
}

/** Reloads the launcher (or opens `url`) and runs the launcher flow until the game canvas shows. */
export async function reopenGame(
  session: SgapSession,
  driver: PlaywrightGameDriver,
  page: Page,
  url?: string,
): Promise<void> {
  const timeoutMs = 90_000;
  await (url === undefined
    ? page.reload({ waitUntil: 'domcontentloaded', timeout: timeoutMs })
    : page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs }));
  await session.platform.openGameHost({ timeoutMs });
  await session.platform.openGame({ timeoutMs });
  await session.platform.prepareActiveGameView({ timeoutMs });
  await driver.attach();
  await primeCanvasSession({
    page,
    driver,
    manifest: session.manifest,
    initializeBody: session.platform.getInitializeBody(),
  });
  await driver.gameCanvas().waitFor({ state: 'visible', timeout: timeoutMs });
}

/** `/initialize` bodies whose unresolved round has already been played out. */
const resumedRounds = new WeakSet<object>();

/**
 * A game opened by a previous case can resume inside its unfinished feature round. Plays it out
 * once per `/initialize` body (the body is stale after the first round of play).
 */
async function finishResumedRound(ctx: PadContext): Promise<void> {
  const init = ctx.session.platform.getInitializeBody();
  if (typeof init !== 'object' || init === null || resumedRounds.has(init)) return;
  resumedRounds.add(init);
  const record = init as Record<string, unknown>;
  const root = (typeof record.data === 'object' && record.data !== null ? record.data : record) as Record<string, unknown>;
  const round = root.unresolvedSpin;
  if (typeof round !== 'object' || round === null || Object.keys(round).length === 0) return;
  if ((await waitForIdleHud(ctx.page, ctx.driver, ctx.session.manifest, 3_000)).healed) return;
  ctx.perf.setStatus('finishing a resumed feature round');
  console.log('[pad] game resumed inside an unfinished round; playing it out before measuring');
  await drainFreeSpins(ctx.session, ctx.driver, ctx.page, Math.max(1, freeSpinItemsRemaining(round)));
}

export async function settle(ctx: PadContext, options?: { readonly turbo?: boolean }): Promise<void> {
  ctx.perf.setStatus('settling');
  await finishResumedRound(ctx);
  await settleCanvasToBaseGame(
    ctx.page,
    ctx.driver,
    ctx.session.manifest,
    ctx.session.platform.getInitializeBody(),
  );
  if (!(await prepareCanvasSpin(ctx.session, ctx.driver, ctx.page))) {
    throw new Error('spin control not visible after splash/idle wait');
  }
  const wantTurbo = options?.turbo === true;
  if (ctx.session.turbo.isTurboEnabled() !== wantTurbo) {
    await (wantTurbo ? ctx.session.turbo.enable({ timeoutMs: 8_000 }) : ctx.session.turbo.disable({ timeoutMs: 8_000 }));
  }
  const idle = await waitForIdleHud(ctx.page, ctx.driver, ctx.session.manifest, 12_000);
  if (!idle.healed) {
    throw new Error(`HUD not idle before measurement: ${idle.detail}`);
  }
}

export async function measureIdle(ctx: PadContext, label: string, ms: number): Promise<PerfWindow> {
  ctx.perf.setStatus(`${label} · idle ${Math.round(ms / 1000)} s`);
  await ctx.perf.pull();
  const token = ctx.perf.begin(label);
  await ctx.page.waitForTimeout(ms);
  return ctx.perf.end(token, { kind: 'idle', ms });
}

interface BetSummary {
  readonly status: number;
  readonly win?: string;
  readonly stake?: string;
}

function summariseBet(ctx: PadContext, status: number, body: unknown): BetSummary {
  const fields = ctx.session.manifest.network?.fields;
  if (body === undefined || fields === undefined) {
    return { status };
  }
  const parsed = parseBetResponseBody(body, fields);
  return {
    status,
    ...(parsed.win?.amount !== undefined ? { win: String(parsed.win.amount) } : {}),
    ...(parsed.bet?.amount !== undefined ? { stake: String(parsed.bet.amount) } : {}),
  };
}

/**
 * One measured base spin: click → `/bet` → scene back to its idle tween count (or timeout).
 * Settles before the window opens; the caller settles after if it needs to.
 */
export async function measureSpin(ctx: PadContext, label: string, options?: SpinOptions): Promise<PerfWindow> {
  await settle(ctx, { turbo: options?.turbo === true });
  await ctx.page.waitForTimeout(800);
  const idle = await ctx.perf.currentActivity();
  const idleTweens = idle?.tweens ?? 0;
  ctx.perf.setStatus(`${label} · spinning`);
  const isSpinBet = (response: { url(): string; request(): { method(): string } }): boolean =>
    matchesBetOrBuyUrl(response.url()) && response.request().method() === 'POST';
  const betPromise = ctx.page.waitForResponse(isSpinBet, { timeout: PAD_BET_TIMEOUT_MS });
  let extraBets = -1;
  const countBets = (response: Parameters<typeof isSpinBet>[0]): void => {
    if (isSpinBet(response)) extraBets += 1;
  };
  ctx.page.on('response', countBets);
  const token = ctx.perf.begin(label);
  ctx.perf.mark('click', 'spin');
  await ctx.session.spin.clickSpin({ timeoutMs: PAD_BET_TIMEOUT_MS });
  let betSeenAt: number | undefined;
  const skipTaps = options?.skipSpam === true ? spamSkip(ctx, () => betSeenAt) : Promise.resolve(0);
  const side = options?.during?.();
  const response = await betPromise;
  const betAt = Date.now();
  betSeenAt = betAt;
  const body = await response.json().catch(() => undefined);
  ctx.state.betBody = body;
  const bet = summariseBet(ctx, response.status(), body);
  const taps = await skipTaps;
  await side;

  let quietSince: number | undefined;
  let endReason = 'timeout';
  let peakTweens = idleTweens;
  const maxMs = options?.maxMs ?? SPIN_WINDOW_MAX_MS;
  while (Date.now() - token.startedAt < maxMs) {
    await ctx.page.waitForTimeout(250);
    const now = await ctx.perf.currentActivity();
    const tweens = now?.tweens ?? 0;
    peakTweens = Math.max(peakTweens, tweens);
    if (tweens <= idleTweens) {
      quietSince ??= Date.now();
    } else {
      quietSince = undefined;
    }
    if (
      Date.now() - betAt >= MIN_AFTER_BET_MS &&
      quietSince !== undefined &&
      Date.now() - quietSince >= QUIET_MS
    ) {
      endReason = 'quiet';
      break;
    }
  }
  ctx.page.off('response', countBets);
  return ctx.perf.end(token, {
    kind: 'spin',
    bet,
    endReason,
    idleTweens,
    peakTweens,
    betAfterMs: betAt - token.startedAt,
    ...(options?.turbo === true ? { turbo: true } : {}),
    ...(options?.skipSpam === true ? { skipTaps: taps } : {}),
    ...(extraBets > 0 ? { extraBets } : {}),
  });
}

/** How long after `/bet` the skip spam keeps going (reels stopping, win counting). */
const SKIP_SPAM_AFTER_BET_MS = 1_200;

async function spamSkip(ctx: PadContext, betSeenAt: () => number | undefined): Promise<number> {
  const action = ctx.session.manifest.metadata?.skipAction ?? 'spin';
  const started = Date.now();
  let taps = 0;
  for (;;) {
    const bet = betSeenAt();
    if ((bet !== undefined && Date.now() - bet >= SKIP_SPAM_AFTER_BET_MS) || Date.now() - started > PAD_BET_TIMEOUT_MS) {
      return taps;
    }
    await ctx.driver.clickCanvas(action, { timeoutMs: 2_000, singleInput: true }).catch(() => undefined);
    taps += 1;
    await ctx.page.waitForTimeout(150);
  }
}

/** Runs a PAD case: starts the session, always stops it and attaches every window collected. */
export async function withPad(
  fixtures: { readonly sgapSession: SgapSession; readonly sgapDriver: PlaywrightGameDriver; readonly page: Page },
  testInfo: TestInfo,
  manualTestId: string,
  body: (ctx: PadContext, windows: PerfWindow[]) => Promise<void>,
): Promise<void> {
  const ctx = await startPad(fixtures.sgapSession, fixtures.sgapDriver, fixtures.page, testInfo, manualTestId);
  const windows: PerfWindow[] = [];
  try {
    await body(ctx, windows);
  } finally {
    await ctx.perf.stop();
    if (windows.length > 0) {
      await attachWindows(testInfo, manualTestId.toLowerCase(), windows);
    }
  }
}

export async function attachWindows(
  testInfo: TestInfo,
  name: string,
  windows: readonly PerfWindow[],
): Promise<void> {
  await testInfo.attach(`${name}.json`, {
    body: JSON.stringify(windows, null, 2),
    contentType: 'application/json',
  });
  const lines = windows.map(
    (w) =>
      `${w.label.padEnd(18)} avg ${String(w.stats.avgFps).padStart(5)}  1%low ${String(w.stats.low1Fps).padStart(5)}  ` +
      `P95 ${String(w.stats.p95Ms).padStart(5)} ms  max ${String(w.stats.maxMs).padStart(6)} ms  ` +
      `hitches ${w.hitches.length}  band ${w.band.label}/${w.lowBand.label}` +
      `  ${w.frameSource}${w.browserFps !== undefined ? ` (browser ${w.browserFps})` : ''}` +
      `${w.cpuBusyPct !== undefined ? `  cpu ${w.cpuBusyPct}%` : ''}` +
      `${w.excludedMs > 0 ? `  excluded ${(w.excludedMs / 1000).toFixed(1)} s (${[...new Set(w.excludedSpans.map((s) => s.reason))].join(', ')})` : ''}`,
  );
  const drops = windows.flatMap((w) =>
    w.slowFrames.map((frame) => {
      const bet = (w.meta?.bet ?? {}) as { win?: string };
      const near = frame.nearest ? `${frame.nearest.kind} ${frame.nearest.deltaMs >= 0 ? '+' : ''}${frame.nearest.deltaMs} ms` : 'no event within 2 s';
      const act = frame.activity ? `tweens ${frame.activity.tweens}, objects ${frame.activity.objects}, particles ${frame.activity.particles}` : 'no activity sample';
      return `  ${w.label}: ${frame.ms} ms frame at +${(frame.offsetMs / 1000).toFixed(2)} s` +
        `${bet.win !== undefined ? ` (win ${bet.win})` : ''}; nearest event ${near}; ${act}`;
    }),
  );
  const cap = windows.find((w) => w.fpsCap?.limit !== undefined && w.fpsCap.limit < 60)?.fpsCap;
  if (cap?.limit !== undefined) {
    const finding = `game caps rendering at ${cap.limit} FPS (fps.limit), below the 60 FPS target`;
    lines.unshift(`Finding: ${finding}`, '');
    if (!testInfo.annotations.some((a) => a.type === 'fps cap')) {
      testInfo.annotations.push({ type: 'fps cap', description: finding });
    }
  }
  if (drops.length > 0) {
    const MAX_DROP_LINES = 200;
    lines.push('', `Frames over ${LONG_FRAME_MS.toFixed(1)} ms (FPS drops):`, ...drops.slice(0, MAX_DROP_LINES));
    if (drops.length > MAX_DROP_LINES) lines.push(`  … ${drops.length - MAX_DROP_LINES} more in ${name}.json`);
  }
  await testInfo.attach(`${name}.txt`, { body: lines.join('\n'), contentType: 'text/plain' });
  console.log(`[pad] ${name}\n${lines.join('\n')}`);
}

/** Pooled stats over several windows (frames are concatenated per window, not across gaps). */
export function pooled(windows: readonly PerfWindow[]): {
  avgFps: number;
  low1Fps: number;
  p95Ms: number;
  hitches: number;
} {
  const frames = windows.reduce((n, w) => n + w.stats.frames, 0);
  const duration = windows.reduce((n, w) => n + w.stats.durationMs, 0);
  const avgFps = duration > 0 ? round1((frames * 1000) / duration) : Number.NaN;
  return {
    avgFps,
    low1Fps: round1(Math.min(...windows.map((w) => w.stats.low1Fps))),
    p95Ms: round1(Math.max(...windows.map((w) => w.stats.p95Ms))),
    hitches: windows.reduce((n, w) => n + w.hitches.length, 0),
  };
}

export type BandOutcome = 'pass' | 'warn' | 'fail';

/** Worst of the average-FPS band and the 1%-low band. */
export function bandOutcome(avgFps: number, low1Fps: number): { verdict: BandOutcome; text: string } {
  const avg = fpsBand(avgFps);
  const low = fpsBand(low1Fps);
  const rank = { pass: 0, warn: 1, fail: 2 } as const;
  const verdict = rank[avg.verdict] >= rank[low.verdict] ? avg.verdict : low.verdict;
  return { verdict, text: `avg ${avgFps} FPS (${avg.label}), 1% low ${low1Fps} FPS (${low.label})` };
}

export function annotate(testInfo: TestInfo, type: string, description: string): void {
  testInfo.annotations.push({ type, description });
  console.log(`[pad] ${type}: ${description}`);
}

export { frameStats };
