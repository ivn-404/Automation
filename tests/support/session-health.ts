/**
 * Reusable session + server health for long hunts.
 *
 * Overnight idle hits host TTL 0 / "session expired". Recover with Extend when
 * that button is live, otherwise a full host reload + Play (the iframe URL is
 * dead after timeout). Classify the initialize payload so a down staging box
 * is reported as SERVER-OFFLINE, not an autoplay miss.
 */

import type { Page, Response, TestInfo } from '@playwright/test';

import type { PlaywrightGameDriver } from '../../src/driver/playwright-game-driver.js';
import { matchesInitializeUrl } from '../../src/network/bet-url.js';
import { redactText } from '../../src/observability/redact.js';
import { listPhaserTexts } from '../../src/runtime/index.js';
import { getByPath } from '../../src/shared/json-path.js';
import type { SgapSession } from '../fixtures/index.js';
import { reloadAndReopenGame } from './game-reload.js';
import { probeOngoingFreeSpinContinue } from './session-continue-probe.js';

export type ServerHealthKind = 'ok' | 'session-expired' | 'server-offline' | 'game-error';

export interface ServerHealth {
  readonly kind: ServerHealthKind;
  readonly status: number;
  readonly detail: string;
  readonly body?: unknown;
}

const HOST_TIMEOUT =
  /session (has )?expired|session timeout|session timed out|connection (was )?lost|disconnected|TTL:\s*0s\b/iu;
const OFFLINE_TEXT =
  /offline|maintenance|service unavailable|server (is )?(down|unavailable)|try again later|gateway timeout|bad gateway|502|503|504/iu;
const SESSION_TEXT = /session expired|invalid session|session timeout|not authenticated|unauthorized/iu;
const OFFLINE_STATUS = new Set([0, 408, 502, 503, 504, 521, 522, 523]);

function asText(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (value === undefined || value === null) {
    return '';
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function classifyServerPayload(status: number, body: unknown): ServerHealth {
  const message = [
    asText(getByPath(body, 'message')),
    asText(getByPath(body, 'error')),
    asText(getByPath(body, 'errorCode')),
    asText(getByPath(body, 'data.message')),
    asText(getByPath(body, 'data.error')),
  ]
    .filter((part) => part.length > 0)
    .join(' | ');

  if (OFFLINE_STATUS.has(status) || OFFLINE_TEXT.test(message)) {
    return {
      kind: 'server-offline',
      status,
      detail: `SERVER-OFFLINE initialize HTTP ${status}${message === '' ? '' : ` — ${message}`}`,
      body,
    };
  }
  if (status === 401 || status === 403 || SESSION_TEXT.test(message)) {
    return {
      kind: 'session-expired',
      status,
      detail: `SESSION-EXPIRED initialize HTTP ${status}${message === '' ? '' : ` — ${message}`}`,
      body,
    };
  }
  if (status < 200 || status >= 400) {
    return {
      kind: 'game-error',
      status,
      detail: `GAME-ERROR initialize HTTP ${status}${message === '' ? '' : ` — ${message}`}`,
      body,
    };
  }

  const sessionId = getByPath(body, 'data.sessionId') ?? getByPath(body, 'sessionId');
  const playerId = getByPath(body, 'data.playerId') ?? getByPath(body, 'playerId');
  if (sessionId === undefined && playerId === undefined && body === undefined) {
    return {
      kind: 'server-offline',
      status,
      detail: `SERVER-OFFLINE initialize HTTP ${status} — empty body`,
      body,
    };
  }
  return {
    kind: 'ok',
    status,
    detail: `SERVER-OK initialize HTTP ${status}`,
    body,
  };
}

export async function isSessionTimedOut(page: Page, driver: PlaywrightGameDriver): Promise<boolean> {
  // Extend lives on the host chrome even for a live session — it is not a timeout.
  const expired = [
    page.getByText(/TTL:\s*0s\b/i),
    page.getByText(/Session:\s*0s\b/i),
    page.getByText(/session (has )?expired/i),
    page.getByText(/session timeout/i),
    page.getByText(/session timed out/i),
  ];
  for (const locator of expired) {
    if (await locator.first().isVisible().catch(() => false)) {
      return true;
    }
  }
  const texts = await listPhaserTexts(page, driver.iframeSelector).catch(() => []);
  return texts.some((hit) => /session expired|session timeout|session timed out/iu.test(hit.text));
}

export async function captureInitialize(
  page: Page,
  manifest: SgapSession['manifest'],
  during: () => Promise<void>,
  timeoutMs = 45_000,
): Promise<ServerHealth> {
  const waiter = page
    .waitForResponse((response: Response) => matchesInitializeUrl(response.url(), manifest), {
      timeout: timeoutMs,
    })
    .catch(() => undefined);
  await during();
  const response = await waiter;
  if (response === undefined) {
    return {
      kind: 'server-offline',
      status: 0,
      detail: 'SERVER-OFFLINE — no initialize response (timeout / connection refused)',
    };
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = undefined;
  }
  return classifyServerPayload(response.status(), body);
}

export async function recoverTimedOutSession(options: {
  readonly caseId: string;
  readonly sgapSession: SgapSession;
  readonly sgapDriver: PlaywrightGameDriver;
  readonly page: Page;
  readonly testInfo: TestInfo;
}): Promise<ServerHealth> {
  const { caseId, sgapSession, sgapDriver, page, testInfo } = options;
  const timedOut = await isSessionTimedOut(page, sgapDriver);
  const extend = page.getByRole('button', { name: /^Extend$/i }).first();
  const canExtend = timedOut && (await extend.isVisible().catch(() => false));
  if (canExtend) {
    console.log(`[${caseId}] session recover — Extend`);
    await extend.click({ timeout: 8_000, force: true }).catch(() => undefined);
    await page.waitForTimeout(1_500);
    if (!(await isSessionTimedOut(page, sgapDriver))) {
      const health: ServerHealth = {
        kind: 'ok',
        status: 200,
        detail: 'session recover — Extend (host session still live, no re-init)',
      };
      console.log(`[${caseId}] ${health.detail}`);
      return health;
    }
  }

  console.log(`[${caseId}] session recover — full reopen`);
  const health = await captureInitialize(page, sgapSession.manifest, async () => {
    await reloadAndReopenGame({
      sgapSession,
      sgapDriver,
      page,
      preserveFeatureSession: false,
    });
  });
  console.log(`[${caseId}] ${health.detail}`);
  if (health.body !== undefined) {
    await testInfo.attach('initialize-after-recover.json', {
      body: Buffer.from(redactText(JSON.stringify(health.body, null, 2))),
      contentType: 'application/json',
    });
  }
  if (health.kind === 'ok' || health.kind === 'session-expired') {
    await probeOngoingFreeSpinContinue({
      caseId,
      page,
      driver: sgapDriver,
      testInfo,
      source: 'leftover-launch',
      manifest: sgapSession.manifest,
    }).catch(() => undefined);
  }
  return health;
}
