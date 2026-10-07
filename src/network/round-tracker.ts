/**
 * Knows, from network traffic alone, whether the game is still playing out a round.
 *
 * A feature round (free spins, buy) answers its /bet with an `unresolvedSpin` id,
 * reports progress with `PATCH /api/v1/unresolved-spin/<id>` and ends with
 * `PATCH /api/v1/unresolved-spin/<id>/complete`. Until then the game ignores spin
 * taps, so "is the HUD idle?" has an observable answer that no screenshot gives.
 * Plain spins carry no id and never open a round.
 */

import type { Page, Response } from 'playwright';

import type { GameManifest, NetworkConfig } from '../core/models/index.js';
import { getByPath } from '../shared/json-path.js';
import { matchesBetOrBuyUrl, matchesInitializeUrl, PLATFORM_ROUTES } from './bet-url.js';

const DEFAULT_ID_PATH = 'unresolvedSpin';
const ROUND_URL = new RegExp(
  `${PLATFORM_ROUTES.unresolvedSpin.replace(/[.*+?^${}()|[\]\\/]/gu, '\\$&')}([^/?#]+)(/complete)?(?:[?#]|$)`,
  'u',
);

export interface OpenRound {
  readonly id: string;
  readonly openedAt: number;
  readonly lastProgressAt: number;
  readonly progressCount: number;
}

export type RoundWaitOutcome = 'none' | 'resolved' | 'stalled' | 'timeout';

export interface RoundWaitResult {
  readonly outcome: RoundWaitOutcome;
  readonly waitedMs: number;
  readonly round?: OpenRound;
}

export interface RoundWaitOptions {
  /** Hard cap on the whole wait. */
  readonly timeoutMs?: number;
  /** Give up once the game has sent no progress for this long (it may be waiting for input). */
  readonly stallMs?: number;
}

export class RoundTracker {
  private readonly rounds = new Map<string, OpenRound>();
  private readonly idPath: string;
  private readonly handler = (response: Response): void => {
    this.onResponse(response);
  };

  constructor(
    private readonly page: Page,
    private readonly network: NetworkConfig | undefined,
  ) {
    this.idPath = network?.fields.unresolvedSpin ?? DEFAULT_ID_PATH;
    page.on('response', this.handler);
  }

  /** The most recently opened round still waiting for `/complete`. */
  open(): OpenRound | undefined {
    let latest: OpenRound | undefined;
    for (const round of this.rounds.values()) {
      if (latest === undefined || round.openedAt > latest.openedAt) {
        latest = round;
      }
    }
    return latest;
  }

  async waitForResolved(options: RoundWaitOptions = {}): Promise<RoundWaitResult> {
    const timeoutMs = options.timeoutMs ?? 180_000;
    // Big-win celebrations on staging leave up to ~27 s between progress updates.
    const stallMs = options.stallMs ?? 45_000;
    const started = Date.now();
    const first = this.open();
    if (first === undefined) {
      return { outcome: 'none', waitedMs: 0 };
    }
    for (;;) {
      const round = this.open();
      const now = Date.now();
      if (round === undefined) {
        return { outcome: 'resolved', waitedMs: now - started, round: first };
      }
      if (now - started >= timeoutMs) {
        return { outcome: 'timeout', waitedMs: now - started, round };
      }
      if (now - round.lastProgressAt >= stallMs) {
        return { outcome: 'stalled', waitedMs: now - started, round };
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }

  stop(): void {
    this.page.off('response', this.handler);
  }

  private onResponse(response: Response): void {
    if (!response.ok()) {
      return;
    }
    const url = response.url();
    const match = ROUND_URL.exec(url);
    if (match?.[1] !== undefined) {
      if (match[2] !== undefined) {
        this.rounds.delete(match[1]);
      } else {
        this.progress(match[1]);
      }
      return;
    }
    const initialize = matchesInitializeUrl(url, this.network);
    if (!initialize && !matchesBetOrBuyUrl(url, this.network)) {
      return;
    }
    void response
      .json()
      .then((body: unknown) => {
        const id = getByPath(body, this.idPath);
        // A fresh load or an accepted plain spin means no earlier round is still playing.
        if (initialize || typeof id !== 'string' || id.length === 0) {
          this.rounds.clear();
        }
        if (typeof id === 'string' && id.length > 0 && !this.rounds.has(id)) {
          const now = Date.now();
          this.rounds.set(id, { id, openedAt: now, lastProgressAt: now, progressCount: 0 });
        }
      })
      .catch(() => undefined);
  }

  private progress(id: string): void {
    const now = Date.now();
    const known = this.rounds.get(id);
    this.rounds.set(id, {
      id,
      openedAt: known?.openedAt ?? now,
      lastProgressAt: now,
      progressCount: (known?.progressCount ?? 0) + 1,
    });
  }
}

const trackers = new WeakMap<Page, RoundTracker>();

/** Start tracking rounds on a page, once. */
export function trackRounds(page: Page, manifest?: GameManifest): RoundTracker {
  const existing = trackers.get(page);
  if (existing !== undefined) {
    return existing;
  }
  const tracker = new RoundTracker(page, manifest?.network);
  trackers.set(page, tracker);
  return tracker;
}

export function roundTrackerFor(page: Page): RoundTracker | undefined {
  return trackers.get(page);
}

/** Drop the page's tracker (end of test). */
export function untrackRounds(page: Page): void {
  trackers.get(page)?.stop();
  trackers.delete(page);
}

export function describeRound(round: OpenRound, now = Date.now()): string {
  const age = ((now - round.openedAt) / 1000).toFixed(0);
  const quiet = ((now - round.lastProgressAt) / 1000).toFixed(0);
  return `unresolved spin ${round.id.slice(0, 8)} open ${age}s, ${round.progressCount} progress update(s), last ${quiet}s ago`;
}
