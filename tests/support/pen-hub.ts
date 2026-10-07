/**
 * Shared setup for the PEN (penetration) specs from docs/PERSONALTESTING.md.
 *
 * Opens the game through the normal launcher, captures the live scratch-hub URL
 * (with its access_token) and the exact JoinScratch arguments the game sends, then
 * opens our own active ScratchHubClient and tries to join. Specs drive the hub
 * directly through that client — the click-only controller cannot send fuzzed frames.
 *
 * Game-agnostic: the hub URL and JoinScratch args come from the live socket, not
 * from any per-title constant.
 */

import type { Page, TestInfo } from '@playwright/test';

import { test, expect } from '../fixtures/index.js';
import type { SgapSession } from '../fixtures/index.js';
import type { PlaywrightGameDriver } from '../../src/driver/playwright-game-driver.js';
import type { VerificationResult } from '../../src/core/models/index.js';
import {
  ScratchHubClient,
  decodeAccessToken,
  parseScratchRound,
  type HubCompletion,
  type ScratchCardSnapshot,
  type ScratchRoundSnapshot,
} from '../../src/network/index.js';
import { settleCanvasToBaseGame } from '../../src/platform/index.js';
import { enterScratchHud } from './scratch-flow.js';

const RECORD_SEPARATOR = '\u001e';

export interface PenSessionArgs {
  readonly sgapSession: SgapSession;
  readonly sgapDriver: PlaywrightGameDriver;
  readonly page: Page;
  readonly testInfo: TestInfo;
  readonly manualTestId: string;
}

export interface PenScratchConfig {
  readonly minBet: number;
  readonly maxBet: number;
  readonly maxWin: number;
  readonly maxWinMultiplier: number;
  readonly currencyDecimalPlaces?: number;
  readonly raw: Record<string, unknown>;
}

export interface PenSession {
  readonly client: ScratchHubClient;
  readonly hubUrl: string;
  /** Read-only JWT claims from the access_token (playerId, operatorId, gameId…). */
  readonly claims: Record<string, unknown> | undefined;
  /** The exact arguments the game sent with JoinScratch — replayed by our client. */
  readonly joinArgs: readonly unknown[];
  readonly joined: boolean;
  readonly joinError?: string;
  readonly joinResult?: ScratchRoundSnapshot;
  readonly config?: PenScratchConfig;
  readonly balance?: number;
}

/**
 * Boots the launcher, captures hub URL + JoinScratch args, and connects our client.
 * Skips when the title has no scratch game or the hub never connected. Does NOT
 * skip when JoinScratch errors — that outage is itself a finding; the returned
 * session reports `joined:false` and specs that need a live round skip themselves.
 */
export async function startPenSession(args: PenSessionArgs): Promise<PenSession> {
  const { sgapSession, sgapDriver, page, testInfo, manualTestId } = args;
  const scratch = sgapSession.scratchCard;
  test.skip(!(await scratch.isAvailable()), `${sgapSession.manifest.gameId} has no scratchCard config`);

  testInfo.annotations.push(
    { type: 'manualTestId', description: manualTestId },
    { type: 'category', description: 'PEN' },
    { type: 'gameId', description: sgapSession.manifest.gameId },
  );

  let hubUrl = '';
  let joinArgs: readonly unknown[] = [];
  page.on('websocket', (ws) => {
    if (!ws.url().includes('/hubs/game')) {
      return;
    }
    hubUrl = ws.url();
    ws.on('framesent', (frame) => {
      const payload = String(frame.payload);
      if (!payload.includes('"JoinScratch"')) {
        return;
      }
      try {
        const message = JSON.parse(payload.split(RECORD_SEPARATOR)[0] ?? '{}') as { arguments?: unknown[] };
        if (Array.isArray(message.arguments)) {
          joinArgs = message.arguments;
        }
      } catch {
        // Ignore non-JSON frames.
      }
    });
  });

  await sgapDriver.gameCanvas().waitFor({ state: 'visible' });
  await enterScratchHud(page, sgapDriver);
  await settleCanvasToBaseGame(page, sgapDriver, sgapSession.manifest, sgapSession.platform.getInitializeBody());

  // Opening the drawer is what makes the game connect the hub and send JoinScratch.
  // It throws when the hub errors — we only need the captured URL/args, so swallow it.
  try {
    await scratch.open({ timeoutMs: 20_000 });
  } catch (error) {
    console.log('[pen] drawer open (expected during a hub outage):', (error as Error).message);
  }

  const deadline = Date.now() + 10_000;
  while (hubUrl.length === 0 && Date.now() < deadline) {
    await page.waitForTimeout(250);
  }
  test.skip(hubUrl.length === 0, `${sgapSession.manifest.gameId}: scratch hub socket never opened`);

  const client = await ScratchHubClient.connect(hubUrl);
  const claims = decodeAccessToken(hubUrl);
  const completion = await safeInvoke({ client } as PenSession, 'JoinScratch', joinArgs);
  const joined = completion.error === undefined;
  const joinResult = joined ? parseScratchRound('JoinScratch', completion.result, joinArgs) : undefined;
  const config = joined ? readConfig(completion.result) : undefined;

  return {
    client,
    hubUrl,
    claims,
    joinArgs,
    joined,
    ...(completion.error !== undefined ? { joinError: completion.error } : {}),
    ...(joinResult !== undefined ? { joinResult } : {}),
    ...(config !== undefined ? { config } : {}),
    ...(joinResult?.balance !== undefined ? { balance: joinResult.balance } : {}),
  };
}

