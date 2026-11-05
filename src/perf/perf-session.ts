/**
 * One PAD measurement session on a game page: keeps the in-frame sampler running, drains it
 * every 500 ms, feeds the live FPS counter and the worker monitor, records gameplay events,
 * and cuts measurement windows into frame statistics.
 */

import type { CDPSession, Frame, Page, Response } from 'playwright';

import { matchesBetOrBuyUrl, PLATFORM_ROUTES } from '../network/bet-url.js';
import {
  fpsBand,
  frameStats,
  HITCH_MS,
  LONG_FRAME_MS,
  round1,
  slowFrames,
  type ExcludedSpan,
  type FpsBandInfo,
  type FrameStats,
} from './frame-metrics.js';
import { hideFpsCounter, isFpsCounterEnabled, showFpsCounter } from './fps-counter.js';
import {
  drainSampler,
  installSampler,
  pauseSampler,
  readPhaserFps,
  readSamplerUsage,
  type FpsCap,
  type SamplerDrain,
  type SceneActivity,
  type SpineUse,
  type TextureUse,
} from './frame-sampler.js';

export interface PerfEvent {
  readonly at: number;
  readonly kind: string;
  readonly detail?: string;
}

export interface WindowHitch {
  readonly at: number;
  /** Time from the window start (for a spin: from the click). */
  readonly offsetMs: number;
  readonly ms: number;
  readonly nearest?: { readonly kind: string; readonly detail?: string; readonly deltaMs: number };
  /** Scene activity sampled closest to the slow frame (within one poll). */
  readonly activity?: SceneActivity;
}

export interface PerfWindow {
  readonly label: string;
  readonly startedAt: number;
  readonly endedAt: number;
  /** `rendered`: Phaser postrender frames; `browser`: rAF ticks (no Phaser game found). */
  readonly frameSource: 'rendered' | 'browser';
  readonly stats: FrameStats;
  /** rAF rate over the same window, when `stats` come from rendered frames. */
  readonly browserFps?: number;
  /** Game-configured frame rate; a `limit` below 60 is a finding against the 60 FPS target. */
  readonly fpsCap?: FpsCap;
  readonly band: FpsBandInfo;
  readonly lowBand: FpsBandInfo;
  /** Frames over 100 ms. */
  readonly hitches: readonly WindowHitch[];
  /** Frames over two 60 Hz budgets (33.3 ms), hitches included. */
  readonly slowFrames: readonly WindowHitch[];
  readonly longTasks: { readonly count: number; readonly totalMs: number; readonly maxMs: number };
  readonly longTaskList: readonly { readonly offsetMs: number; readonly ms: number }[];
  readonly heapStartMb?: number;
  readonly heapEndMb?: number;
  readonly phaserFpsMean?: number;
  readonly activityPeak?: SceneActivity;
  /** Main-thread busy share of the game frame's renderer (CDP TaskDuration), when CPU sampling is on. */
  readonly cpuBusyPct?: number;
  /** Time inside the window that did not count (SGAP screenshots, hidden tab). */
  readonly excludedMs: number;
  readonly excludedSpans: readonly ExcludedSpan[];
  readonly events: readonly PerfEvent[];
  readonly meta?: Readonly<Record<string, unknown>>;
}

export interface CpuSample {
  readonly at: number;
  /** Cumulative main-thread task time (ms). */
  readonly taskMs: number;
  readonly scriptMs: number;
}

export interface PerfSessionOptions {
  readonly iframeSelector: string;
  readonly workerId?: number;
  /** Live badge on the launcher page (default: on unless SGAP_PERF_COUNTER=0). */
  readonly counter?: boolean;
  readonly pollMs?: number;
}

const MAX_KEPT_FRAMES = 400_000;
const COUNTER_FPS_WINDOW_MS = 1_000;
const COUNTER_LOW_WINDOW_MS = 10_000;
const HISTORY_POINTS = 60;
/** A hitch is attributed to an event at most this far away. */
const EVENT_MATCH_MS = 2_000;
/** Compositor catch-up around a capture or a tab coming back is not the game's frame time. */
const SPAN_PAD_BEFORE_MS = 50;
const SPAN_PAD_AFTER_MS = 200;
const CPU_SAMPLE_MS = 1_000;

