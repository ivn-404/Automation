/**
 * FPS-PHASE0 — FPS measurement validation (investigation probe, not a manual test case).
 *
 * For the local dev build (`SGAP_FPS_PROBE_URL`, loaded in an SGAP host page inside
 * `iframe[title="Game session"]`) and for the staging build (normal launcher flow), records side
 * by side per window:
 *   - browser FPS: requestAnimationFrame callbacks in the game frame;
 *   - rendered FPS: Phaser `postrender` passes, with frame-time stats;
 *   - Phaser's own `loop.actualFps` and the game's configured fps cap;
 *   - presented frames: Chrome trace frame events (PipelineReporter states, DrawFrame);
 *   - Long Animation Frames and main-thread busy % (CDP TaskDuration).
 * Every window runs with the SGAP PAD collector off, then on, to measure collector overhead.
 *
 * Exit checks reported (not asserted): rendered FPS within ±1 FPS of presented frames, and the
 * collector costing ≤ 1 rendered FPS.
 */

import type { Browser, CDPSession, Frame, Page, TestInfo } from '@playwright/test';

import { test, expect } from '../../fixtures/index.js';
import type { PlaywrightGameDriver } from '../../../src/driver/playwright-game-driver.js';
import type { GameManifest } from '../../../src/core/models/index.js';
import { matchesBetUrl } from '../../../src/network/bet-url.js';
import { PerfSession } from '../../../src/perf/index.js';
import { locateControlByPhaser } from '../../../src/runtime/phaser-locate.js';
import { prepareCanvasSpin } from '../../support/canvas-bet-control.js';
import { dismissSplashPlay } from '../../support/canvas-healing.js';

const PROBE_URL = process.env.SGAP_FPS_PROBE_URL ?? 'http://192.168.0.246:8080/?demo=true';
/** Demo builds answer spins on this route instead of the manifest bet URL. */
const DEMO_SPIN_PATH = process.env.SGAP_FPS_PROBE_SPIN_PATH ?? '/api/v1/analytics/spin';
const IDLE_MS = Number(process.env.SGAP_FPS_PROBE_IDLE_MS ?? '20000');
const SPINS = Number(process.env.SGAP_FPS_PROBE_SPINS ?? '5');
const AFTER_SPIN_MS = 7_000;
const TRACE_CATEGORIES = ['disabled-by-default-devtools.timeline.frame', 'benchmark', 'viz'];

interface ProbeRaw {
  readonly durationMs: number;
  readonly raf: number;
  readonly steps: number;
  readonly post: number[];
  readonly actualFps: number[];
  readonly loaf: number[];
  readonly cap: { limit: number; hasLimit: boolean; target: number } | null;
}

interface TraceSummary {
  readonly events: number;
  readonly presentedFrames: number;
  readonly droppedFrames: number;
  readonly pipelineStates: Record<string, number>;
  readonly drawFrameByPid: Record<string, number>;
  readonly topNames: [string, number][];
}

interface WindowResult {
  readonly build: string;
  readonly label: string;
  readonly collector: boolean;
  readonly seconds: number;
  readonly browserFps: number;
  readonly renderedFps: number;
  readonly phaserActualFps: number;
  readonly presentedFps: number;
  readonly droppedPerSec: number;
  readonly cap: ProbeRaw['cap'];
  readonly frameMs: { avg: number; p95: number; p99: number; max: number; jitter: number };
  readonly drops: number;
  readonly hitches: number;
  readonly loaf: { count: number; maxMs: number };
  readonly cpuBusyPct?: number;
  readonly trace?: TraceSummary;
  readonly traceError?: string;
}

const round = (v: number, d = 1): number => Number(v.toFixed(d));

function pct(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))]!;
}

