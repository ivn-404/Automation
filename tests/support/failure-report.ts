/**
 * One readable block per canvas failure, in place of a bare Playwright timeout.
 *
 * A timeout on a canvas game says only "the thing I waited for never happened".
 * It never says whether the tap missed, the game rejected the bet, the session
 * ran out of bet allowance, or a blocker ate the input — and those need very
 * different fixes. This gathers the four signals that separate them (frame
 * orientation, host session header, bet traffic around the click, and a colour
 * scan of what is actually drawn) and prints a single verdict line up front.
 *
 * The colour scan doubles as locator maintenance: it reports where the game's
 * controls really are, so a drifted manifest ratio can be read straight off the
 * failure instead of being re-derived by hand.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { test } from '@playwright/test';
import type { Page, Response } from 'playwright';

import type { GameManifest } from '../../src/core/models/index.js';
import { classifyCanvasPng, type CanvasBlocker } from '../../src/eye/canvas-blocker.js';
import { describeControlScan, scanControls } from '../../src/eye/canvas-vision.js';
import { decodePng } from '../../src/verification/reel/image-match.js';
import type { PlaywrightGameDriver } from '../../src/driver/playwright-game-driver.js';
import { describeRound, roundTrackerFor, type OpenRound } from '../../src/network/round-tracker.js';
import {
  describeOrientation,
  findGameFrame,
  isBlockedByRotation,
  readOrientation,
  type OrientationState,
} from '../../src/platform/portrait-guard.js';
import { captureViewportRegion, HIDE_SCREENSHOT_TOAST } from '../../src/platform/stable-screenshot.js';

const BET_URL_FRAGMENT = '/api/v1/slots/bet';
const TRAFFIC_LIMIT = 12;
const BODY_PREVIEW = 400;

export interface BetTrafficEntry {
  readonly at: number;
  readonly status: number;
  readonly ok: boolean;
  readonly requestBody: string;
  readonly responseBody: string;
}

export interface BetTrafficRecorder {
  entries(): readonly BetTrafficEntry[];
  stop(): void;
}

/**
 * Ring-buffer every bet round trip so a failure can be explained after the fact.
 * Bodies are read lazily off the response; failures to read are recorded, not thrown.
 */
export function recordBetTraffic(page: Page): BetTrafficRecorder {
  const entries: BetTrafficEntry[] = [];

  const handler = (response: Response): void => {
    if (!response.url().includes(BET_URL_FRAGMENT)) {
      return;
    }
    const entry = {
      at: Date.now(),
      status: response.status(),
      ok: response.ok(),
      requestBody: response.request().postData() ?? '',
      responseBody: '',
    };
    entries.push(entry);
    while (entries.length > TRAFFIC_LIMIT) {
      entries.shift();
    }
    void response
      .text()
      .then((body) => {
        const index = entries.indexOf(entry);
        if (index >= 0) {
          entries[index] = { ...entry, responseBody: body.slice(0, BODY_PREVIEW) };
        }
      })
      .catch(() => undefined);
  };

  page.on('response', handler);
  return {
    entries: () => entries,
    stop: () => page.off('response', handler),
  };
}

const recorders = new WeakMap<Page, BetTrafficRecorder>();

/**
 * Start recording on a page, once. Installed by the session fixture so every spec
 * carries bet history into its failure report without opting in.
 */
export function attachBetTraffic(page: Page): BetTrafficRecorder {
  const existing = recorders.get(page);
  if (existing !== undefined) {
    return existing;
  }
  const recorder = recordBetTraffic(page);
  recorders.set(page, recorder);
  return recorder;
}

export function betTrafficFor(page: Page): BetTrafficRecorder | undefined {
  return recorders.get(page);
}

export interface HostSessionState {
  readonly balance?: string;
  readonly ttlSeconds?: number;
  readonly betLimitRemaining?: number;
  readonly sessionId?: string;
}

