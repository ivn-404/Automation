/**
 * Observes the scratch-card hub websocket (SignalR JSON protocol).
 * The game invokes StartRound (buy card) and Cashout (card fully scratched);
 * the hub's completion frames carry the round and card — ground truth for verification.
 *
 * Must be started before the game iframe loads: the hub connects once, on game start.
 */

import type { Page, WebSocket } from 'playwright';

import { matchesUrlPattern } from './bet-response-watcher.js';

const RECORD_SEPARATOR = '\u001e';

export interface ScratchCardCell {
  readonly index: number;
  readonly symbol: string;
}

export interface ScratchCardSnapshot {
  readonly tier: string;
  readonly gridDimension: number;
  readonly matchCount: number;
  readonly cells: readonly ScratchCardCell[];
  readonly isWin: boolean;
  readonly winAmount: number;
  readonly winMultiplier: number;
}

export interface ScratchPayTableEntry {
  readonly tier: string;
  readonly symbol: string;
  readonly multiplier: number;
}

export interface ScratchRoundSnapshot {
  readonly target: string;
  readonly message: string;
  readonly errorCode: string | null;
  /** Hub round status: 1 = card bought (in play), 2 = settled. */
  readonly status: number;
  readonly betAmount: number;
  readonly winAmount: number;
  readonly balance?: number;
  readonly card?: ScratchCardSnapshot;
  readonly payTable: readonly ScratchPayTableEntry[];
  /** Arguments the game sent with the invocation (StartRound: [bet, gridIndex]). */
  readonly requestArgs: readonly unknown[];
  readonly raw: unknown;
}

interface HubInvocation {
  readonly socketId: number;
  readonly target: string;
  readonly invocationId: string;
  readonly args: readonly unknown[];
  readonly at: number;
}

interface HubCompletion {
  readonly socketId: number;
  readonly invocationId: string;
  readonly result?: unknown;
  readonly error?: string;
}

/**
 * The hub answered with a server-side error. This is a backend failure, not a
 * click or timing problem, so callers must fail the case instead of retrying.
 */
export class ScratchHubServerError extends Error {
  readonly target: string;
  readonly serverMessage: string;

  constructor(target: string, serverMessage: string) {
    super(`SERVER: scratch hub rejected ${target}: "${serverMessage}" (backend failure, not retried)`);
    this.name = 'ScratchHubServerError';
    this.target = target;
    this.serverMessage = serverMessage;
  }
}

export interface ScratchHubWatcherOptions {
  readonly page: Page;
  readonly hubUrlPattern: string;
}

export class ScratchHubWatcher {
  private readonly page: Page;
  private readonly hubUrlPattern: string;
  private readonly invocations: HubInvocation[] = [];
  private readonly completions: HubCompletion[] = [];
  private socketCount = 0;
  private started = false;

  private readonly onWebSocket = (socket: WebSocket): void => {
    if (!matchesUrlPattern(socket.url(), this.hubUrlPattern)) {
      return;
    }
    this.socketCount += 1;
    const socketId = this.socketCount;
    socket.on('framesent', (frame) => this.readFrames(socketId, String(frame.payload), 'out'));
    socket.on('framereceived', (frame) => this.readFrames(socketId, String(frame.payload), 'in'));
  };

  constructor(options: ScratchHubWatcherOptions) {
    this.page = options.page;
    this.hubUrlPattern = options.hubUrlPattern;
  }

  start(): void {
    if (!this.started) {
      this.page.on('websocket', this.onWebSocket);
      this.started = true;
    }
  }

  stop(): void {
    this.page.off('websocket', this.onWebSocket);
    this.started = false;
  }

  /** True once the game has opened the scratch hub. */
  isConnected(): boolean {
    return this.socketCount > 0;
  }

  /** True when the game sent `target` at/after `since` (answered or not). */
  wasInvoked(target: string, since: number): boolean {
    return this.invocations.some((entry) => entry.target === target && entry.at >= since);
  }

  /** Hub targets the game invoked at/after `since`, in order. */
  invokedTargets(since: number): readonly string[] {
    return this.invocations.filter((entry) => entry.at >= since).map((entry) => entry.target);
  }

  /** Latest answered `target` invocation (e.g. JoinScratch config), if any. */
  latestResult(target: string): ScratchRoundSnapshot | undefined {
    for (let i = this.invocations.length - 1; i >= 0; i -= 1) {
      const invocation = this.invocations[i];
      if (invocation === undefined || invocation.target !== target) {
        continue;
      }
      const completion = this.completions.find(
        (entry) =>
          entry.socketId === invocation.socketId && entry.invocationId === invocation.invocationId,
      );
      if (completion !== undefined && completion.error === undefined) {
        return parseRound(target, completion.result, invocation.args);
      }
    }
    return undefined;
  }