function installProbe(): void {
  const w = window as unknown as Record<string, any>;
  const g = w.phaserGame ?? (Array.isArray(w.Phaser?.GAMES) ? w.Phaser.GAMES[0] : undefined);
  const p: Record<string, any> = { t0: performance.now(), raf: 0, steps: 0, post: [], actualFps: [], loaf: [], run: true };
  const tick = (): void => {
    p.raf += 1;
    if (p.run) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  const onPost = (): void => {
    p.post.push(performance.now());
  };
  const onStep = (): void => {
    p.steps += 1;
  };
  g?.events?.on('postrender', onPost);
  g?.events?.on('step', onStep);
  const timer = setInterval(() => {
    if (typeof g?.loop?.actualFps === 'number') p.actualFps.push(g.loop.actualFps);
  }, 500);
  let observer: { disconnect(): void } | undefined;
  try {
    const loafObserver = new PerformanceObserver((list) => {
      for (const e of list.getEntries()) p.loaf.push(e.duration);
    });
    loafObserver.observe({ type: 'long-animation-frame' as any });
    observer = loafObserver;
  } catch {
    observer = undefined;
  }
  p.cap = g?.loop ? { limit: g.loop.fpsLimit, hasLimit: g.loop.hasFpsLimit, target: g.loop.targetFps } : null;
  p.stop = (): void => {
    p.run = false;
    g?.events?.off('postrender', onPost);
    g?.events?.off('step', onStep);
    clearInterval(timer);
    observer?.disconnect();
  };
  w.__sgapFpsProbe = p;
}

function readProbe(): ProbeRaw {
  const w = window as unknown as Record<string, any>;
  const p = w.__sgapFpsProbe;
  p.stop();
  delete w.__sgapFpsProbe;
  return {
    durationMs: performance.now() - p.t0,
    raf: p.raf,
    steps: p.steps,
    post: p.post,
    actualFps: p.actualFps,
    loaf: p.loaf,
    cap: p.cap,
  };
}

function summarizeTrace(buffer: Buffer): TraceSummary {
  const parsed = JSON.parse(buffer.toString('utf8')) as unknown;
  const events = (Array.isArray(parsed) ? parsed : (parsed as { traceEvents?: unknown[] }).traceEvents ?? []) as {
    name?: string;
    ph?: string;
    pid?: number;
    args?: { chrome_frame_reporter?: { state?: string; frame_sequence?: number; frame_source?: number } };
  }[];
  const names = new Map<string, number>();
  const states: Record<string, number> = {};
  const seen = new Set<string>();
  const drawFrameByPid: Record<string, number> = {};
  let presented = 0;
  let dropped = 0;
  for (const e of events) {
    const name = e.name ?? '?';
    names.set(name, (names.get(name) ?? 0) + 1);
    if (name === 'DrawFrame') drawFrameByPid[String(e.pid)] = (drawFrameByPid[String(e.pid)] ?? 0) + 1;
    const reporter = e.args?.chrome_frame_reporter;
    if (name === 'PipelineReporter' && e.ph === 'b' && reporter?.state !== undefined) {
      const key = `${e.pid}:${reporter.frame_source ?? ''}:${reporter.frame_sequence ?? Math.random()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      states[reporter.state] = (states[reporter.state] ?? 0) + 1;
      if (reporter.state.startsWith('STATE_PRESENTED')) presented += 1;
      if (reporter.state === 'STATE_DROPPED') dropped += 1;
    }
  }
  // Playwright's JSON trace drops PipelineReporter's typed args; the busiest compositor's
  // DrawFrame count stands in for presented frames.
  if (Object.keys(states).length === 0) {
    presented = Math.max(0, ...Object.values(drawFrameByPid));
    dropped = names.get('DroppedFrame') ?? 0;
  }
  return {
    events: events.length,
    presentedFrames: presented,
    droppedFrames: dropped,
    pipelineStates: states,
    drawFrameByPid,
    topNames: [...names.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25),
  };
}

async function taskDuration(cdp: CDPSession | undefined): Promise<number | undefined> {
  if (cdp === undefined) return undefined;
  const metrics = await cdp.send('Performance.getMetrics').catch(() => undefined);
  return metrics?.metrics.find((m) => m.name === 'TaskDuration')?.value;
}

interface ProbeContext {
  readonly build: string;
  readonly page: Page;
  readonly browser: Browser;
  readonly frame: Frame;
  readonly driver: PlaywrightGameDriver;
  readonly iframeSelector: string;
}

async function measure(
  ctx: ProbeContext,
  label: string,
  collector: boolean,
  body: () => Promise<void>,
): Promise<WindowResult> {
  const perf = collector
    ? await PerfSession.start(ctx.page, { iframeSelector: ctx.iframeSelector, counter: true })
    : undefined;
  if (perf !== undefined) await perf.enableCpu().catch(() => undefined);
  const cdp = await ctx.page
    .context()
    .newCDPSession(ctx.frame)
    .catch(() => ctx.page.context().newCDPSession(ctx.page))
    .catch(() => undefined);
  await cdp?.send('Performance.enable').catch(() => undefined);
  const busy0 = await taskDuration(cdp);
  let traceError: string | undefined;
  let tracing = false;
  try {
    await ctx.browser.startTracing(ctx.page, { categories: TRACE_CATEGORIES });
    tracing = true;
  } catch (error) {
    traceError = (error as Error).message.split('\n')[0];
  }
  await ctx.frame.evaluate(installProbe);
  const startedAt = Date.now();
  try {
    await body();
  } finally {
    // keeps the probe and trace windows aligned even when the body throws
  }
  const raw = await ctx.frame.evaluate(readProbe);
  const wallS = (Date.now() - startedAt) / 1000;
  let trace: TraceSummary | undefined;
  if (tracing) {
    try {
      trace = summarizeTrace(await ctx.browser.stopTracing());
    } catch (error) {
      traceError = (error as Error).message.split('\n')[0];
    }
  }
  const busy1 = await taskDuration(cdp);
  await cdp?.detach().catch(() => undefined);
  await perf?.stop();

  const seconds = raw.durationMs / 1000;
  const intervals = raw.post.slice(1).map((t, i) => t - raw.post[i]!);
  const sorted = [...intervals].sort((a, b) => a - b);
  const avg = intervals.length > 0 ? intervals.reduce((n, v) => n + v, 0) / intervals.length : 0;
  const jitter = intervals.length > 0 ? Math.sqrt(intervals.reduce((n, v) => n + (v - avg) ** 2, 0) / intervals.length) : 0;
  const capFps = raw.cap?.hasLimit === true && raw.cap.limit > 0 ? Math.min(60, raw.cap.limit) : 60;
  const budget = 1000 / capFps;
  return {
    build: ctx.build,
    label,
    collector,
    seconds: round(seconds),
    browserFps: round(raw.raf / seconds),
    renderedFps: round(raw.post.length / seconds),
    phaserActualFps: round(raw.actualFps.reduce((n, v) => n + v, 0) / Math.max(1, raw.actualFps.length)),
    presentedFps: trace === undefined ? Number.NaN : round(trace.presentedFrames / wallS),
    droppedPerSec: trace === undefined ? Number.NaN : round(trace.droppedFrames / wallS),
    cap: raw.cap,
    frameMs: { avg: round(avg), p95: round(pct(sorted, 0.95)), p99: round(pct(sorted, 0.99)), max: round(sorted.at(-1) ?? 0), jitter: round(jitter) },
    drops: intervals.filter((v) => v > budget * 1.5).length,
    hitches: intervals.filter((v) => v > 100).length,
    loaf: { count: raw.loaf.length, maxMs: round(Math.max(0, ...raw.loaf)) },
    ...(busy0 !== undefined && busy1 !== undefined ? { cpuBusyPct: round(((busy1 - busy0) / wallS) * 100) } : {}),
    ...(trace !== undefined ? { trace } : {}),
    ...(traceError !== undefined ? { traceError } : {}),
  };
}

async function gameFrame(page: Page, iframeSelector: string): Promise<Frame> {
  const handle = await page.locator(iframeSelector).first().elementHandle({ timeout: 60_000 });
  const frame = await handle?.contentFrame();
  if (frame === null || frame === undefined) throw new Error(`no frame behind ${iframeSelector}`);
  await frame.waitForFunction(
    () => {
      const w = window as unknown as Record<string, any>;
      return (w.phaserGame ?? w.Phaser?.GAMES?.[0])?.loop !== undefined;
    },
    undefined,
    { timeout: 90_000 },
  );
  return frame;
}

async function spins(ctx: ProbeContext, isSpin: (url: string) => boolean): Promise<void> {
  for (let i = 1; i <= SPINS; i += 1) {
    const response = ctx.page.waitForResponse(
      (r) => r.request().method() === 'POST' && isSpin(r.url()),
      { timeout: 30_000 },
    );
    await ctx.driver.clickCanvas('spin', { singleInput: true, timeoutMs: 10_000 });
    await response.catch(() => undefined);
    await ctx.page.waitForTimeout(AFTER_SPIN_MS);
  }
}

async function runWindows(ctx: ProbeContext, isSpin: (url: string) => boolean): Promise<WindowResult[]> {
  const results: WindowResult[] = [];
  for (const collector of [false, true]) {
    results.push(await measure(ctx, 'idle', collector, () => ctx.page.waitForTimeout(IDLE_MS)));
    results.push(await measure(ctx, `${SPINS} spins`, collector, () => spins(ctx, isSpin)));
  }
  return results;
}

function formatResults(results: readonly WindowResult[]): string {
  const head = 'build    window    collector  rAF/s  rendered/s  actualFps  presented/s  dropped/s  cap        avg ms  p95   p99   max    jitter  drops  hitch  LoAF(max)   cpu%';
  const rows = results.map((r) =>
    [
      r.build.padEnd(8),
      r.label.padEnd(9),
      (r.collector ? 'on' : 'off').padEnd(10),
      String(r.browserFps).padStart(5),
      String(r.renderedFps).padStart(11),
      String(r.phaserActualFps).padStart(10),
      String(r.presentedFps).padStart(12),
      String(r.droppedPerSec).padStart(10),
      (r.cap === null ? '-' : r.cap.hasLimit ? `limit ${r.cap.limit}` : `none/${r.cap.target}`).padStart(10),
      String(r.frameMs.avg).padStart(7),
      String(r.frameMs.p95).padStart(5),
      String(r.frameMs.p99).padStart(5),
      String(r.frameMs.max).padStart(6),
      String(r.frameMs.jitter).padStart(7),
      String(r.drops).padStart(6),
      String(r.hitches).padStart(6),
      `${r.loaf.count}(${r.loaf.maxMs})`.padStart(10),
      String(r.cpuBusyPct ?? '-').padStart(6),
    ].join(' '),
  );
  return [head, ...rows].join('\n');
}

function exitChecks(results: readonly WindowResult[]): string[] {
  const lines: string[] = [];
  for (const r of results) {
    if (Number.isFinite(r.presentedFps)) {
      const diff = round(r.renderedFps - r.presentedFps);
      lines.push(`${r.build} ${r.label} collector ${r.collector ? 'on' : 'off'}: rendered ${r.renderedFps} vs presented ${r.presentedFps} (Δ ${diff}) → ${Math.abs(diff) <= 1 ? 'within ±1' : 'OUTSIDE ±1'}`);
    }
  }
  for (const label of new Set(results.map((r) => r.label))) {
    const off = results.find((r) => r.label === label && !r.collector);
    const on = results.find((r) => r.label === label && r.collector);
    if (off !== undefined && on !== undefined) {
      const cost = round(off.renderedFps - on.renderedFps);
      const cpu = off.cpuBusyPct !== undefined && on.cpuBusyPct !== undefined ? `, cpu ${off.cpuBusyPct}% → ${on.cpuBusyPct}%` : '';
      lines.push(`${off.build} ${label}: collector cost ${cost} rendered FPS${cpu} → ${cost <= 1 ? 'within 1 FPS' : 'OVER 1 FPS'}`);
    }
  }
  return lines;
}

async function report(testInfo: TestInfo, build: string, results: readonly WindowResult[]): Promise<void> {
  const table = formatResults(results);
  const checks = exitChecks(results);
  const text = `${table}\n\nExit checks:\n${checks.join('\n')}`;
  console.log(`[fps-phase0] ${build}\n${text}`);
  await testInfo.attach(`fps-phase0-${build}.txt`, { body: text, contentType: 'text/plain' });
  await testInfo.attach(`fps-phase0-${build}.json`, { body: JSON.stringify(results, null, 1), contentType: 'application/json' });
  for (const line of checks) testInfo.annotations.push({ type: 'exit check', description: line });
  expect(results.every((r) => r.renderedFps > 0), 'Phaser postrender events were recorded').toBe(true);
}

/**
 * Served from the game's own origin: an about:blank host is blocked by Chrome's Private Network
 * Access rules from framing LAN dev servers.
 */
async function hostPage(page: Page, url: string): Promise<void> {
  const hostUrl = new URL('/__sgap_host__', url).toString();
  const html =
    `<!doctype html><html><head><meta charset="utf-8"><title>SGAP host</title></head>` +
    `<body style="margin:0;height:100vh;background:#111;display:flex;justify-content:center">` +
    `<iframe title="Game session" allow="autoplay; fullscreen" style="border:0;height:100vh;aspect-ratio:428/926"></iframe>` +
    `<script>document.querySelector('iframe').src=${JSON.stringify(url)};</script></body></html>`;
  await page.route(hostUrl, (route) => route.fulfill({ status: 200, contentType: 'text/html', body: html }));
  await page.goto(hostUrl, { waitUntil: 'domcontentloaded' });
}

async function passSplash(
  page: Page,
  frame: Frame,
  driver: PlaywrightGameDriver,
  manifest: GameManifest,
): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const spin = await locateControlByPhaser(page, manifest, driver.iframeSelector, 'spin');
    if (spin.found) return;
    await dismissSplashPlay(page, driver, manifest).catch(() => undefined);
    await page.waitForTimeout(1_500);
  }
  const state = await frame
    .evaluate(() => {
      const w = window as unknown as Record<string, any>;
      const g = w.phaserGame;
      return {
        inner: [w.innerWidth, w.innerHeight],
        outer: [w.outerWidth, w.outerHeight],
        screen: [w.screen?.width, w.screen?.height, w.screen?.orientation?.type],
        dataset: { ...w.document.documentElement.dataset },
        bodyClass: w.document.body.className,
        scenes: g?.scene?.getScenes(true).map((s: any) => s.sys.settings.key),
        input: g?.input?.enabled,
        atTap: (() => {
          const el = w.document.elementFromPoint(w.innerWidth * 0.5, w.innerHeight * 0.768);
          return el ? `${el.tagName}#${el.id}.${String(el.className).slice(0, 80)} z=${w.getComputedStyle(el).zIndex}` : null;
        })(),
        gameSize: [g?.scale?.width, g?.scale?.height],
        canvasBounds: g?.scale?.canvasBounds,
        canvasRect: g?.canvas?.getBoundingClientRect(),
        pointer: g?.input?.activePointer ? [g.input.activePointer.x, g.input.activePointer.y, g.input.activePointer.downTime] : null,
        button: (() => {
          const s = g?.scene?.getScenes(true)[0];
          const b = s?.buttonSpin;
          return b ? { bounds: b.getBounds(), interactive: b.input?.enabled, visible: b.visible } : null;
        })(),
      };
    })
    .catch((error: Error) => ({ error: error.message }));
  throw new Error(`spin control not found after the splash: ${JSON.stringify(state)}`);
}