/** Skips the current test (with the real reason) when the hub could not be joined. */
export function requireJoined(session: PenSession): void {
  test.skip(
    !session.joined,
    `Scratch hub JoinScratch is failing (${session.joinError ?? 'unknown'}); ` +
      'cannot buy a card, so this round-dependent PEN case is blocked until the backend recovers.',
  );
}

export interface HubRound {
  readonly completion: HubCompletion;
  readonly round?: ScratchRoundSnapshot;
}

/** Invokes a hub method and never throws — a thrown/rejected call becomes an error completion. */
export async function safeInvoke(
  session: PenSession,
  target: string,
  args: readonly unknown[],
  options?: { readonly invocationId?: string; readonly timeoutMs?: number },
): Promise<HubCompletion> {
  return session.client.invoke(target, args, options).catch((error: Error) => ({ error: error.message }));
}

/** StartRound(bet, gridIndex) through our client. `round` is undefined on a server error. */
export async function startRound(
  session: PenSession,
  bet: unknown,
  gridIndex: unknown,
  options?: { readonly invocationId?: string; readonly timeoutMs?: number },
): Promise<HubRound> {
  const completion = await safeInvoke(session, 'StartRound', [bet, gridIndex], options);
  return {
    completion,
    ...(completion.error === undefined
      ? { round: parseScratchRound('StartRound', completion.result, [bet, gridIndex]) }
      : {}),
  };
}

/** Cashout() through our client. `round` is undefined on a server error. */
export async function cashout(
  session: PenSession,
  options?: { readonly invocationId?: string; readonly timeoutMs?: number },
): Promise<HubRound> {
  const completion = await safeInvoke(session, 'Cashout', [], options);
  return {
    completion,
    ...(completion.error === undefined ? { round: parseScratchRound('Cashout', completion.result, []) } : {}),
  };
}

/** Re-reads the authoritative balance by re-invoking JoinScratch (used after error paths). */
export async function readBalance(session: PenSession): Promise<number | undefined> {
  const completion = await safeInvoke(session, 'JoinScratch', session.joinArgs);
  if (completion.error !== undefined) {
    return undefined;
  }
  return parseScratchRound('JoinScratch', completion.result, session.joinArgs).balance;
}


export function penCheck(passed: boolean, message: string, expected?: unknown, actual?: unknown): VerificationResult {
  return { kind: 'stateManagement', passed, message, expected, actual };
}

/** Attaches the checks (and optional raw hub evidence) to the report, logs them, then fails on the first that did not pass. */
export async function expectPenChecks(
  testInfo: TestInfo,
  results: readonly VerificationResult[],
  evidence?: unknown,
): Promise<void> {
  await testInfo.attach('pen-checks.json', {
    body: JSON.stringify(results, null, 2),
    contentType: 'application/json',
  });
  if (evidence !== undefined) {
    await testInfo.attach('pen-hub-evidence.json', {
      body: JSON.stringify(evidence, null, 2),
      contentType: 'application/json',
    });
  }
  for (const result of results) {
    console.log(`[pen] ${result.passed ? 'PASS' : 'FAIL'} ${result.message}`);
  }
  for (const result of results) {
    expect(result.passed, result.message).toBe(true);
  }
}

/** True when the hub rejected an invocation cleanly (any error) rather than crashing/hanging. */
export function isCleanRejection(completion: { readonly error?: string }): boolean {
  return typeof completion.error === 'string' && completion.error.length > 0;
}

/**
 * True only when a real card was dealt. The hub reports validation failures in the
 * response body (`errorCode` + `message`, `scratchCard: null`) as a normal result,
 * not as a SignalR error — so a parsed `round` alone does not mean a card was dealt.
 */
export function wasDealt(
  round: ScratchRoundSnapshot | undefined,
): round is ScratchRoundSnapshot & { readonly card: ScratchCardSnapshot } {
  return round !== undefined && round.card !== undefined && round.errorCode === null;
}

