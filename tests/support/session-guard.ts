/**
 * Helpers for account-session cases (AT-004 / AT-005) and on-screen text checks.
 *
 * A second tab in the same browser context logs in as the same launcher player,
 * so it is a second session on the same account.
 */

import type { Page, Request, Response } from 'playwright';

import type { PlaywrightGameDriver } from '../../src/driver/playwright-game-driver.js';
import { PlaywrightPlatform } from '../../src/platform/index.js';
import {
  listPhaserInteractive,
  listPhaserTexts,
  type PhaserHit,
  type PhaserTextHit,
} from '../../src/runtime/phaser-locate.js';
import { getByPath } from '../../src/shared/json-path.js';
import type { SgapSession } from '../fixtures/index.js';
import { prepareCanvasSpin } from './canvas-bet-control.js';
import { matchesBuyUrl, matchesUrlPattern } from '../../src/network/bet-url.js';

export interface SecondSession {
  readonly page: Page;
  readonly platform: PlaywrightPlatform;
  readonly initializeBody: unknown;
  close(): Promise<void>;
}

/** Opens the same game for the same player in a new tab and waits for its initialize. */
export async function openSecondSession(sgapSession: SgapSession, page: Page): Promise<SecondSession> {
  const page2 = await page.context().newPage();
  const platform = new PlaywrightPlatform({
    page: page2,
    environment: sgapSession.environment,
    manifest: sgapSession.manifest,
    ui: sgapSession.ui,
  });
  await platform.openGameHost();
  await platform.openGame();
  return {
    page: page2,
    platform,
    initializeBody: platform.getInitializeBody(),
    async close() {
      await platform.dispose().catch(() => undefined);
      await page2.close().catch(() => undefined);
    },
  };
}

export function sessionIdOf(initializeBody: unknown): string | undefined {
  const value = getByPath(initializeBody, 'data.sessionId') ?? getByPath(initializeBody, 'sessionId');
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

export function playerIdOf(initializeBody: unknown): string | undefined {
  const value = getByPath(initializeBody, 'data.playerId') ?? getByPath(initializeBody, 'playerId');
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

export interface CapturedCall {
  readonly status: number;
  readonly url: string;
  readonly body: unknown;
  readonly isBuy: boolean;
  /** Bet-shaping fields of the request (no session tokens). */
  readonly request: { readonly action?: unknown; readonly bet?: unknown; readonly buyFeat?: unknown };
}

/** Token-free view of captured calls, safe to attach to the report. */
export function summarizeCalls(calls: readonly CapturedCall[]): unknown[] {
  return calls.map((call) => {
    const body = (call.body ?? {}) as Record<string, unknown>;
    return {
      status: call.status,
      path: new URL(call.url).pathname,
      isBuy: call.isBuy,
      request: call.request,
      transactionState: body.transactionState,
      balance: body.balance,
      errorCode: body.errorCode ?? body.code,
      message: body.message,
    };
  });
}

function requestShape(request: Request): CapturedCall['request'] {
  let data: Record<string, unknown> = {};
  try {
    data = (request.postDataJSON() ?? {}) as Record<string, unknown>;
  } catch {
    data = {};
  }
  return { action: data.action, bet: data.bet ?? data.amount, buyFeat: data.buyFeat };
}

/** Records every bet/buy call on the page, whatever status the server returns. */
export function captureBetCalls(
  page: Page,
  sgapSession: SgapSession,
  isBuy: (request: Request) => boolean,
): { readonly calls: CapturedCall[]; stop(): void } {
  const calls: CapturedCall[] = [];
  const betPattern = sgapSession.manifest.network?.betUrlPattern ?? '**/api/v1/slots/bet';
  const onResponse = (response: Response): void => {
    const url = response.url();
    if (!matchesUrlPattern(url, betPattern) && !matchesBuyUrl(url)) {
      return;
    }
    void response
      .json()
      .catch(() => undefined)
      .then((body) => {
        calls.push({
          status: response.status(),
          url,
          body,
          isBuy: isBuy(response.request()),
          request: requestShape(response.request()),
        });
      });
  };
  page.on('response', onResponse);
  return {
    calls,
    stop() {
      page.off('response', onResponse);
    },
  };
}

/** First on-screen Phaser text matching `pattern` within the window, or undefined. */
export async function waitForPhaserText(
  page: Page,
  iframeSelector: string,
  pattern: RegExp,
  timeoutMs: number,
): Promise<PhaserTextHit | undefined> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const hits = await listPhaserTexts(page, iframeSelector).catch(() => []);
    const hit = hits.find((entry) => pattern.test(entry.text));
    if (hit !== undefined) {
      return hit;
    }
    await page.waitForTimeout(400);
  }
  return undefined;
}