async function readHostSession(page: Page): Promise<HostSessionState> {
  const text = await page
    .evaluate(() => {
      const doc = (globalThis as unknown as { document: { body: { innerText: string } | null } })
        .document;
      return doc.body?.innerText ?? '';
    })
    .catch(() => '');

  const pick = (pattern: RegExp): string | undefined => pattern.exec(text)?.[1]?.trim();
  const ttl = pick(/TTL:\s*(\d+)\s*s/i);
  const limit = pick(/Bet limit:\s*(\d+)\s*remaining/i);

  return {
    balance: pick(/Balance:\s*([\d.,]+)/i),
    ttlSeconds: ttl === undefined ? undefined : Number(ttl),
    betLimitRemaining: limit === undefined ? undefined : Number(limit),
    sessionId: pick(/Session ID:\s*([\w-]+)/i),
  };
}

export interface CanvasHitInfo {
  readonly action: string;
  readonly ratio: { readonly x: number; readonly y: number };
  readonly pageX: number;
  readonly pageY: number;
  /** Epoch ms of the tap, when the driver recorded one. */
  readonly at?: number;
}

export interface CanvasFailureInput {
  readonly page: Page;
  readonly manifest: GameManifest;
  readonly action: string;
  readonly error: unknown;
  readonly hit?: CanvasHitInfo;
  /** Supplied so the scan is taken of the canvas and reported in manifest ratio space. */
  readonly driver?: PlaywrightGameDriver;
  readonly traffic?: BetTrafficRecorder;
  /** Screen id from the eye, when the caller already classified it. */
  readonly screenId?: string;
  readonly manualTestId?: string;
}

export interface CanvasFailureReport {
  readonly cause: string;
  readonly remedy: string;
  readonly text: string;
  readonly orientation: OrientationState;
}

interface Verdict {
  readonly cause: string;
  readonly remedy: string;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message.split('\n')[0] ?? error.message;
  }
  return String(error);
}

function decideVerdict(
  orientation: OrientationState,
  session: HostSessionState,
  traffic: readonly BetTrafficEntry[],
  hit: CanvasHitInfo | undefined,
  screenId: string | undefined,
  error: unknown,
  round: OpenRound | undefined,
  blocker: CanvasBlocker | undefined,
): Verdict {
  if (!orientation.frameFound) {
    return {
      cause: 'The game iframe is gone — the host navigated away or the session was closed.',
      remedy: 'Reopen the game through the platform before retrying the action.',
    };
  }

  if (isBlockedByRotation(orientation)) {
    return {
      cause:
        `The game is showing its "Rotate to portrait" blocker: the iframe re-laid out to ` +
        `${orientation.innerWidth}x${orientation.innerHeight} (landscape), so every canvas tap was swallowed.`,
      remedy: 'Re-pin the iframe with the portrait stylesheet lock (healPortraitOrientation).',
    };
  }

  if (session.betLimitRemaining === 0) {
    return {
      cause: 'The staging session has no bet allowance left (bet limit reached 0).',
      remedy: 'Start a fresh session or raise the bet limit for this player.',
    };
  }

  if (session.ttlSeconds !== undefined && session.ttlSeconds <= 0) {
    return {
      cause: 'The staging session expired (TTL 0).',
      remedy: 'Extend or restart the session before retrying.',
    };
  }

  const rejected = traffic.filter((entry) => !entry.ok);
  const lastRejected = rejected[rejected.length - 1];
  if (lastRejected !== undefined) {
    return {
      cause:
        `The game rejected the bet with HTTP ${lastRejected.status}: ` +
        `${lastRejected.responseBody.slice(0, 160) || '<empty body>'}`,
      remedy: 'Check the stake against the player bet limits before spinning.',
    };
  }

  const clickAt = hit?.at;
  const betAfterClick =
    clickAt === undefined ? undefined : traffic.find((entry) => entry.at >= clickAt);

  if (round !== undefined && betAfterClick === undefined) {
    return {
      cause:
        `The game was still playing out a feature round (${describeRound(round)}) — ` +
        'it ignores spin taps until it reports the round complete.',
      remedy: 'Wait for /unresolved-spin/<id>/complete (waitForIdleHud does) before the next spin.',
    };
  }

  if (blocker !== undefined && blocker.kind !== 'none' && betAfterClick === undefined) {
    return blocker.kind === 'buy-confirm'
      ? {
          cause: `The Buy Feature panel was open over the HUD (${blocker.detail}) — taps meant for the HUD landed on the panel.`,
          remedy: 'Close it with closeBuyPanel (scene-graph close control) before the action.',
        }
      : {
          cause: `A "${blocker.kind}" screen was covering the game (${blocker.detail}).`,
          remedy: 'Dismiss it (dismissCanvasBlocker) before the action.',
        };
  }

  if (clickAt !== undefined && betAfterClick === undefined) {
    return {
      cause:
        `The tap never reached the game — no ${BET_URL_FRAGMENT} request was sent after ` +
        `clicking ${hit?.action ?? 'the control'} at ratio ` +
        `${hit?.ratio.x.toFixed(3)},${hit?.ratio.y.toFixed(3)}.`,
      remedy: 'Compare the VISION scan below against the manifest ratio for this action.',
    };
  }

  if (screenId !== undefined && screenId !== 'base-idle') {
    return {
      cause: `A "${screenId}" screen was covering the game when the action ran.`,
      remedy: `Give the eye catalog a working dismissal for "${screenId}".`,
    };
  }

  if (betAfterClick !== undefined) {
    return {
      cause:
        `The bet was accepted (HTTP ${betAfterClick.status}) but the round never reached the ` +
        'state the test waited for.',
      remedy: 'Raise the settle timeout or check the round-complete detection for this feature.',
    };
  }

  return {
    cause: `Unclassified failure: ${errorMessage(error)}`,
    remedy: 'Inspect the attached screenshot and control scan.',
  };
}

