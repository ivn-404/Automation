/**
 * Observes the bet/spin network response (Playwright waitForResponse).
 * Controllers execute spin; this data source supplies ground truth for verification.
 */

import type { Page, Request, Response } from 'playwright';

import type { IBetResponseDataSource } from '../core/contracts/index.js';
import type { BetResponseSnapshot, NetworkConfig, ObservableWaitOptions } from '../core/models/index.js';
import { parseBetResponseBody } from '../data/parse-bet-response.js';
import {
  parseEnhancedBetFromBetRequest,
  parseStakeFromBetRequest,
} from '../data/parse-balance.js';
import { resolveTimeoutMs } from '../driver/wait-options.js';
import { matchesBetUrl, matchesBuyUrl, matchesUrlPattern } from './bet-url.js';

/** Re-exported so existing importers keep one obvious place to look. */
export { matchesUrlPattern };

export interface BetResponseWatcherOptions {
  readonly page: Page;
  readonly network: NetworkConfig;
  readonly defaultTimeoutMs?: number;
}

/**
 * Arms a waiter before spin, then resolves when the bet URL responds.
 */
export class BetResponseWatcher implements IBetResponseDataSource {
  readonly kind = 'betResponse' as const;
  private readonly page: Page;
  private readonly network: NetworkConfig;
  private readonly defaultTimeoutMs: number;
  private pending: Promise<Response> | undefined;
  private lastSnapshot: BetResponseSnapshot | undefined;

  constructor(options: BetResponseWatcherOptions) {
    this.page = options.page;
    this.network = options.network;
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? 30_000;
  }

  /** Drop a stale arm waiter before retrying spin (avoids orphaned timeouts). */
  reset(): void {
    this.pending = undefined;
  }

  /** Call before spin so the response is not missed. */
  arm(options?: ObservableWaitOptions): void {
    const timeout = resolveTimeoutMs(options, this.defaultTimeoutMs);
    this.pending = this.page.waitForResponse(
      (response) => {
        if (!response.ok()) {
          return false;
        }
        const url = response.url();
        return (
          matchesUrlPattern(url, this.network.betUrlPattern) ||
          matchesBetUrl(url)
        );
      },
      { timeout },
    );
  }

  async read(options?: ObservableWaitOptions): Promise<BetResponseSnapshot> {
    if (this.pending === undefined) {
      this.arm(options);
    }

    const response = await this.pending!;
    this.pending = undefined;

    const body: unknown = await response.json();
    const snapshot = parseBetResponseBody(body, this.network.fields);

    let stakeAmount: string | undefined;
    let isEnhancedBet: boolean | undefined;
    let betRequest: Record<string, unknown> | undefined;
    try {
      const postData = response.request().postData();
      if (postData) {
        const requestBody = JSON.parse(postData) as unknown;
        if (requestBody !== null && typeof requestBody === 'object' && !Array.isArray(requestBody)) {
          betRequest = requestBody as Record<string, unknown>;
        }
        stakeAmount = parseStakeFromBetRequest(requestBody);
        isEnhancedBet = parseEnhancedBetFromBetRequest(requestBody);
      }
    } catch {
      stakeAmount = undefined;
      isEnhancedBet = undefined;
    }

    this.lastSnapshot = {
      ...snapshot,
      ...(stakeAmount !== undefined && snapshot.bet === undefined
        ? { bet: { amount: stakeAmount, raw: stakeAmount } }
        : {}),
      ...(isEnhancedBet !== undefined ? { isEnhancedBet } : {}),
      ...(betRequest !== undefined ? { betRequest } : {}),
    };
    return this.lastSnapshot;
  }

  getLast(): BetResponseSnapshot | undefined {
    return this.lastSnapshot;
  }
}

/** True for a buy-feature purchase, not a normal /bet spin. */
export function isBuyPurchaseResponse(response: Response): boolean {
  return response.ok() && isBuyPurchaseRequest(response.request());
}

/** True when the request is a buy-feature purchase attempt, whatever the server answered. */
export function isBuyPurchaseRequest(request: Request): boolean {
  const url = request.url();
  if (matchesBuyUrl(url)) {
    return true;
  }
  if (!matchesBetUrl(url)) {
    return false;
  }
  try {
    const body = request.postDataJSON() as {
      action?: string;
      buyFeat?: number;
    } | null;
    if (body === null) {
      return false;
    }
    if (body.action === 'buy') {
      return true;
    }
    return Number(body.buyFeat) > 0;
  } catch {
    return false;
  }
}
