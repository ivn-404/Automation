/**
 * Interaction journal — every game input with the locator strategy that chose its
 * point, whether that was a fallback (self-healing), and how much to trust it.
 *
 * Recorded per page by the driver; drained into the report after each test, so a
 * pass that needed healing is visible as such instead of looking identical to a
 * clean pass.
 */

import type { Page } from 'playwright';

/**
 * - phaser:    the game's own scene graph named the control
 * - dom:       a DOM locator inside the iframe
 * - vision:    colour-blob match against the surface profile
 * - manifest:  the pinned ratio from config/manifests
 * - candidate: one of the surface profile's ordered fallback points
 * - point:     an explicit ratio from calling code (dialog centre, overlay tap)
 */
export type LocatorStrategy = 'phaser' | 'dom' | 'vision' | 'manifest' | 'candidate' | 'point';

export type LocatorConfidence = 'high' | 'medium' | 'low';

export interface InteractionEntry {
  readonly at: string;
  readonly action: string;
  readonly strategy: LocatorStrategy;
  readonly confidence: LocatorConfidence;
  /** True when the primary strategy for this action was not the one used. */
  readonly fallback: boolean;
  readonly point?: { readonly x: number; readonly y: number };
  readonly detail?: string;
}

export interface InteractionSummary {
  readonly total: number;
  readonly byStrategy: Readonly<Partial<Record<LocatorStrategy, number>>>;
  readonly fallbacks: number;
  readonly lowestConfidence: LocatorConfidence | undefined;
}

const CONFIDENCE: Readonly<Record<LocatorStrategy, LocatorConfidence>> = {
  phaser: 'high',
  dom: 'high',
  vision: 'medium',
  manifest: 'medium',
  candidate: 'low',
  point: 'low',
};

const RANK: Readonly<Record<LocatorConfidence, number>> = { high: 2, medium: 1, low: 0 };

const journals = new WeakMap<Page, InteractionEntry[]>();

export type InteractionListener = (entry: InteractionEntry) => void;

const listeners = new WeakMap<Page, Set<InteractionListener>>();

export function confidenceFor(strategy: LocatorStrategy): LocatorConfidence {
  return CONFIDENCE[strategy];
}

/** Observe inputs on a page as they are recorded. Returns the unsubscribe function. */
export function onInteraction(page: Page, listener: InteractionListener): () => void {
  const set = listeners.get(page) ?? new Set<InteractionListener>();
  set.add(listener);
  listeners.set(page, set);
  return () => {
    set.delete(listener);
  };
}

export function recordInteraction(
  page: Page,
  entry: Omit<InteractionEntry, 'at' | 'confidence'> & { readonly confidence?: LocatorConfidence },
): void {
  const list = journals.get(page) ?? [];
  const recorded: InteractionEntry = {
    ...entry,
    at: new Date().toISOString(),
    confidence: entry.confidence ?? confidenceFor(entry.strategy),
  };
  list.push(recorded);
  journals.set(page, list);
  for (const listener of listeners.get(page) ?? []) {
    try {
      listener(recorded);
    } catch {
      // A broken observer must never break an input.
    }
  }
}

/** Return and clear everything recorded on this page. */
export function takeInteractions(page: Page): InteractionEntry[] {
  const list = journals.get(page) ?? [];
  journals.delete(page);
  return list;
}

export function summarizeInteractions(entries: readonly InteractionEntry[]): InteractionSummary {
  const byStrategy: Partial<Record<LocatorStrategy, number>> = {};
  let lowest: LocatorConfidence | undefined;
  for (const entry of entries) {
    byStrategy[entry.strategy] = (byStrategy[entry.strategy] ?? 0) + 1;
    if (lowest === undefined || RANK[entry.confidence] < RANK[lowest]) {
      lowest = entry.confidence;
    }
  }
  return {
    total: entries.length,
    byStrategy,
    fallbacks: entries.filter((entry) => entry.fallback).length,
    lowestConfidence: lowest,
  };
}

/** One line per input, for a text attachment a reviewer can scan. */
export function formatInteractions(entries: readonly InteractionEntry[]): string {
  return entries
    .map((entry) => {
      const point = entry.point === undefined ? '' : ` @${entry.point.x.toFixed(3)},${entry.point.y.toFixed(3)}`;
      const flag = entry.fallback ? ' FALLBACK' : '';
      const detail = entry.detail === undefined ? '' : ` — ${entry.detail}`;
      return `${entry.at.slice(11, 23)} ${entry.action.padEnd(18)} ${entry.strategy.padEnd(9)} ${entry.confidence.padEnd(6)}${flag}${point}${detail}`;
    })
    .join('\n');
}