async function gameFrame(page: Page, iframeSelector: string): Promise<Frame | null> {
  const handle = await page.locator(iframeSelector).first().elementHandle().catch(() => null);
  return handle === null ? null : handle.contentFrame();
}

function mb(bytes: number | undefined): number | undefined {
  return bytes === undefined ? undefined : round1(bytes / (1024 * 1024));
}

export class PerfSession {
  private frames: number[] = [];
  private rendered: number[] = [];
  private fpsCap: FpsCap | undefined;
  private longTasks: { at: number; ms: number }[] = [];
  private heap: { at: number; bytes: number }[] = [];
  private phaserFps: { at: number; fps: number }[] = [];
  private activity: { at: number; value: SceneActivity }[] = [];
  private readonly events: PerfEvent[] = [];
  private readonly history: number[] = [];
  private readonly frameMsHistory: (number | null)[] = [];
  private timer: NodeJS.Timeout | undefined;
  private pulling: Promise<void> | undefined;
  private frame: Frame | null = null;
  private status = '';
  private lastPost = 0;
  private counter: boolean;
  private readonly spans: ExcludedSpan[] = [];
  private hiddenSince: number | undefined;
  private cpuEnabled = false;
  private cdp: CDPSession | undefined;
  private cdpFrame: Frame | null = null;
  private cpu: CpuSample[] = [];
  private lastCpuAt = 0;
  private restoreScreenshot: (() => void) | undefined;
  private readonly onResponse = (response: Response): void => {
    const url = response.url();
    if (matchesBetOrBuyUrl(url)) {
      this.mark('bet', `${response.request().method()} ${new URL(url).pathname} → ${response.status()}`);
    } else if (url.includes(PLATFORM_ROUTES.unresolvedSpin) && response.request().method() !== 'GET') {
      this.mark(url.includes('/complete') ? 'round-complete' : 'round-progress', new URL(url).pathname);
    }
  };

  private constructor(
    private readonly page: Page,
    private readonly options: PerfSessionOptions,
  ) {
    this.counter = options.counter ?? isFpsCounterEnabled();
  }

  static async start(page: Page, options: PerfSessionOptions): Promise<PerfSession> {
    const session = new PerfSession(page, options);
    await session.ensureSampler();
    if (process.env.SGAP_PAD_LIVE_CPU === '1') {
      await session.enableCpu();
    }
    page.on('response', session.onResponse);
    session.wrapScreenshots();
    session.timer = setInterval(() => {
      void session.pull();
    }, options.pollMs ?? 500);
    return session;
  }

  /** Re-install after a reload replaced the game frame. */
  async ensureSampler(): Promise<boolean> {
    this.frame = await gameFrame(this.page, this.options.iframeSelector);
    if (this.frame === null) {
      return false;
    }
    return installSampler(this.frame);
  }

  /**
   * SGAP vision helpers (overlay dismiss, idle-HUD checks) capture the page; a capture stalls
   * the compositor, so those spans are excluded from every window instead of blamed on the game.
   */
  private wrapScreenshots(): void {
    const page = this.page as Page & { screenshot: Page['screenshot'] };
    const original = page.screenshot;
    const wrapped: Page['screenshot'] = async (options) => {
      const from = Date.now();
      try {
        return await original.call(page, options);
      } finally {
        this.exclude(from, Date.now(), 'sgap-screenshot');
      }
    };
    page.screenshot = wrapped;
    this.restoreScreenshot = () => {
      page.screenshot = original;
    };
  }

  exclude(from: number, to: number, reason: string): void {
    this.spans.push({ from: from - SPAN_PAD_BEFORE_MS, to: to + SPAN_PAD_AFTER_MS, reason });
  }

  excludedSpans(): readonly ExcludedSpan[] {
    return this.spans;
  }

  setStatus(status: string): void {
    this.status = status;
  }

  /** Samples CDP `Performance.getMetrics` on the game frame once a second. */
  async enableCpu(): Promise<boolean> {
    this.cpuEnabled = true;
    return (await this.cpuSession()) !== undefined;
  }