async function captureGameImage(page: Page, manifest: GameManifest): Promise<Buffer | undefined> {
  const frame = findGameFrame(page, manifest);
  if (frame !== undefined) {
    const box = await frame
      .frameElement()
      .then((element) => element.boundingBox())
      .catch(() => null);
    if (box !== null && box !== undefined && box.width > 0 && box.height > 0) {
      const clipped = await captureViewportRegion(page, box, { label: 'failure report' }).catch(() => undefined);
      if (clipped !== undefined) {
        return clipped;
      }
    }
  }
  return page.screenshot({ type: 'png', style: HIDE_SCREENSHOT_TOAST }).catch(() => undefined);
}

function formatTraffic(traffic: readonly BetTrafficEntry[], clickAt: number | undefined): string {
  if (traffic.length === 0) {
    return 'no bet traffic recorded';
  }
  return traffic
    .slice(-4)
    .map((entry) => {
      const when =
        clickAt === undefined
          ? new Date(entry.at).toISOString().slice(11, 23)
          : `${((entry.at - clickAt) / 1000).toFixed(1)}s vs click`;
      return `HTTP ${entry.status} ${when} req=${entry.requestBody.slice(0, 90) || '<none>'}`;
    })
    .join('\n         ');
}

async function attachSafe(name: string, body: Buffer, contentType: string): Promise<void> {
  try {
    await test.info().attach(name, { body, contentType });
  } catch {
    // Called outside a Playwright test (calibrators, scripts).
  }
}

function persist(baseName: string, png: Buffer | undefined, text: string): string {
  const dir = path.join(process.cwd(), 'test-results', 'failures');
  mkdirSync(dir, { recursive: true });
  const stem = path.join(dir, baseName);
  writeFileSync(`${stem}.txt`, text, 'utf8');
  if (png !== undefined) {
    writeFileSync(`${stem}.png`, png);
  }
  return `${stem}.txt`;
}

/** Blob positions expressed as canvas action ratios, directly comparable to the manifest. */
function describeScanInActionSpace(
  png: Buffer,
  toActionRatio: (point: { readonly x: number; readonly y: number }) => {
    readonly x: number;
    readonly y: number;
  },
): string {
  let image;
  try {
    image = decodePng(png);
  } catch {
    return 'control scan unavailable (image could not be decoded)';
  }

  const lines: string[] = [];
  for (const hue of ['green', 'red'] as const) {
    const found = scanControls(image, hue).slice(0, 5);
    if (found.length === 0) {
      lines.push(`${hue}: none`);
      continue;
    }
    for (const control of found) {
      const ratio = toActionRatio(control.center);
      lines.push(
        `${hue}: action=${ratio.x.toFixed(3)},${ratio.y.toFixed(3)} ` +
          `area=${(control.areaRatio * 100).toFixed(2)}% fill=${control.fill.toFixed(2)}`,
      );
    }
  }
  return lines.join('\n');
}

