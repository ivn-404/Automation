/**
 * Non-invasive browser diagnostics for a game that may not be mapped yet: load timing, idle
 * frame timing (the PAD sampler, rendered frames when Phaser exposes them), browser resource
 * consumption (Chrome performance metrics) and the resource timing summary. Reads only.
 */

import type { Frame, Page } from 'playwright';

import { frameStats, round1 } from '../perf/frame-metrics.js';
import { drainSampler, installSampler } from '../perf/frame-sampler.js';

export interface IdleDiagnostics {
  readonly windowMs: number;
  readonly frameSource: 'rendered' | 'browser' | 'none';
  readonly avgFps?: number;
  readonly low1Fps?: number;
  readonly p95Ms?: number;
  readonly maxMs?: number;
  readonly longFrames?: number;
  readonly hitches?: number;
  readonly longTasks: number;
  readonly longTaskMs: number;
  readonly fpsCap?: { readonly target?: number; readonly limit?: number };
  readonly findings: readonly string[];
}

export interface LoadDiagnostics {
  readonly ttfbMs?: number;
  readonly domContentLoadedMs?: number;
  readonly loadMs?: number;
  readonly resources: number;
  readonly transferKb: number;
  readonly byType: Readonly<Record<string, number>>;
}

export async function idleFrameTiming(frame: Frame, windowMs: number): Promise<IdleDiagnostics> {
  if (!(await installSampler(frame))) {
    return { windowMs, frameSource: 'none', longTasks: 0, longTaskMs: 0, findings: ['frame sampler could not be installed in the game frame'] };
  }
  await frame.page().waitForTimeout(1_000);
  await drainSampler(frame);
  const rendered: number[] = [];
  const browser: number[] = [];
  const longTasks: Array<{ ms: number }> = [];
  let fpsCap: IdleDiagnostics['fpsCap'];
  const end = Date.now() + windowMs;
  while (Date.now() < end) {
    await frame.page().waitForTimeout(500);
    const drain = await drainSampler(frame);
    if (drain === undefined) continue;
    browser.push(...drain.frames);
    if (drain.rendered) rendered.push(...drain.rendered);
    longTasks.push(...drain.longTasks);
    fpsCap ??= drain.fpsCap;
  }
  const source = rendered.length > 1 ? 'rendered' : browser.length > 1 ? 'browser' : 'none';
  const stats = source === 'none' ? undefined : frameStats(source === 'rendered' ? rendered : browser);
  const findings: string[] = [];
  if (fpsCap?.limit !== undefined && fpsCap.limit < 60) findings.push(`game caps rendering at ${fpsCap.limit} FPS (fps.limit)`);
  if (stats !== undefined && stats.avgFps < 50) findings.push(`idle ${source} FPS ${round1(stats.avgFps)} is below 50`);
  if (source === 'browser') findings.push('Phaser postrender not exposed: browser frames (rAF) measured, not rendered frames');
  return {
    windowMs,
    frameSource: source,
    ...(stats !== undefined
      ? { avgFps: round1(stats.avgFps), low1Fps: round1(stats.low1Fps), p95Ms: round1(stats.p95Ms), maxMs: round1(stats.maxMs), longFrames: stats.longFrames, hitches: stats.hitches }
      : {}),
    longTasks: longTasks.length,
    longTaskMs: Math.round(longTasks.reduce((sum, task) => sum + task.ms, 0)),
    ...(fpsCap !== undefined ? { fpsCap } : {}),
    findings,
  };
}

export async function loadTiming(frame: Frame): Promise<LoadDiagnostics> {
  return frame
    .evaluate(() => {
      const timing = performance as unknown as { getEntriesByType(type: string): any[] };
      const nav = timing.getEntriesByType('navigation')[0];
      const resources = timing.getEntriesByType('resource');
      const byType: Record<string, number> = {};
      let transfer = 0;
      for (const entry of resources) {
        byType[entry.initiatorType] = (byType[entry.initiatorType] ?? 0) + 1;
        transfer += entry.transferSize || 0;
      }
      return {
        ttfbMs: nav ? Math.round(nav.responseStart) : undefined,
        domContentLoadedMs: nav ? Math.round(nav.domContentLoadedEventEnd) : undefined,
        loadMs: nav ? Math.round(nav.loadEventEnd) : undefined,
        resources: resources.length,
        transferKb: Math.round(transfer / 1024),
        byType,
      };
    })
    .catch(() => ({ resources: 0, transferKb: 0, byType: {} }));
}

const METRICS = ['JSHeapUsedSize', 'JSHeapTotalSize', 'Nodes', 'Documents', 'Frames', 'JSEventListeners', 'LayoutCount', 'RecalcStyleCount', 'TaskDuration', 'ScriptDuration'];

/**
 * Starts Chrome's Performance domain for the page (all frames); the returned reader gives the
 * metrics accumulated since then (durations in s, sizes in MB). Undefined on other browsers.
 */
export async function browserMetrics(page: Page): Promise<(() => Promise<Record<string, number> | undefined>) | undefined> {
  try {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Performance.enable');
    return async () => {
      try {
        const { metrics } = (await cdp.send('Performance.getMetrics')) as { metrics: Array<{ name: string; value: number }> };
        const out: Record<string, number> = {};
        for (const metric of metrics) {
          if (!METRICS.includes(metric.name)) continue;
          out[metric.name] = metric.name.endsWith('Size') ? Math.round(metric.value / 1024 / 1024) : Math.round(metric.value * 1000) / 1000;
        }
        return out;
      } catch {
        return undefined;
      } finally {
        await cdp.detach().catch(() => undefined);
      }
    };
  } catch {
    return undefined;
  }
}
