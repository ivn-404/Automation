/**
 * SGAP Eye — classify the current screen, recover interfering modals, then
 * stop. Does not spray nearby canvas taps.
 *
 * Detection order: host text → session TTL → golden PNG templates → idle.
 * Policies come from assets/eye/catalog.json.
 */

import { readFileSync } from 'node:fs';

import type { Locator, Page } from 'playwright';

import type { GameManifest } from '../core/models/index.js';
import { clickHostWithIndicator } from '../driver/click-tracker.js';
import type { PlaywrightGameDriver } from '../driver/playwright-game-driver.js';
import type { PlaywrightPlatform } from '../platform/playwright-platform.js';
import { HIDE_SCREENSHOT_TOAST } from '../platform/stable-screenshot.js';
import { cropImage, decodePng, resizeNearest, type RgbaImage } from '../verification/reel/image-match.js';
import { loadEyeCatalog } from './catalog.js';
import {
  closeBuyPanel,
  detectCanvasBlocker,
  dismissCanvasBlocker,
  isDismissableBlocker,
} from './canvas-blocker.js';
import {
  debugCapturePath,
  listGoldenPaths,
  saveGoldenIfMissing,
  savePng,
} from './store.js';
import type { EyeIntent, EyeObservation, EyeScreenDefinition } from './types.js';

export function isEyeEnabled(): boolean {
  const value = process.env.SGAP_EYE?.trim().toLowerCase();
  if (value === '0' || value === 'false' || value === 'no') {
    return false;
  }
  return true;
}

function log(message: string): void {
  console.log(`[sgap-eye] ${message}`);
}

async function visibleText(root: Page | Locator, pattern: RegExp): Promise<boolean> {
  return root.getByText(pattern).first().isVisible().catch(() => false);
}

async function hostOrFrameHasText(page: Page, pattern: RegExp): Promise<boolean> {
  return visibleText(page, pattern);
}

function compilePatterns(raw: readonly string[] | undefined): RegExp[] {
  if (raw === undefined) {
    return [];
  }
  return raw.map((entry) => new RegExp(entry, 'i'));
}

async function isSetUserDialog(page: Page): Promise<boolean> {
  return page.getByRole('textbox', { name: 'e.g. player-123' }).isVisible().catch(() => false);
}

async function sessionTtlExpired(page: Page): Promise<boolean> {
  const labels = [
    page.getByText(/TTL:\s*0s\b/i),
    page.getByText(/Session:\s*0s\b/i),
    page.getByText(/session expired/i),
  ];
  for (const label of labels) {
    if (await label.first().isVisible().catch(() => false)) {
      return true;
    }
  }
  return false;
}

function cropModalRegion(image: RgbaImage): RgbaImage {
  const width = Math.max(8, Math.floor(image.width * 0.42));
  const height = Math.max(8, Math.floor(image.height * 0.58));
  const x = Math.floor((image.width - width) / 2);
  const y = Math.floor(image.height * 0.18);
  return cropImage(image, x, y, width, height);
}

function screenMatchScore(candidate: RgbaImage, template: RgbaImage): number {
  const a = resizeNearest(candidate, 40, 72);
  const b = resizeNearest(template, 40, 72);
  let sum = 0;
  let count = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    sum +=
      Math.abs(a.data[i]! - b.data[i]!) +
      Math.abs(a.data[i + 1]! - b.data[i + 1]!) +
      Math.abs(a.data[i + 2]! - b.data[i + 2]!);
    count += 1;
  }
  if (count === 0) {
    return 0;
  }
  return Math.max(0, 1 - sum / (count * 255 * 3));
}

async function capturePagePng(page: Page): Promise<Buffer | undefined> {
  return page.screenshot({ type: 'png', style: HIDE_SCREENSHOT_TOAST }).catch(() => undefined);
}

async function matchTemplates(
  png: Buffer,
  scenarioId: string,
  minScore: number,
): Promise<number | undefined> {
  const goldens = listGoldenPaths(scenarioId);
  if (goldens.length === 0) {
    return undefined;
  }
  let candidate: RgbaImage;
  try {
    candidate = cropModalRegion(decodePng(png));
  } catch {
    return undefined;
  }
  let best = 0;
  for (const filePath of goldens) {
    try {
      const template = cropModalRegion(decodePng(readFileSync(filePath)));
      const { score } = { score: screenMatchScore(candidate, template) };
      if (score > best) {
        best = score;
      }
    } catch {
      // skip unreadable golden
    }
  }
  return best >= minScore ? best : undefined;
}

function neverClickName(name: string, blocked: readonly string[] | undefined): boolean {
  const lower = name.trim().toLowerCase();
  if (lower === 'close' || lower === 'update' || lower.includes('play in modal')) {
    return true;
  }
  return (blocked ?? []).some((entry) => entry.toLowerCase() === lower);
}