const RULE = '='.repeat(78);
const MAX_REPORTS_PER_TEST = 2;
const reportsPerTest = new Map<string, number>();

/**
 * Build, print, attach and persist the failure block. Never throws — a broken
 * report must not replace the real test failure.
 */
export async function reportCanvasFailure(
  input: CanvasFailureInput,
): Promise<CanvasFailureReport | undefined> {
  try {
    // A stuck action can miss many times over; the first couple of blocks carry all
    // the diagnostic value and each one costs a screenshot plus a colour scan.
    const testKey = test.info().testId;
    const seen = (reportsPerTest.get(testKey) ?? 0) + 1;
    reportsPerTest.set(testKey, seen);
    if (seen > MAX_REPORTS_PER_TEST) {
      return undefined;
    }

    const orientation = await readOrientation(input.page, input.manifest);
    const session = await readHostSession(input.page);
    const traffic = input.traffic?.entries() ?? [];
    const round = roundTrackerFor(input.page)?.open();
    // Prefer the canvas capture: it reports control positions in the same ratio
    // space as the manifest, so a drifted entry can be read straight off the block.
    const capture = await input.driver?.captureCanvasForVision().catch(() => undefined);
    const blocker =
      capture === undefined || input.driver === undefined
        ? undefined
        : classifyCanvasPng(capture.png, input.driver.surface);
    const verdict = decideVerdict(
      orientation,
      session,
      traffic,
      input.hit,
      input.screenId,
      input.error,
      round,
      blocker,
    );

    const png = capture?.png ?? (await captureGameImage(input.page, input.manifest));
    const scan =
      png === undefined
        ? 'no screenshot available'
        : capture === undefined
          ? `${describeControlScan(png, ['green', 'red'])}\n(ratios are image-relative, not manifest ratios)`
          : describeScanInActionSpace(png, capture.toActionRatio);
    const vision = scan.split('\n').join('\n         ');

    const worker = process.env.SGAP_WORKER_ID ?? '-';
    const label = input.manualTestId ?? test.info().title.split(' ')[0] ?? 'unknown';
    const hit = input.hit;
    const clickLine =
      hit === undefined
        ? 'no canvas tap recorded'
        : `${hit.action} ratio=${hit.ratio.x.toFixed(3)},${hit.ratio.y.toFixed(3)} ` +
          `page=${Math.round(hit.pageX)},${Math.round(hit.pageY)}`;

    const sessionLine = [
      `balance=${session.balance ?? '?'}`,
      `ttl=${session.ttlSeconds ?? '?'}s`,
      `betLimit=${session.betLimitRemaining ?? '?'}`,
    ].join('  ');

    const baseName = `${label}-${input.action}-w${worker}-${Date.now()}`;
    const text = [
      RULE,
      ` SGAP FAILURE  ${label}  ·  action=${input.action}  ·  worker ${worker}`,
      RULE,
      ` CAUSE    ${verdict.cause}`,
      ` REMEDY   ${verdict.remedy}`,
      '',
      ` CLICK    ${clickLine}`,
      ` SCREEN   eye=${input.screenId ?? blocker?.kind ?? 'unclassified'}  frame=${describeOrientation(orientation)}`,
      ` SESSION  ${sessionLine}`,
      ` NETWORK  ${formatTraffic(traffic, hit?.at)}`,
      ` ROUND    ${round === undefined ? 'no open feature round' : describeRound(round)}`,
      ` VISION   ${vision}`,
      ` ERROR    ${errorMessage(input.error)}`,
      RULE,
    ].join('\n');

    const savedTo = persist(baseName, png, text);
    console.log(`${text}\n saved    ${savedTo}`);

    await attachSafe(`failure-${input.action}.txt`, Buffer.from(text, 'utf8'), 'text/plain');
    if (png !== undefined) {
      await attachSafe(`failure-${input.action}.png`, png, 'image/png');
    }

    return { cause: verdict.cause, remedy: verdict.remedy, text, orientation };
  } catch {
    return undefined;
  }
}
