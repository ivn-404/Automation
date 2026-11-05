/**
 * Slot /bet probes for the PEN specs.
 *
 * The scratch hub client cannot speak for a slot. These helpers reuse the
 * authenticated request the game itself just sent (URL and headers) and post
 * controlled variants. Tokens are never returned to the report.
 */

import type { APIResponse, Page, Request } from 'playwright';

import type { GameManifest } from '../../src/core/models/index.js';
import { matchesBetUrl } from '../../src/network/bet-url.js';
import { redactHeaders, redactUrl } from '../../src/observability/redact.js';
import { recordPenExchange } from './pen-evidence.js';

const FORWARDED_HEADERS = ['authorization', 'content-type', 'x-play-instance', 'accept'] as const;

const LEAK = /stack trace|node_modules|sequelize|sql syntax|begin private|at\s+\w+\s+\(|\/src\/|password|secret key/iu;

export interface CapturedSlotBet {
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: Record<string, unknown>;
}

export interface SlotProbeResult {
  readonly status: number;
  readonly balance?: number;
  readonly roundId?: string;
  readonly win?: number;
  readonly freeSpinItems?: number;
  readonly message?: string;
  readonly leaked: boolean;
  readonly text: string;
}

export async function captureLiveSlotBet(
  page: Page,
  manifest: GameManifest,
  spin: () => Promise<unknown>,
): Promise<CapturedSlotBet> {
  const seen = page.waitForRequest(
    (request) => request.method() === 'POST' && matchesBetUrl(request.url(), manifest),
    { timeout: 90_000 },
  );
  await spin();
  const request = await seen;
  return captureFromRequest(request);
}

export function captureFromRequest(request: Request): CapturedSlotBet {
  const raw = request.headers();
  const headers: Record<string, string> = {};
  for (const name of FORWARDED_HEADERS) {
    const value = raw[name];
    if (value !== undefined && value.length > 0) {
      headers[name] = value;
    }
  }
  if (headers['content-type'] === undefined) {
    headers['content-type'] = 'application/json';
  }
  const parsed = request.postDataJSON() as Record<string, unknown> | null;
  return {
    url: request.url(),
    headers,
    body: parsed ?? {},
  };
}

export async function postSlotBet(
  page: Page,
  captured: CapturedSlotBet,
  body: unknown,
  options?: { readonly authorize?: boolean; readonly raw?: string; readonly authorization?: string },
): Promise<SlotProbeResult> {
  const headers = { ...captured.headers };
  if (options?.authorize === false) {
    delete headers.authorization;
  }
  if (options?.authorization !== undefined) {
    headers.authorization = options.authorization;
  }
  const response = await page.request.post(captured.url, {
    headers,
    data: options?.raw ?? body,
    timeout: 20_000,
    failOnStatusCode: false,
  });
  const result = await readProbe(response);
  await recordPenExchange({
    page,
    title: `POST /api/v1/slots/bet → HTTP ${result.status}`,
    request: {
      url: redactUrl(captured.url),
      headers: redactHeaders(headers),
      body: options?.raw ?? body,
    },
    response: {
      status: result.status,
      balance: result.balance,
      win: result.win,
      message: result.message,
      body: result.text,
    },
  });
  return result;
}

/** The server refused a bet because this player still has a round in progress. */
export function unresolvedRefusal(result: SlotProbeResult): boolean {
  return result.status >= 400 && /unresolved spin/i.test(result.message ?? '');
}

/** Balance and open-round id from a slots initialize body. An empty object is not a round. */
export function readInitializeSnapshot(body: unknown): { balance?: number; roundId?: string } {
  const record = asRecord(body);
  const nested = asRecord(record?.data);
  const root = nested ?? record;
  if (root === undefined) {
    return {};
  }
  const balance = numberAt(root, 'balance') ?? numberAt(record, 'balance');
  const roundId = roundIdOf(root.unresolvedSpin) ?? roundIdOf(record?.unresolvedSpin);
  return {
    ...(balance !== undefined ? { balance } : {}),
    ...(roundId !== undefined ? { roundId } : {}),
  };
}

export function readSlotProbeText(status: number, text: string): SlotProbeResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    parsed = undefined;
  }
  const record = parsed !== null && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : undefined;
  const root = unwrapData(record);
  const balance = numberAt(root, 'balance');
  const round = root?.unresolvedSpin;
  const slot = root?.slot;
  const slotRecord = slot !== null && typeof slot === 'object' ? (slot as Record<string, unknown>) : undefined;
  const win = numberAt(slotRecord, 'totalWin');
  const freeSpin = slotRecord?.freeSpin;
  const items =
    freeSpin !== null && typeof freeSpin === 'object'
      ? (freeSpin as Record<string, unknown>).items
      : undefined;
  const message = typeof root?.message === 'string' ? root.message.slice(0, 240) : undefined;
  const roundId = roundIdOf(round);
  return {
    status,
    ...(balance !== undefined ? { balance } : {}),
    ...(roundId !== undefined ? { roundId } : {}),
    ...(win !== undefined ? { win } : {}),
    ...(Array.isArray(items) ? { freeSpinItems: items.length } : {}),
    ...(message !== undefined ? { message } : {}),
    leaked: LEAK.test(text),
    text: text.slice(0, 500),
  };
}

async function readProbe(response: APIResponse): Promise<SlotProbeResult> {
  return readSlotProbeText(response.status(), await response.text());
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function roundIdOf(value: unknown): string | undefined {
  if (typeof value === 'string' && value.length > 0) {
    return value;
  }
  const record = asRecord(value);
  const uuid = record?.uuid;
  return typeof uuid === 'string' && uuid.length > 0 ? uuid : undefined;
}

function unwrapData(record: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (record === undefined) {
    return undefined;
  }
  if (numberAt(record, 'balance') !== undefined) {
    return record;
  }
  const data = record.data;
  if (data !== null && typeof data === 'object' && numberAt(data as Record<string, unknown>, 'balance') !== undefined) {
    return data as Record<string, unknown>;
  }
  return record;
}

function numberAt(record: Record<string, unknown> | undefined, key: string): number | undefined {
  const value = record?.[key];
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : undefined;
}