  /** Server error of the latest answered `target` invocation, if the hub rejected it. */
  latestServerError(target: string): string | undefined {
    for (let i = this.invocations.length - 1; i >= 0; i -= 1) {
      const invocation = this.invocations[i];
      if (invocation === undefined || invocation.target !== target) {
        continue;
      }
      const completion = this.completions.find(
        (entry) =>
          entry.socketId === invocation.socketId && entry.invocationId === invocation.invocationId,
      );
      if (completion !== undefined) {
        return completion.error;
      }
    }
    return undefined;
  }

  /** Most recent `player.balance` the hub reported in any completion. */
  lastBalance(): number | undefined {
    for (let i = this.completions.length - 1; i >= 0; i -= 1) {
      const balance = asRecord(asRecord(this.completions[i]?.result).player).balance;
      if (typeof balance === 'number' && Number.isFinite(balance)) {
        return balance;
      }
    }
    return undefined;
  }

  /** True when `target` was invoked at/after `since` and the hub has answered. */
  hasResult(target: string, since: number): boolean {
    return this.findCompletion(target, since) !== undefined;
  }

  /** Resolves the hub's answer to the first `target` invocation at/after `since`. */
  async waitForResult(
    target: string,
    options: { readonly since: number; readonly timeoutMs?: number },
  ): Promise<ScratchRoundSnapshot> {
    const deadline = Date.now() + (options.timeoutMs ?? 20_000);
    while (Date.now() < deadline) {
      const found = this.findCompletion(target, options.since);
      if (found !== undefined) {
        if (found.completion.error !== undefined) {
          throw new ScratchHubServerError(target, found.completion.error);
        }
        return parseRound(target, found.completion.result, found.invocation.args);
      }
      await this.page.waitForTimeout(150);
    }
    throw new Error(
      this.wasInvoked(target, options.since)
        ? `Scratch hub did not answer ${target} within ${options.timeoutMs ?? 20_000}ms`
        : `Game never invoked ${target} on the scratch hub (click did not register?)`,
    );
  }

  private findCompletion(
    target: string,
    since: number,
  ): { readonly invocation: HubInvocation; readonly completion: HubCompletion } | undefined {
    for (const invocation of this.invocations) {
      if (invocation.target !== target || invocation.at < since) {
        continue;
      }
      const completion = this.completions.find(
        (entry) =>
          entry.socketId === invocation.socketId && entry.invocationId === invocation.invocationId,
      );
      if (completion !== undefined) {
        return { invocation, completion };
      }
    }
    return undefined;
  }

  private readFrames(socketId: number, payload: string, direction: 'in' | 'out'): void {
    for (const chunk of payload.split(RECORD_SEPARATOR)) {
      if (chunk.trim().length === 0) {
        continue;
      }
      let message: Record<string, unknown>;
      try {
        message = JSON.parse(chunk) as Record<string, unknown>;
      } catch {
        continue;
      }
      const invocationId = typeof message.invocationId === 'string' ? message.invocationId : undefined;
      if (invocationId === undefined) {
        continue;
      }
      if (direction === 'out' && message.type === 1 && typeof message.target === 'string') {
        this.invocations.push({
          socketId,
          target: message.target,
          invocationId,
          args: Array.isArray(message.arguments) ? message.arguments : [],
          at: Date.now(),
        });
      } else if (direction === 'in' && message.type === 3) {
        this.completions.push({
          socketId,
          invocationId,
          result: message.result,
          ...(typeof message.error === 'string' ? { error: message.error } : {}),
        });
      }
    }
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function parseCard(value: unknown): ScratchCardSnapshot | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }
  const card = asRecord(value);
  const cells = Array.isArray(card.cells)
    ? card.cells.map((cell) => {
        const entry = asRecord(cell);
        return { index: asNumber(entry.index), symbol: String(entry.symbol ?? '') };
      })
    : [];
  return {
    tier: String(card.tier ?? ''),
    gridDimension: asNumber(card.gridDimension),
    matchCount: asNumber(card.matchCount),
    cells,
    isWin: card.isWin === true,
    winAmount: asNumber(card.winAmount),
    winMultiplier: asNumber(card.winMultiplier),
  };
}

export function parseRound(
  target: string,
  result: unknown,
  requestArgs: readonly unknown[] = [],
): ScratchRoundSnapshot {
  const body = asRecord(result);
  const round = asRecord(body.round);
  const player = asRecord(body.player);
  const config = asRecord(body.config);
  const payTable = Array.isArray(config.scratchPayTable)
    ? config.scratchPayTable.map((row) => {
        const entry = asRecord(row);
        return {
          tier: String(entry.tier ?? ''),
          symbol: String(entry.symbol ?? ''),
          multiplier: asNumber(entry.multiplier),
        };
      })
    : [];
  const card = parseCard(round.scratchCard);
  return {
    target,
    message: String(body.message ?? ''),
    errorCode: typeof body.errorCode === 'string' ? body.errorCode : null,
    status: asNumber(round.status, -1),
    betAmount: asNumber(round.betAmount),
    winAmount: asNumber(round.winAmount),
    ...(typeof player.balance === 'number' ? { balance: player.balance } : {}),
    ...(card !== undefined ? { card } : {}),
    payTable,
    requestArgs,
    raw: result,
  };
}