  private async cpuSession(): Promise<CDPSession | undefined> {
    if (this.frame === null) {
      await this.ensureSampler();
    }
    if (this.cdp !== undefined && this.cdpFrame === this.frame) {
      return this.cdp;
    }
    await this.cdp?.detach().catch(() => undefined);
    this.cdp = undefined;
    const context = this.page.context();
    // Same-process iframes have no own target; the page session covers them.
    const session =
      (this.frame === null ? undefined : await context.newCDPSession(this.frame).catch(() => undefined)) ??
      (await context.newCDPSession(this.page).catch(() => undefined));
    if (session === undefined) {
      return undefined;
    }
    await session.send('Performance.enable').catch(() => undefined);
    this.cdp = session;
    this.cdpFrame = this.frame;
    return session;
  }

  private async sampleCpu(): Promise<void> {
    const session = await this.cpuSession();
    if (session === undefined) {
      return;
    }
    const result = await session.send('Performance.getMetrics').catch(() => undefined);
    if (result === undefined) {
      this.cdp = undefined;
      return;
    }
    const metric = (name: string): number => result.metrics.find((entry) => entry.name === name)?.value ?? Number.NaN;
    this.cpu.push({ at: Date.now(), taskMs: metric('TaskDuration') * 1000, scriptMs: metric('ScriptDuration') * 1000 });
  }

  /** Busy share (%) of the game renderer's main thread between two times. */
  cpuBusyBetween(from: number, to: number): number | undefined {
    const inside = this.cpu.filter((sample) => sample.at >= from - CPU_SAMPLE_MS && sample.at <= to + CPU_SAMPLE_MS);
    const first = inside.find((sample) => sample.at >= from - CPU_SAMPLE_MS);
    const last = [...inside].reverse().find((sample) => sample.at <= to + CPU_SAMPLE_MS);
    if (first === undefined || last === undefined || last.at - first.at < 500) {
      return undefined;
    }
    return round1(((last.taskMs - first.taskMs) / (last.at - first.at)) * 100);
  }

  /** Busy % per sample interval, for "sustained" checks. */
  cpuSeries(from: number, to: number): { readonly at: number; readonly busyPct: number }[] {
    const inside = this.cpu.filter((sample) => sample.at >= from && sample.at <= to);
    const out: { at: number; busyPct: number }[] = [];
    for (let i = 1; i < inside.length; i += 1) {
      const a = inside[i - 1]!;
      const b = inside[i]!;
      if (b.at > a.at) out.push({ at: b.at, busyPct: round1(((b.taskMs - a.taskMs) / (b.at - a.at)) * 100) });
    }
    return out;
  }

  /** Forces a major GC in the game frame, then reads the JS heap (MB). */
  async heapAfterGcMb(): Promise<number | undefined> {
    const session = await this.cpuSession();
    if (session === undefined) {
      return undefined;
    }
    await session.send('HeapProfiler.collectGarbage').catch(() => undefined);
    await session.send('HeapProfiler.collectGarbage').catch(() => undefined);
    const usage = await session.send('Runtime.getHeapUsage').catch(() => undefined);
    return usage === undefined ? undefined : mb(usage.usedSize);
  }

  async usage(): Promise<{ readonly textures: readonly TextureUse[]; readonly spines: readonly SpineUse[] } | undefined> {
    if (this.frame === null) {
      await this.ensureSampler();
    }
    return this.frame === null ? undefined : readSamplerUsage(this.frame);
  }

  currentFrame(): Frame | null {
    return this.frame;
  }

  /** Scene activity samples (one per poll) in a range. */
  activityIn(from: number, to: number): readonly { readonly at: number; readonly value: SceneActivity }[] {
    return this.activity.filter((sample) => sample.at >= from && sample.at <= to);
  }

  /** Raw frame timestamps in a range (custom segmenting, e.g. per tumble); rendered when available. */
  framesIn(from: number, to: number): readonly number[] {
    return this.framesBetween(from, to);
  }

  /** rAF ticks in a range: page responsiveness, independent of the game's render cap. */
  browserFramesIn(from: number, to: number): readonly number[] {
    return this.browserFramesBetween(from, to);
  }

  /** Latest game-configured frame rate seen by the sampler. */
  currentFpsCap(): FpsCap | undefined {
    return this.fpsCap;
  }

  async setCounter(on: boolean): Promise<void> {
    this.counter = on;
    if (!on) {
      await hideFpsCounter(this.page);
    }
  }

  mark(kind: string, detail?: string): void {
    this.events.push({ at: Date.now(), kind, ...(detail !== undefined ? { detail } : {}) });
  }

  async pull(): Promise<void> {
    if (this.pulling !== undefined) {
      return this.pulling;
    }
    this.pulling = this.pullOnce().finally(() => {
      this.pulling = undefined;
    });
    return this.pulling;
  }

