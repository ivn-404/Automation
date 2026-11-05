/**
 * Hand-off between PAD-056 (measuring lane) and BUSY-056 (load lane on the other monitor) through
 * files in the run's results folder: the measuring lane requests load, the busy lane answers with
 * a heartbeat while it spins, and `done` releases it at the end.
 */

import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { resultsRoot } from '../../src/shared/run-paths.js';

function dir(): string {
  const value = path.join(resultsRoot(), 'pad-busy');
  mkdirSync(value, { recursive: true });
  return value;
}

function readAt(name: string): number | undefined {
  try {
    const at = Number((JSON.parse(readFileSync(path.join(dir(), name), 'utf8')) as { at?: unknown }).at);
    return Number.isFinite(at) ? at : undefined;
  } catch {
    return undefined;
  }
}

function writeAt(name: string, at: number): void {
  writeFileSync(path.join(dir(), name), JSON.stringify({ at }));
}

/** Ask the busy lane to spin until `until` (epoch ms) or until the request is cleared. */
export function requestBusy(until: number): void {
  writeAt('request.json', until);
}

export function clearBusyRequest(): void {
  rmSync(path.join(dir(), 'request.json'), { force: true });
}

export function busyRequested(now = Date.now()): boolean {
  const until = readAt('request.json');
  return until !== undefined && until > now;
}

export function busyHeartbeat(): void {
  writeAt('heartbeat.json', Date.now());
}

/** True when the busy lane reported spinning within `maxAgeMs`. */
export function busyLaneActive(maxAgeMs: number): boolean {
  const at = readAt('heartbeat.json');
  return at !== undefined && Date.now() - at <= maxAgeMs;
}

export function markBusyDone(): void {
  writeAt('done.json', Date.now());
}

/** Done only counts when written after `since`, so a previous run's file is ignored. */
export function busyDone(since: number): boolean {
  const at = readAt('done.json');
  return at !== undefined && at >= since;
}
