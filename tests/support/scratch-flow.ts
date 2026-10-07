/**
 * Shared steps for the SCG (Scratch Game) specs.
 * Game-agnostic: drawer points, text areas and hub URL come from manifest `scratchCard`.
 */

import type { Page, TestInfo } from '@playwright/test';

import { test, expect } from '../fixtures/index.js';
import type { SgapSession } from '../fixtures/index.js';
import { settleCanvasToBaseGame } from '../../src/platform/index.js';
import type { PlaywrightGameDriver } from '../../src/driver/playwright-game-driver.js';
import type { ScratchCardController } from '../../src/controllers/index.js';
import type { VerificationResult } from '../../src/core/models/index.js';
import type { ScratchRoundSnapshot } from '../../src/network/index.js';
import { listPhaserInteractive, listPhaserTexts } from '../../src/runtime/index.js';
import { findSplashPlay } from './session-guard.js';

export interface ScratchCaseArgs {
  readonly sgapSession: SgapSession;
  readonly sgapDriver: PlaywrightGameDriver;
  readonly page: Page;
  readonly testInfo: TestInfo;
  readonly manualTestId: string;
}

/** Skips when the game has no scratch config; otherwise waits for an idle base game (the hub is awaited on open). */
export async function startScratchCase(args: ScratchCaseArgs): Promise<ScratchCardController> {
  const { sgapSession, sgapDriver, page, testInfo, manualTestId } = args;
  const scratch = sgapSession.scratchCard;
  test.skip(!(await scratch.isAvailable()), `${sgapSession.manifest.gameId} has no scratchCard config`);

  testInfo.annotations.push(
    { type: 'manualTestId', description: manualTestId },
    { type: 'category', description: 'SCG' },
    { type: 'gameId', description: sgapSession.manifest.gameId },
  );

  await sgapDriver.gameCanvas().waitFor({ state: 'visible' });
  await enterScratchHud(page, sgapDriver);
  await settleCanvasToBaseGame(page, sgapDriver, sgapSession.manifest, sgapSession.platform.getInitializeBody());
  return scratch;
}

const HUD_SCRATCH_LABEL = /^scratch$/iu;

/**
 * Waits until the HUD SCRATCH label sits on a live interactive object. The label is
 * already drawn behind the splash, so the label alone does not mean the HUD is up.
 * Until then, taps the largest interactive object (the splash Play button).
 */
export async function enterScratchHud(
  page: Page,
  driver: PlaywrightGameDriver,
  timeoutMs = 120_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let taps = 0;
  let lastSignature = '';
  while (Date.now() < deadline) {
    const texts = await listPhaserTexts(page, driver.iframeSelector).catch(() => []);
    const hits = await listPhaserInteractive(page, driver.iframeSelector).catch(() => []);
    const label = texts.find((hit) => HUD_SCRATCH_LABEL.test(hit.text));
    if (label !== undefined && label.gameWidth > 0) {
      const cx = (label.x + label.width / 2) / label.gameWidth;
      const cy = (label.y + label.height / 2) / label.gameHeight;
      const onButton = hits.some((hit) => {
        const halfW = hit.width / 2 / label.gameWidth;
        const halfH = hit.height / 2 / label.gameHeight;
        return (
          Math.abs(cx - hit.xRatio) <= halfW &&
          Math.abs(cy - hit.yRatio) <= halfH &&
          halfW * halfH * 4 < 0.1
        );
      });
      if (onButton) {
        return;
      }
    }
    const splash = findSplashPlay(hits);
    // A HUD still initialising also exposes only a few objects (spin first), so tap only once
    // the same candidate has survived a full poll; a real splash waits for the player.
    const signature =
      splash === undefined ? '' : `${hits.length}:${splash.xRatio.toFixed(3)},${splash.yRatio.toFixed(3)}`;
    const stable = signature !== '' && signature === lastSignature;
    lastSignature = signature;
    if (splash !== undefined && stable) {
      taps += 1;
      console.log(`[scg] splash tap ${taps} at ${splash.xRatio.toFixed(3)},${splash.yRatio.toFixed(3)}`);
      await driver.clickCanvasAt({ x: splash.xRatio, y: splash.yRatio }, { label: 'splash-play', strategy: 'phaser' });
    }
    await page.waitForTimeout(2_500);
  }
  throw new Error(`HUD SCRATCH button did not become interactive within ${timeoutMs / 1000}s`);
}

/** Attaches the checks to the report, then fails on the first one that did not pass. */
export async function expectChecks(
  testInfo: TestInfo,
  results: readonly VerificationResult[],
): Promise<void> {
  await testInfo.attach('scratch-checks.json', {
    body: JSON.stringify(results, null, 2),
    contentType: 'application/json',
  });
  for (const result of results) {
    console.log(`[scg] ${result.passed ? 'PASS' : 'FAIL'} ${result.message}`);
  }
  for (const result of results) {
    expect(result.passed, result.message).toBe(true);
  }
}