/**
 * What DOM element inside the game frame paints over the centre of `hit`, or `undefined`
 * when the topmost painting element there is a canvas. Transparent layers (click catchers,
 * faded-out loaders) don't count as covering.
 */
export async function phaserTextCover(
  page: Page,
  iframeSelector: string,
  hit: PhaserTextHit,
): Promise<string | undefined> {
  const frame = page.frameLocator(iframeSelector);
  const rx = (hit.x + hit.width / 2) / hit.gameWidth;
  const ry = (hit.y + hit.height / 2) / hit.gameHeight;
  return frame
    .locator('body')
    .evaluate(
      (body, ratio) => {
        type Box = { left: number; top: number; width: number; height: number };
        type Node = {
          tagName: string;
          id: string;
          className: unknown;
          getBoundingClientRect(): Box;
          childNodes: ArrayLike<{ nodeType: number; textContent: string | null }>;
        };
        type Style = { opacity: string; visibility: string; backgroundColor: string; backgroundImage: string };
        const doc = body.ownerDocument as unknown as {
          querySelectorAll(selector: string): ArrayLike<Node>;
          elementsFromPoint(x: number, y: number): Node[];
          defaultView: { getComputedStyle(element: Node): Style };
        };
        const canvas = Array.from(doc.querySelectorAll('canvas'))
          .map((element) => ({ element, rect: element.getBoundingClientRect() }))
          .sort((a, b) => b.rect.width * b.rect.height - a.rect.width * a.rect.height)[0];
        if (canvas === undefined || canvas.rect.width === 0) {
          return 'no game canvas';
        }
        const x = canvas.rect.left + canvas.rect.width * ratio.rx;
        const y = canvas.rect.top + canvas.rect.height * ratio.ry;
        const transparent = (color: string): boolean =>
          color === 'transparent' || /rgba\([^)]*,\s*0(?:\.0+)?\)$/u.test(color);
        for (const element of doc.elementsFromPoint(x, y)) {
          const tag = element.tagName.toLowerCase();
          if (tag === 'canvas') {
            return undefined;
          }
          if (tag === 'html' || tag === 'body') {
            continue;
          }
          const style = doc.defaultView.getComputedStyle(element);
          const hasText = Array.from(element.childNodes).some(
            (child) => child.nodeType === 3 && (child.textContent ?? '').trim() !== '',
          );
          const paints =
            Number(style.opacity) > 0.05 &&
            style.visibility !== 'hidden' &&
            (!transparent(style.backgroundColor) ||
              style.backgroundImage !== 'none' ||
              ['img', 'video', 'svg'].includes(tag) ||
              hasText);
          if (paints) {
            const cls = typeof element.className === 'string' && element.className ? `.${element.className.split(/\s+/u)[0]}` : '';
            return `${tag}${element.id ? `#${element.id}` : ''}${cls}`;
          }
        }
        return 'nothing at the text position';
      },
      { rx, ry },
    )
    .catch((error: unknown) => `frame not readable (${String(error).slice(0, 80)})`);
}

/** First matching Phaser text that is also not covered by a DOM loader/overlay. */
export async function waitForVisiblePhaserText(
  page: Page,
  iframeSelector: string,
  pattern: RegExp,
  timeoutMs: number,
): Promise<{ readonly hit?: PhaserTextHit; readonly uncovered: boolean; readonly coveredBy?: string }> {
  const deadline = Date.now() + timeoutMs;
  let last: PhaserTextHit | undefined;
  let coveredBy: string | undefined;
  while (Date.now() < deadline) {
    const hits = await listPhaserTexts(page, iframeSelector).catch(() => []);
    last = hits.find((entry) => pattern.test(entry.text) && entry.gameWidth > 0 && entry.gameHeight > 0) ?? last;
    if (last !== undefined) {
      coveredBy = await phaserTextCover(page, iframeSelector, last);
      if (coveredBy === undefined) {
        return { hit: last, uncovered: true };
      }
    }
    await page.waitForTimeout(400);
  }
  return { hit: last, uncovered: false, coveredBy };
}