  private async pullOnce(): Promise<void> {
    let drain: SamplerDrain | undefined = this.frame === null ? undefined : await drainSampler(this.frame);
    if (drain === undefined) {
      if (!(await this.ensureSampler())) {
        return;
      }
      drain = this.frame === null ? undefined : await drainSampler(this.frame);
      if (drain === undefined) {
        return;
      }
    }
    this.frames.push(...drain.frames);
    if (this.frames.length > MAX_KEPT_FRAMES) {
      this.frames.splice(0, this.frames.length - MAX_KEPT_FRAMES);
    }
    if (drain.rendered !== undefined) {
      this.rendered.push(...drain.rendered);
      if (this.rendered.length > MAX_KEPT_FRAMES) {
        this.rendered.splice(0, this.rendered.length - MAX_KEPT_FRAMES);
      }
    }
    if (drain.fpsCap !== undefined) this.fpsCap = drain.fpsCap;
    this.longTasks.push(...drain.longTasks);
    if (drain.heapBytes !== undefined) this.heap.push({ at: drain.now, bytes: drain.heapBytes });
    if (drain.phaserFps !== undefined) this.phaserFps.push({ at: drain.now, fps: drain.phaserFps });
    if (drain.activity !== undefined) this.activity.push({ at: drain.now, value: drain.activity });
    for (const change of drain.visibility ?? []) {
      if (change.hidden) {
        this.hiddenSince ??= change.at;
      } else if (this.hiddenSince !== undefined) {
        this.exclude(this.hiddenSince, change.at, 'tab-hidden');
        this.hiddenSince = undefined;
      }
    }
    if (this.cpuEnabled && drain.now - this.lastCpuAt >= CPU_SAMPLE_MS) {
      this.lastCpuAt = drain.now;
      await this.sampleCpu();
    }
    await this.publishLive(drain.now);
  }

  private browserFramesBetween(from: number, to: number): number[] {
    return this.frames.filter((at) => at >= from && at <= to);
  }

  private renderedBetween(from: number, to: number): number[] {
    return this.rendered.filter((at) => at >= from && at <= to);
  }

  /** Rendered frames once the Phaser hook has fired in the range, browser frames otherwise. */
  private framesBetween(from: number, to: number): number[] {
    return this.frameSourceBetween(from, to).frames;
  }

  private frameSourceBetween(from: number, to: number): { frames: number[]; source: 'rendered' | 'browser' } {
    const hookedBefore = this.rendered.length > 0 && this.rendered[0]! <= to;
    return hookedBefore
      ? { frames: this.renderedBetween(from, to), source: 'rendered' }
      : { frames: this.browserFramesBetween(from, to), source: 'browser' };
  }

  /** FPS over the last second and 1% low over the last ten, as the counter shows them. */
  liveNumbers(now = Date.now()): { fps: number; low1: number } {
    const recent = this.framesBetween(now - COUNTER_FPS_WINDOW_MS, now);
    const longer = this.framesBetween(now - COUNTER_LOW_WINDOW_MS, now);
    return { fps: frameStats(recent, this.spans).avgFps, low1: frameStats(longer, this.spans).low1Fps };
  }