async function clickHostPolicyButton(
  page: Page,
  screen: EyeScreenDefinition,
): Promise<boolean> {
  const names = screen.hostButtons ?? [];
  for (const name of names) {
    if (neverClickName(name, screen.neverClick)) {
      continue;
    }
    const button = page.getByRole('button', { name: new RegExp(`^${name}$`, 'i') }).first();
    if (!(await button.isVisible().catch(() => false))) {
      continue;
    }
    const label = (await button.textContent().catch(() => name)) ?? name;
    if (neverClickName(label, screen.neverClick)) {
      continue;
    }
    await clickHostWithIndicator(page, button, { timeout: 8_000, force: true }, `eye-${screen.id}`);
    return true;
  }

  const loose = page.getByRole('button').filter({ hasText: /^(continue|ok|resume|play|extend)$/i });
  const count = await loose.count().catch(() => 0);
  for (let i = 0; i < count; i += 1) {
    const button = loose.nth(i);
    if (!(await button.isVisible().catch(() => false))) {
      continue;
    }
    const label = ((await button.textContent().catch(() => '')) ?? '').trim();
    if (label.length === 0 || neverClickName(label, screen.neverClick)) {
      continue;
    }
    await clickHostWithIndicator(page, button, { timeout: 8_000, force: true }, `eye-${screen.id}`);
    return true;
  }
  return false;
}

async function clickCanvasOnce(
  driver: PlaywrightGameDriver,
  manifest: GameManifest,
  screen: EyeScreenDefinition,
): Promise<boolean> {
  const actions = screen.canvasActions ?? [];
  for (const actionName of actions) {
    if (neverClickName(actionName, screen.neverClick)) {
      continue;
    }
    if (manifest.canvasActions?.actions[actionName] === undefined) {
      continue;
    }
    await driver.clickCanvas(actionName, { timeoutMs: 8_000, singleInput: true }).catch(() => undefined);
    return true;
  }
  return false;
}

async function restartSession(
  page: Page,
  driver: PlaywrightGameDriver,
  platform: PlaywrightPlatform | undefined,
): Promise<boolean> {
  const extend = page.getByRole('button', { name: /^Extend$/i }).first();
  if (await extend.isVisible().catch(() => false)) {
    await clickHostWithIndicator(page, extend, { timeout: 8_000, force: true }, 'eye-extend');
    log('session-timeout → Extend');
    return true;
  }
  if (platform === undefined) {
    log('session-timeout → no platform to reopen Play');
    return false;
  }
  log('session-timeout → reopen game');
  await platform.openGame({ timeoutMs: 90_000 });
  await platform.prepareActiveGameView({ timeoutMs: 90_000 });
  await driver.attach();
  return true;
}

async function archiveObservation(
  page: Page,
  screen: EyeScreenDefinition,
  gameId: string,
  via: EyeObservation['via'],
): Promise<void> {
  const png = await capturePagePng(page);
  if (png === undefined) {
    return;
  }
  savePng(debugCapturePath(screen.id, gameId), png);
  if (via === 'host-text' || via === 'ttl') {
    const golden = saveGoldenIfMissing(screen.id, gameId, png);
    if (golden !== undefined) {
      log(`saved golden ${screen.id}/${gameId}.png`);
    }
  }
}

async function detectScreen(
  page: Page,
  allowTemplates: boolean,
): Promise<{ screen: EyeScreenDefinition; via: EyeObservation['via']; score?: number }> {
  const catalog = loadEyeCatalog();

  if (await sessionTtlExpired(page)) {
    const timeout = catalog.screens.find((screen) => screen.id === 'session-timeout');
    if (timeout !== undefined) {
      return { screen: timeout, via: 'ttl' };
    }
  }

  for (const screen of catalog.screens) {
    if (screen.id === 'base-idle') {
      continue;
    }
    if (screen.id === 'host-continue' && (await isSetUserDialog(page))) {
      continue;
    }
    for (const pattern of compilePatterns(screen.hostPatterns)) {
      if (await hostOrFrameHasText(page, pattern)) {
        return { screen, via: 'host-text' };
      }
    }
  }

  if (allowTemplates) {
    const png = await capturePagePng(page);
    if (png !== undefined) {
      for (const screen of catalog.screens) {
        if (screen.id === 'base-idle' || screen.layer !== 'canvas') {
          continue;
        }
        const score = await matchTemplates(png, screen.id, catalog.templateMatchMinScore);
        if (score !== undefined) {
          return { screen, via: 'template', score };
        }
      }
    }
  }

  const idle = catalog.screens.find((screen) => screen.id === 'base-idle');
  if (idle === undefined) {
    throw new Error('assets/eye/catalog.json is missing base-idle');
  }
  return { screen: idle, via: 'idle' };
}

export function isReadyForIntent(screen: EyeScreenDefinition, intent: EyeIntent): boolean {
  const ready = screen.readyFor ?? [];
  if (screen.id === 'base-idle') {
    return true;
  }
  return ready.includes(intent);
}