test.describe('FPS-PHASE0 measurement validation', () => {
  test('local URL build', async ({ page, browser, sgapDriver, sgapManifest }, testInfo) => {
    test.setTimeout(15 * 60_000);
    testInfo.annotations.push({ type: 'target', description: new URL(PROBE_URL).origin });
    const consoleErrors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 200));
    });
    await hostPage(page, PROBE_URL);
    await sgapDriver.attach();
    const frame = await gameFrame(page, sgapDriver.iframeSelector);
    await page.waitForTimeout(8_000);
    const ctx: ProbeContext = { build: 'local', page, browser, frame, driver: sgapDriver, iframeSelector: sgapDriver.iframeSelector };
    const results: WindowResult[] = [];
    for (const collector of [false, true]) {
      results.push(await measure(ctx, 'splash', collector, () => page.waitForTimeout(IDLE_MS)));
    }
    const blocker = await passSplash(page, frame, sgapDriver, sgapManifest)
      .then(() => undefined)
      .catch((error: Error) => `${error.message}\nconsole errors: ${consoleErrors.slice(-8).join(' | ')}`);
    if (blocker === undefined) {
      await page.waitForTimeout(3_000);
      results.push(...(await runWindows(ctx, (url) => url.includes(DEMO_SPIN_PATH) || matchesBetUrl(url))));
    } else {
      testInfo.annotations.push({ type: 'splash blocked', description: blocker });
      await testInfo.attach('splash-blocker.txt', { body: blocker, contentType: 'text/plain' });
    }
    await report(testInfo, 'local', results);
  });

  test('staging build', async ({ page, browser, sgapSession, sgapDriver }, testInfo) => {
    test.setTimeout(15 * 60_000);
    if (!(await prepareCanvasSpin(sgapSession, sgapDriver, page))) {
      throw new Error('spin control not ready on staging');
    }
    const frame = await gameFrame(page, sgapDriver.iframeSelector);
    await page.waitForTimeout(3_000);
    const ctx: ProbeContext = { build: 'staging', page, browser, frame, driver: sgapDriver, iframeSelector: sgapDriver.iframeSelector };
    const results = await runWindows(ctx, (url) => matchesBetUrl(url));
    await report(testInfo, 'staging', results);
  });
});