/** The server's own reason for refusing a call: the SignalR error, or the body errorCode + message. */
export function rejectionReason(completion: HubCompletion, round: ScratchRoundSnapshot | undefined): string | undefined {
  if (completion.error !== undefined) {
    return completion.error;
  }
  if (round !== undefined && round.errorCode !== null) {
    return `${round.errorCode}: ${round.message}`;
  }
  return undefined;
}

export interface ParallelCall {
  readonly target: string;
  readonly args: readonly unknown[];
  readonly options?: { readonly invocationId?: string; readonly timeoutMs?: number };
}

/**
 * Fires N invocations back-to-back WITHOUT awaiting between them (all frames leave
 * before any completion is read), then resolves with every completion in order.
 * Used by the race / double-spend cases (PEN-054/055) to probe non-atomic debits.
 */
export async function invokeParallel(
  session: PenSession,
  calls: readonly ParallelCall[],
): Promise<HubCompletion[]> {
  const pending = calls.map((call) => safeInvoke(session, call.target, call.args, call.options));
  return Promise.all(pending);
}

/** Parses each completion as a round so callers can reuse `wasDealt` / `rejectionReason`. */
export function asRounds(target: string, completions: readonly HubCompletion[]): HubRound[] {
  return completions.map((completion) => ({
    completion,
    ...(completion.error === undefined
      ? { round: parseScratchRound(target, completion.result, []) }
      : {}),
  }));
}

export type TokenTamper = 'alg-none' | 'flipped-claim' | 'expired';

/**
 * Returns a copy of the hub URL whose `access_token` has been tampered with, for the
 * token-integrity case (PEN-051). All variants MUST be rejected by a correct backend:
 * we cannot re-sign (no key), so `flipped-claim` / `expired` also break the signature —
 * a server that accepts any of them is failing to validate the JWT.
 */
export function tamperToken(hubUrl: string, variant: TokenTamper): string {
  const url = new URL(hubUrl);
  const token = url.searchParams.get('access_token');
  const [header, payload, signature] = (token ?? '').split('.');
  if (header === undefined || payload === undefined) {
    return hubUrl;
  }
  const decode = (segment: string): Record<string, unknown> =>
    JSON.parse(Buffer.from(segment, 'base64url').toString('utf8')) as Record<string, unknown>;
  const encode = (value: Record<string, unknown>): string =>
    Buffer.from(JSON.stringify(value)).toString('base64url');

  let nextHeader = decode(header);
  let nextPayload = decode(payload);
  let nextSignature = signature ?? '';
  if (variant === 'alg-none') {
    nextHeader = { ...nextHeader, alg: 'none' };
    nextSignature = '';
  } else if (variant === 'flipped-claim') {
    const sub = String(nextPayload.sub ?? '');
    nextPayload = { ...nextPayload, sub: `${sub.slice(0, -1)}${sub.endsWith('0') ? '1' : '0'}` };
  } else {
    nextPayload = { ...nextPayload, exp: Math.floor(Date.now() / 1000) - 3600 };
  }
  url.searchParams.set('access_token', `${encode(nextHeader)}.${encode(nextPayload)}.${nextSignature}`);
  return url.toString();
}

export interface SecondConnection {
  readonly client: ScratchHubClient;
  readonly joined: boolean;
  readonly joinResult?: ScratchRoundSnapshot;
  readonly joinError?: string;
}

/**
 * Opens a SECOND socket to the same hub with the same token (PEN-056 two-connection
 * concurrency). Not a distinct identity — a genuinely separate player would need its
 * own launched session, which the single-lane PEN config does not provide.
 */
export async function openSecondClient(session: PenSession): Promise<SecondConnection> {
  const client = await ScratchHubClient.connect(session.hubUrl);
  const completion = await client
    .invoke('JoinScratch', session.joinArgs)
    .catch((error: Error): HubCompletion => ({ error: error.message }));
  const joined = completion.error === undefined;
  return {
    client,
    joined,
    ...(joined ? { joinResult: parseScratchRound('JoinScratch', completion.result, session.joinArgs) } : {}),
    ...(completion.error !== undefined ? { joinError: completion.error } : {}),
  };
}

function readConfig(result: unknown): PenScratchConfig | undefined {
  const body = result as { config?: Record<string, unknown> } | null;
  const config = body?.config;
  if (config === undefined || config === null) {
    return undefined;
  }
  const num = (value: unknown, fallback: number): number =>
    typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  return {
    minBet: num(config.minBet, 0.1),
    maxBet: num(config.maxBet, 100),
    maxWin: num(config.maxWin, 200),
    maxWinMultiplier: num(config.maxWinMultiplier, 200),
    ...(typeof config.currencyDecimalPlaces === 'number'
      ? { currencyDecimalPlaces: config.currencyDecimalPlaces }
      : {}),
    raw: config,
  };
}