async function applyPolicy(
  page: Page,
  driver: PlaywrightGameDriver,
  manifest: GameManifest,
  platform: PlaywrightPlatform | undefined,
  screen: EyeScreenDefinition,
  intent: EyeIntent,
): Promise<boolean> {
  if (screen.id === 'buy-panel' && intent !== 'buyFeature') {
    return closeBuyPanel(driver);
  }
  if (screen.policy === 'leave') {
    return false;
  }
  if (screen.policy === 'restartSession') {
    return restartSession(page, driver, platform);
  }
  const hostClicked = await clickHostPolicyButton(page, screen);
  if (hostClicked) {
    return true;
  }
  if (screen.policy === 'continue' || screen.policy === 'dismiss') {
    // Canvas-drawn Continue / press-anywhere — host getByRole never sees these.
    const vision = await dismissCanvasBlocker(driver, manifest);
    if (vision.dismissed) {
      log(`${screen.id} → vision ${vision.kind}`);
      return true;
    }
    return clickCanvasOnce(driver, manifest, screen);
  }
  return false;
}

export interface ClearInterferingScreensOptions {
  readonly page: Page;
  readonly driver: PlaywrightGameDriver;
  readonly manifest: GameManifest;
  readonly platform?: PlaywrightPlatform;
  readonly intent?: EyeIntent;
  readonly maxPasses?: number;
  /** PNG templates name the screen (buy-panel, win-dialogue). Used on the
   *  pre-click gate and on miss recovery — never as a test pass. */
  readonly allowTemplates?: boolean;
}

/**
 * Gate in front of an intent click. Recovers session-timeout / ongoing-round /
 * host Continue, then returns. Unknown blockers are snapshotted and left alone
 * (no nearby-tap spray).
 */
export async function clearInterferingScreens(
  options: ClearInterferingScreensOptions,
): Promise<EyeObservation> {
  if (!isEyeEnabled()) {
    return { screenId: 'base-idle', policy: 'leave', via: 'idle', handled: false };
  }

  const catalog = loadEyeCatalog();
  const intent = options.intent ?? 'idle';
  const maxPasses = options.maxPasses ?? catalog.maxRecoveryPasses;
  const allowTemplates = options.allowTemplates === true;
  const gameId = options.manifest.gameId;
  let last: EyeObservation = { screenId: 'base-idle', policy: 'leave', via: 'idle', handled: false };

  for (let pass = 1; pass <= maxPasses; pass += 1) {
    const { screen, via, score } = await detectScreen(options.page, allowTemplates);
    last = { screenId: screen.id, policy: screen.policy, via, score, handled: false };

    // Canvas-drawn session Continue is invisible to getByText — detect via colour.
    if (screen.id === 'base-idle' || via === 'idle') {
      const blocker = await detectCanvasBlocker(options.driver);
      if (isDismissableBlocker(blocker.kind)) {
        const dismissed = await dismissCanvasBlocker(
          options.driver,
          options.manifest,
          blocker,
        );
        if (dismissed.dismissed) {
          last = {
            screenId: 'ongoing-spin-round',
            policy: 'continue',
            via: 'template',
            handled: true,
          };
          log(`ongoing-spin-round via=vision kind=${blocker.kind} handled=true intent=${intent}`);
          await options.page.waitForTimeout(500);
          continue;
        }
      }
    }

    if (isReadyForIntent(screen, intent) && screen.policy === 'leave') {
      return last;
    }
    if (isReadyForIntent(screen, intent) && screen.id !== 'ongoing-spin-round') {
      return last;
    }

    if (via === 'host-text' || via === 'ttl' || via === 'template') {
      await archiveObservation(options.page, screen, gameId, via);
    }
    const handled = await applyPolicy(
      options.page,
      options.driver,
      options.manifest,
      options.platform,
      screen,
      intent,
    );
    last = { ...last, handled };
    log(`${screen.id} via=${via}${score !== undefined ? ` score=${score.toFixed(2)}` : ''} policy=${screen.policy} handled=${handled} intent=${intent}`);

    if (!handled) {
      if (screen.policy === 'leave') {
        return last;
      }
      const unknown = await capturePagePng(options.page);
      if (unknown !== undefined) {
        savePng(debugCapturePath('unknown', gameId), unknown);
      }
      return last;
    }

    await options.page.waitForTimeout(500);
  }

  // A vision dismiss on the final pass leaves `last` naming a blocker that is
  // already gone (transition frames read as press-anywhere) — look once more.
  if (last.screenId === 'ongoing-spin-round' && last.handled) {
    const { screen, via } = await detectScreen(options.page, allowTemplates);
    if (screen.id === 'base-idle') {
      const blocker = await detectCanvasBlocker(options.driver);
      if (blocker.kind === 'none') {
        return { screenId: screen.id, policy: screen.policy, via, handled: true };
      }
    }
  }

  return last;
}

export function intentFromAction(actionName: string): EyeIntent {
  if (actionName.startsWith('buyFeature')) {
    return 'buyFeature';
  }
  if (actionName === 'spin' || actionName === 'enter') {
    return 'spin';
  }
  if (actionName.startsWith('bet') || actionName === 'betPlus' || actionName === 'betMinus') {
    return 'bet';
  }
  if (actionName.startsWith('autoplay')) {
    return 'autoplay';
  }
  return 'idle';
}