export function scratchCheck(
  passed: boolean,
  message: string,
  expected?: unknown,
  actual?: unknown,
): VerificationResult {
  return { kind: 'stateManagement', passed, message, expected, actual };
}

export async function attachRound(testInfo: TestInfo, name: string, round: ScratchRoundSnapshot): Promise<void> {
  await testInfo.attach(name, {
    body: JSON.stringify({ requestArgs: round.requestArgs, response: round.raw }, null, 2),
    contentType: 'application/json',
  });
}

export async function attachDrawer(testInfo: TestInfo, scratch: ScratchCardController, name: string): Promise<void> {
  await testInfo.attach(name, { body: await scratch.screenshotDrawer(), contentType: 'image/png' });
}

export interface DrawerAmount {
  /** Currency marker as drawn: a symbol (`$`) or an ISO code (`USD`). */
  readonly marker: string;
  readonly amount: number;
  readonly text: string;
}

/** Parses the drawer bet label (`$1.00`, `USD 1.00`, `1.00 USD`). */
export function parseDrawerAmount(texts: readonly string[]): DrawerAmount | undefined {
  const text = texts.join(' ').trim();
  const match = text.match(/^([^\d\s.,-]*)\s*([\d,]+(?:\.\d+)?)\s*([A-Z]{3})?$/u);
  if (match === null || match[2] === undefined) {
    return undefined;
  }
  const amount = Number(match[2].replace(/,/gu, ''));
  if (!Number.isFinite(amount)) {
    return undefined;
  }
  return { marker: (match[1] || match[3] || '').trim(), amount, text };
}

export async function readDrawerBet(scratch: ScratchCardController): Promise<DrawerAmount | undefined> {
  return parseDrawerAmount(await scratch.readTextArea('betValue'));
}

const SYMBOL_TO_CODE: Readonly<Record<string, string>> = {
  $: 'USD',
  '€': 'EUR',
  '£': 'GBP',
  '₩': 'KRW',
  '¥': 'JPY',
  R: 'ZAR',
  DT: 'TND',
};

/** ISO code for a drawn currency marker (`$` → USD, `USD` → USD). */
export function currencyCodeOf(marker: string): string | undefined {
  if (/^[A-Z]{3}$/u.test(marker)) {
    return marker;
  }
  return SYMBOL_TO_CODE[marker];
}

/** ISO currency codes painted on the slot HUD (BALANCE / BET / BUY labels), outside the drawer. */
export async function slotHudCurrencies(page: Page, iframeSelector: string): Promise<readonly string[]> {
  const texts = await listPhaserTexts(page, iframeSelector);
  const codes = texts
    .map((hit) => hit.text.replace(/[()]/gu, '').trim())
    .filter((text) => /^(USD|EUR|GBP|KRW|JPY|CNY|ZAR|TND|PHP|INR|BRL|THB|IDR|VND|MYR)$/u.test(text));
  return [...new Set(codes)];
}

/** Numeric value painted right under the HUD `BALANCE` label. */
export async function slotHudBalance(page: Page, iframeSelector: string): Promise<number | undefined> {
  const texts = await listPhaserTexts(page, iframeSelector);
  const label = texts.find((hit) => hit.text.toUpperCase() === 'BALANCE');
  if (label === undefined) {
    return undefined;
  }
  const value = texts
    .filter((hit) => /^[\d,]+\.\d{2}$/u.test(hit.text) && hit.y > label.y && hit.y - label.y < 40)
    .sort((a, b) => Math.abs(a.x - label.x) - Math.abs(b.x - label.x))[0];
  return value !== undefined ? Number(value.text.replace(/,/gu, '')) : undefined;
}

/** `×N` / `+×N` legend labels currently drawn. */
export async function readLegend(scratch: ScratchCardController): Promise<readonly string[]> {
  return (await scratch.readTextArea('legend')).filter((text) => /^\+?×\d+(?:\.\d+)?$/u.test(text));
}

/** Taps bet − until the drawn bet stops changing; returns the floor it settled on. */
export async function walkBetToMinimum(scratch: ScratchCardController, maxTaps = 30): Promise<DrawerAmount> {
  let current = await readDrawerBet(scratch);
  for (let tap = 0; tap < maxTaps; tap += 1) {
    await scratch.adjustBet('minus');
    const next = await readDrawerBet(scratch);
    if (next !== undefined && current !== undefined && next.amount === current.amount) {
      return next;
    }
    current = next;
  }
  if (current === undefined) {
    throw new Error('Drawer bet label is not readable');
  }
  return current;
}

export function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/** BUY CARD then SCRATCH ALL — leaves no card open on the hub. */
export async function buyAndScratchAll(
  scratch: ScratchCardController,
): Promise<{ readonly started: ScratchRoundSnapshot; readonly settled: ScratchRoundSnapshot }> {
  const started = await scratch.buyCard();
  const settled = await scratch.scratchAll();
  return { started, settled };
}