  private async publishLive(now: number): Promise<void> {
    const { fps, low1 } = this.liveNumbers(now);
    const band = fpsBand(fps);
    if (this.counter) {
      await showFpsCounter(this.page, {
        fps,
        low1,
        color: band.color,
        band: band.label,
        status: this.status,
      });
    }
    if (now - this.lastPost < 1_000) {
      return;
    }
    this.lastPost = now;
    const second = this.frameSourceBetween(now - COUNTER_FPS_WINDOW_MS, now);
    const secondStats = frameStats(second.frames, this.spans);
    if (Number.isFinite(fps) && second.frames.length >= 2) {
      this.history.push(Math.round(fps));
      if (this.history.length > HISTORY_POINTS) this.history.shift();
    }
    this.frameMsHistory.push(Number.isFinite(secondStats.maxMs) ? round1(secondStats.maxMs) : null);
    if (this.frameMsHistory.length > HISTORY_POINTS) this.frameMsHistory.shift();
    const base = process.env.SGAP_MONITOR_URL;
    const workerId = this.options.workerId;
    if (base === undefined || base.length === 0 || workerId === undefined) {
      return;
    }
    const browserFps = frameStats(this.browserFramesBetween(now - COUNTER_FPS_WINDOW_MS, now), this.spans).avgFps;
    const cpu = this.cpuSeries(now - 3 * CPU_SAMPLE_MS, now).at(-1)?.busyPct;
    const heap = this.heap.at(-1);
    const finite = (value: number): number | undefined => (Number.isFinite(value) ? round1(value) : undefined);
    await fetch(`${base.replace(/\/$/, '')}/api/event`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'perf',
        id: workerId,
        perf: {
          // Fewer than two frames in the last second means nothing was sampled (collector paused, tab hidden), not 0 FPS.
          fps: second.frames.length < 2 ? null : round1(fps),
          low1: round1(low1),
          band: band.label,
          color: band.color,
          status: this.status,
          history: [...this.history],
          at: now,
          source: second.source,
          browserFps: finite(browserFps),
          frameP95Ms: finite(secondStats.p95Ms),
          frameMaxMs: finite(secondStats.maxMs),
          frameMsHistory: [...this.frameMsHistory],
          ...(cpu !== undefined ? { cpuBusyPct: cpu } : {}),
          ...(heap !== undefined && now - heap.at < 5_000 ? { heapMb: mb(heap.bytes) } : {}),
          ...(this.fpsCap !== undefined ? { fpsCap: this.fpsCap } : {}),
        },
      }),
    }).catch(() => undefined);
  }

  /** Start of a measurement window. */
  begin(label: string): { readonly label: string; readonly startedAt: number } {
    this.mark('window-start', label);
    return { label, startedAt: Date.now() };
  }

  async end(
    token: { readonly label: string; readonly startedAt: number },
    meta?: Readonly<Record<string, unknown>>,
  ): Promise<PerfWindow> {
    await new Promise((resolve) => setTimeout(resolve, 120));
    await this.pull();
    const endedAt = Date.now();
    this.mark('window-end', token.label);
    return this.windowBetween(token.label, token.startedAt, endedAt, meta);
  }

  windowBetween(
    label: string,
    startedAt: number,
    endedAt: number,
    meta?: Readonly<Record<string, unknown>>,
  ): PerfWindow {
    const { frames, source } = this.frameSourceBetween(startedAt, endedAt);
    const open: ExcludedSpan[] =
      this.hiddenSince === undefined ? [] : [{ from: this.hiddenSince, to: endedAt, reason: 'tab-hidden' }];
    const excluded = [...this.spans, ...open].filter((span) => span.from < endedAt && span.to > startedAt);
    const excludedMs = excluded.reduce(
      (sum, span) => sum + Math.max(0, Math.min(span.to, endedAt) - Math.max(span.from, startedAt)),
      0,
    );
    const stats = frameStats(frames, excluded);
    const events = this.events.filter((event) => event.at >= startedAt - EVENT_MATCH_MS && event.at <= endedAt);
    const activity = this.activity.filter((sample) => sample.at >= startedAt && sample.at <= endedAt);
    const tag = (hitch: { readonly at: number; readonly ms: number }): WindowHitch => {
      const nearest = events
        .filter((event) => !event.kind.startsWith('window-'))
        .map((event) => ({ event, deltaMs: Math.abs(event.at - hitch.at) }))
        .sort((a, b) => a.deltaMs - b.deltaMs)[0];
      const sample = activity
        .map((entry) => ({ entry, deltaMs: Math.abs(entry.at - hitch.at) }))
        .sort((a, b) => a.deltaMs - b.deltaMs)[0];
      return {
        at: hitch.at,
        offsetMs: Math.round(hitch.at - startedAt),
        ms: round1(hitch.ms),
        ...(sample !== undefined && sample.deltaMs <= 1_000 ? { activity: sample.entry.value } : {}),
        ...(nearest !== undefined && nearest.deltaMs <= EVENT_MATCH_MS
          ? {
              nearest: {
                kind: nearest.event.kind,
                ...(nearest.event.detail !== undefined ? { detail: nearest.event.detail } : {}),
                deltaMs: Math.round(nearest.event.at - hitch.at),
              },
            }
          : {}),
      };
    };
    const slow = slowFrames(frames, LONG_FRAME_MS, excluded).map(tag);
    const hitches = slow.filter((frame) => frame.ms > HITCH_MS);
    const tasks = this.longTasks.filter((task) => task.at >= startedAt && task.at <= endedAt);
    const heap = this.heap.filter((sample) => sample.at >= startedAt - 1_000 && sample.at <= endedAt + 1_000);
    const phaser = this.phaserFps.filter((sample) => sample.at >= startedAt && sample.at <= endedAt);
    const peak = activity.reduce<SceneActivity | undefined>((best, sample) => {
      if (best === undefined) return sample.value;
      return {
        tweens: Math.max(best.tweens, sample.value.tweens),
        timers: Math.max(best.timers, sample.value.timers),
        objects: Math.max(best.objects, sample.value.objects),
        particles: Math.max(best.particles, sample.value.particles),
        scenes: Math.max(best.scenes, sample.value.scenes),
        spines: Math.max(best.spines ?? 0, sample.value.spines ?? 0),
      };
    }, undefined);
    const cpuBusyPct = this.cpuEnabled ? this.cpuBusyBetween(startedAt, endedAt) : undefined;
    const browserFps =
      source === 'rendered' ? round1(frameStats(this.browserFramesBetween(startedAt, endedAt), excluded).avgFps) : undefined;
    return {
      label,
      startedAt,
      endedAt,
      frameSource: source,
      ...(browserFps !== undefined && Number.isFinite(browserFps) ? { browserFps } : {}),
      ...(this.fpsCap !== undefined ? { fpsCap: this.fpsCap } : {}),
      stats: {
        ...stats,
        avgFps: round1(stats.avgFps),
        low1Fps: round1(stats.low1Fps),
        p50Ms: round1(stats.p50Ms),
        p95Ms: round1(stats.p95Ms),
        p99Ms: round1(stats.p99Ms),
        maxMs: round1(stats.maxMs),
      },
      band: fpsBand(stats.avgFps),
      lowBand: fpsBand(stats.low1Fps),
      hitches,
      slowFrames: slow,
      longTasks: {
        count: tasks.length,
        totalMs: round1(tasks.reduce((sum, task) => sum + task.ms, 0)),
        maxMs: round1(tasks.reduce((max, task) => Math.max(max, task.ms), 0)),
      },
      longTaskList: tasks.map((task) => ({ offsetMs: Math.round(task.at - startedAt), ms: round1(task.ms) })),
      ...(heap.length > 0
        ? { heapStartMb: mb(heap[0]!.bytes), heapEndMb: mb(heap[heap.length - 1]!.bytes) }
        : {}),
      ...(phaser.length > 0
        ? { phaserFpsMean: round1(phaser.reduce((sum, sample) => sum + sample.fps, 0) / phaser.length) }
        : {}),
      ...(peak !== undefined ? { activityPeak: peak } : {}),
      ...(cpuBusyPct !== undefined ? { cpuBusyPct } : {}),
      excludedMs: Math.round(excludedMs),
      excludedSpans: excluded,
      events: events.filter((event) => event.at >= startedAt && event.at <= endedAt),
      ...(meta !== undefined ? { meta } : {}),
    };
  }

  /** Latest scene activity (running tweens etc.), pulled now. */
  async currentActivity(): Promise<SceneActivity | undefined> {
    await this.pull();
    return this.activity[this.activity.length - 1]?.value;
  }

  /** Phaser's own smoothed FPS, read directly (works while the sampler is paused). */
  async phaserFpsNow(): Promise<number | undefined> {
    if (this.frame === null) {
      await this.ensureSampler();
    }
    return this.frame === null ? undefined : readPhaserFps(this.frame);
  }

  /** Stops the rAF loop in the game frame (PAD-042 "collector off" phase). */
  async pauseSampler(): Promise<void> {
    if (this.frame !== null) {
      await pauseSampler(this.frame);
    }
  }

  async resumeSampler(): Promise<void> {
    await this.ensureSampler();
  }

  async stop(): Promise<void> {
    if (this.timer !== undefined) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    this.page.off('response', this.onResponse);
    this.restoreScreenshot?.();
    await this.pulling;
    await this.cdp?.detach().catch(() => undefined);
    this.cdp = undefined;
    if (this.frame !== null) {
      await pauseSampler(this.frame);
    }
    await hideFpsCounter(this.page);
  }

  allEvents(): readonly PerfEvent[] {
    return this.events;
  }
}
