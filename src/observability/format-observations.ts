/**
 * Plain-text views of an observation stream for report attachments: a merged
 * timeline (problems marked) and the balance timeline.
 */

import type { BalanceObservation, Observation } from './types.js';

const PERSISTED_WS_PREVIEW = 300;

function clock(at: number): string {
  return new Date(at).toISOString().slice(11, 23);
}

function mark(observation: Observation): string {
  return observation.severity === 'error' ? '!!' : observation.severity === 'warn' ? ' !' : '  ';
}

function kindLabel(observation: Observation): string {
  return observation.kind === 'event' ? 'event' : observation.kind === 'websocket' ? 'ws' : observation.kind;
}

/** One line per observation; pings and plain console.log noise are left out. */
export function formatObservationTimeline(observations: readonly Observation[]): string {
  return observations
    .filter((entry) => !(entry.kind === 'console' && entry.severity === 'info'))
    .map((entry) => `${clock(entry.at)} ${mark(entry)} #${String(entry.seq).padStart(4)} ${kindLabel(entry).padEnd(8)} ${entry.summary}`)
    .join('\n');
}

function money(value: number | undefined): string {
  return value === undefined ? '—' : value.toFixed(2);
}

/** Timestamp → HUD → server → host → difference → trigger / related entry. */
export function formatBalanceTimeline(observations: readonly Observation[]): string {
  const bySeq = new Map(observations.map((entry) => [entry.seq, entry]));
  const header = `${'time'.padEnd(12)}  ${'HUD'.padStart(10)}  ${'server'.padStart(10)}  ${'host'.padStart(10)}  ${'Δ hud-srv'.padStart(9)}  trigger / related`;
  const rows = observations
    .filter((entry): entry is BalanceObservation => entry.kind === 'balance')
    .map((entry) => {
      const related = entry.relatedSeq === undefined ? undefined : bySeq.get(entry.relatedSeq);
      const relatedText = related === undefined ? '' : ` ← #${related.seq} ${related.summary}`;
      const diff = entry.diff === undefined ? '—' : entry.diff === 0 ? '0' : entry.diff.toFixed(2);
      return `${clock(entry.at)}  ${money(entry.hud).padStart(10)}  ${money(entry.server).padStart(10)}  ${money(entry.host).padStart(10)}  ${diff.padStart(9)}  ${entry.trigger}${relatedText}`;
    });
  return [header, ...rows].join('\n');
}

/** Counts a reviewer reads first: failed requests, console errors, ws problems. */
export function summarizeObservations(observations: readonly Observation[]): Record<string, number> {
  const count = (predicate: (entry: Observation) => boolean): number => observations.filter(predicate).length;
  return {
    total: observations.length,
    network: count((entry) => entry.kind === 'network'),
    failedRequests: count((entry) => entry.kind === 'network' && entry.severity !== 'info'),
    injectedResponses: count((entry) => entry.kind === 'network' && entry.injected),
    consoleErrors: count((entry) => entry.kind === 'console' && entry.severity === 'error'),
    consoleWarnings: count((entry) => entry.kind === 'console' && entry.severity === 'warn'),
    websocketFrames: count((entry) => entry.kind === 'websocket' && (entry.event === 'sent' || entry.event === 'received')),
    websocketProblems: count((entry) => entry.kind === 'websocket' && entry.severity !== 'info'),
    events: count((entry) => entry.kind === 'event'),
    balanceMismatches: count((entry) => entry.kind === 'balance' && entry.diff !== undefined && entry.diff !== 0),
  };
}

/**
 * Copy safe to persist: websocket payloads shrink to short redacted previews
 * (no full socket dumps on disk); everything else is already redacted.
 */
export function persistableObservations(observations: readonly Observation[]): Observation[] {
  return observations.map((entry) => {
    if (entry.kind !== 'websocket' || entry.payload === undefined) {
      return entry;
    }
    const text = typeof entry.payload === 'string' ? entry.payload : JSON.stringify(entry.payload);
    return {
      ...entry,
      payload: text.length > PERSISTED_WS_PREVIEW ? `${text.slice(0, PERSISTED_WS_PREVIEW)}…` : text,
    };
  });
}