const HUD_BALANCE_LABEL = /^BALANCE$/iu;
const MAX_SPLASH_INTERACTIVE = 3;
const SPLASH_MIN_Y = 0.1;

/**
 * The splash Play button, when the scene looks like a splash: a splash has one to three
 * interactive objects, a live HUD has many (tapping its largest would spin). The top
 * strip holds the fullscreen toggle, which flips the game to landscape.
 */
export function findSplashPlay(hits: readonly PhaserHit[]): PhaserHit | undefined {
  if (hits.length > MAX_SPLASH_INTERACTIVE) {
    return undefined;
  }
  return hits.filter((hit) => hit.yRatio >= SPLASH_MIN_Y).sort((a, b) => b.area - a.area)[0];
}

/**
 * Taps the splash Play until the scene exposes a full HUD. A HUD still initialising also
 * exposes only a few objects, so a candidate is tapped only after surviving a full poll.
 */
async function tapThroughSplash(page: Page, driver: PlaywrightGameDriver, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastSignature = '';
  while (Date.now() < deadline) {
    const hits = await listPhaserInteractive(page, driver.iframeSelector).catch(() => []);
    if (hits.length > MAX_SPLASH_INTERACTIVE) {
      return;
    }
    const splash = findSplashPlay(hits);
    const signature =
      splash === undefined ? '' : `${hits.length}:${splash.xRatio.toFixed(3)},${splash.yRatio.toFixed(3)}`;
    if (splash !== undefined && signature === lastSignature) {
      console.log(`[sgap-heal] splash: tapped Play at ${splash.xRatio.toFixed(3)},${splash.yRatio.toFixed(3)}`);
      await driver.clickCanvasAt({ x: splash.xRatio, y: splash.yRatio }, { label: 'splash-play', strategy: 'phaser' });
    }
    lastSignature = signature;
    await page.waitForTimeout(2_500);
  }
}

/** Gets past the splash so the base-game HUD (BALANCE / BET labels) is painted. */
export async function ensureBaseHud(
  sgapSession: SgapSession,
  driver: PlaywrightGameDriver,
  page: Page,
): Promise<boolean> {
  await tapThroughSplash(page, driver, 60_000);
  if ((await waitForPhaserText(page, driver.iframeSelector, HUD_BALANCE_LABEL, 5_000)) !== undefined) {
    return true;
  }
  await prepareCanvasSpin(sgapSession, driver, page);
  return (await waitForPhaserText(page, driver.iframeSelector, HUD_BALANCE_LABEL, 15_000)) !== undefined;
}

/** Taps the centre of the first on-screen Phaser text matching `pattern`. Returns false if none is shown. */
export async function clickPhaserText(
  page: Page,
  driver: PlaywrightGameDriver,
  pattern: RegExp,
  label: string,
): Promise<boolean> {
  const hits = await listPhaserTexts(page, driver.iframeSelector).catch(() => []);
  const hit = hits.find((entry) => pattern.test(entry.text) && entry.gameWidth > 0 && entry.gameHeight > 0);
  if (hit === undefined) {
    return false;
  }
  await driver.clickCanvasAt(
    { x: (hit.x + hit.width / 2) / hit.gameWidth, y: (hit.y + hit.height / 2) / hit.gameHeight },
    { timeoutMs: 8_000, singleInput: true, label, strategy: 'phaser' },
  );
  return true;
}

/** Closes a server-error dialog by its own OK / Close label, polling until the label is gone. */
export async function dismissErrorDialog(page: Page, driver: PlaywrightGameDriver, timeoutMs = 15_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const clicked = await clickPhaserText(page, driver, /^(OK|CLOSE|CONTINUE)$/iu, 'errorOk');
    if (!clicked) {
      return true;
    }
    await page.waitForTimeout(800);
  }
  return false;
}

/** "Session is not active" style message painted by the game after the server rejects a call. */
export const SESSION_INACTIVE_TEXT = /session (is )?not active|session expired|logged in (from )?(another|elsewhere)/iu;
