/**
 * DiJoker launcher helpers — host-page balance Update control.
 *
 * The sandbox chrome above the game shows:
 *   Balance: 19,832.55   [Update]
 * BF-004 / ES-005 set this to 100 USD (see config/parallel-workers.json minimumBetBalance).
 * Parallel lanes set 15,000 USD by default; do not force 100 on every test.
 *
 * Mid-session updates must close Play-in-modal first. The overlay covers host
 * chrome; force-clicking Update while it is up does not reach the button.
 */

import type { Dialog, Locator, Page } from 'playwright';

import type { GameManifest } from '../../src/core/models/index.js';
import { clickHostWithIndicator } from '../../src/driver/click-tracker.js';
import type { PlaywrightGameDriver } from '../../src/driver/playwright-game-driver.js';
import { logGameSurface, primeCanvasSession } from '../../src/platform/index.js';
import type { PlaywrightPlatform } from '../../src/platform/playwright-platform.js';
import { skipWithoutLauncher } from './launch-url.js';

/** Default sandbox wallet after low-balance tests — keeps later specs able to buy/spin. */
export const STAGING_DEFAULT_WALLET = 20_000;

/** Host chrome "Bet limit" — session wager cap. Staging suites always use 15,000. */
export const STAGING_DEFAULT_BET_LIMIT = 15_000;

export const PLAY_OVERLAY_NOT_DISMISSED = 'PLAY_OVERLAY_NOT_DISMISSED';
export const BALANCE_UPDATE_NOT_FOUND = 'BALANCE_UPDATE_NOT_FOUND';
export const WALLET_DIALOG_NOT_VISIBLE = 'WALLET_DIALOG_NOT_VISIBLE';
export const LAUNCHER_BALANCE_NOT_UPDATED = 'LAUNCHER_BALANCE_NOT_UPDATED';
export const PLAYABLE_IFRAME_HUD_OUT_OF_VIEW = 'PLAYABLE_IFRAME_HUD_OUT_OF_VIEW';

const OVERLAY_TIMEOUT_MS = 8_000;

/** Play-in-modal only — must contain the game-session iframe, not Set user / wallet / bet-limit. */
function playOverlay(page: Page): Locator {
  return page.locator('div.fixed.inset-0.z-50').filter({
    has: page.locator('iframe[title="Game session"]'),
  });
}

/** Wallet dialog — copy + confirm, and never the game-session iframe. */
function walletDialog(page: Page): Locator {
  return page
    .locator('div.fixed.inset-0.z-50')
    .filter({ has: page.getByText(/Enter a new balance/i) })
    .filter({ has: page.getByRole('button', { name: 'Update wallet' }) })
    .filter({ hasNot: page.locator('iframe[title="Game session"]') });
}

/**
 * Balance-row Update only. Innermost div that has a Balance: <amount> label
 * and an Update button, excluding the Bet-limit row.
 */
function balanceUpdateButton(page: Page): Locator {
  const row = page
    .locator('div')
    .filter({ has: page.getByText(/Balance:\s*[\d,]+(?:\.\d+)?/i) })
    .filter({ has: page.getByRole('button', { name: 'Update', exact: true }) })
    .filter({ hasNot: page.getByText(/Bet limit/i) });
  return row.last().getByRole('button', { name: 'Update', exact: true });
}

function hostBalancePattern(amount: number): RegExp {
  const [whole, frac = '00'] = Math.abs(amount).toFixed(2).split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/gu, ',');
  const number = grouped === whole ? whole : `(?:${grouped}|${whole})`;
  if (frac === '00') {
    return new RegExp(`Balance:\\s*${number}(?:\\.00)?(?![\\d.])`, 'i');
  }
  return new RegExp(`Balance:\\s*${number}\\.${frac}(?!\\d)`, 'i');
}

/**
 * Close the Play-in-modal overlay so host chrome (Balance Update) is clickable.
 * Does not touch wallet, Set user, or bet-limit dialogs (those have no game iframe).
 */
async function dismissGameModal(page: Page, timeoutMs = OVERLAY_TIMEOUT_MS): Promise<void> {
  const overlay = playOverlay(page);
  const visible = await overlay.isVisible().catch(() => false);
  console.log(`[sgap-wallet] overlay=${visible ? 'visible' : 'absent'} iframe=Game session`);
  if (!visible) {
    return;
  }

  const closeButton = overlay.getByRole('button', { name: /^close$/i });
  const backdrop = overlay.locator('[role="button"].absolute.inset-0');
  const closeVisible = await closeButton.isVisible().catch(() => false);
  const backdropVisible = await backdrop.isVisible().catch(() => false);

  let via = 'unknown';
  try {
    if (closeVisible) {
      via = 'close-button';
      await clickHostWithIndicator(page, closeButton, { timeout: timeoutMs }, 'dismiss-play-overlay');
    } else if (backdropVisible) {
      via = 'backdrop-top-left';
      await clickHostWithIndicator(
        page,
        backdrop.first(),
        { timeout: timeoutMs, position: { x: 8, y: 8 } },
        'dismiss-play-overlay',
      );
    } else {
      via = 'escape';
      await page.keyboard.press('Escape');
    }
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`${PLAY_OVERLAY_NOT_DISMISSED}: close control not actionable (${via ?? 'unknown'}). ${detail}`);
  }

  console.log(`[sgap-wallet] dismiss via=${via}`);

  try {
    await overlay.waitFor({ state: 'hidden', timeout: timeoutMs });
  } catch (error: unknown) {
    const stillVisible = await overlay.isVisible().catch(() => false);
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `${PLAY_OVERLAY_NOT_DISMISSED}: Play-in-modal still ${stillVisible ? 'visible' : 'present'} after ${via}. ${detail}`,
    );
  }

  console.log('[sgap-wallet] overlay hidden');
}

async function waitForHostBalance(page: Page, amount: number, timeoutMs: number): Promise<number> {
  try {
    await page.getByText(hostBalancePattern(amount)).first().waitFor({ state: 'visible', timeout: timeoutMs });
  } catch {
    const actual = await readLauncherBalance(page);
    throw new Error(`${LAUNCHER_BALANCE_NOT_UPDATED}: expected ${amount}, host chrome shows ${actual ?? 'unknown'}`);
  }
  const actual = await readLauncherBalance(page);
  if (actual === undefined || Math.abs(actual - amount) >= 0.5) {
    throw new Error(`${LAUNCHER_BALANCE_NOT_UPDATED}: expected ${amount}, host chrome shows ${actual ?? 'unknown'}`);
  }
  return actual;
}

/**
 * Set the launcher / sandbox player balance via the host "Update" control.
 * Always targets 100 USD for insufficient-balance scenarios unless overridden.
 *
 * DiJoker uses an "Update wallet" HTML modal (not window.prompt). A native
 * dialog handler is kept as a fallback. Bet limit is a separate host control.
 */
export async function setLauncherBalance(
  page: Page,
  amount = 100,
  timeoutMs = 20_000,
): Promise<void> {
  skipWithoutLauncher('Setting the host wallet balance');
  const current = await readLauncherBalance(page);
  console.log(`[sgap-wallet] request amount=${amount} current=${current ?? 'unknown'}`);
  if (current !== undefined && Math.abs(current - amount) < 0.5) {
    console.log('[sgap-wallet] host balance already at target — skip Update');
    return;
  }

  await dismissGameModal(page, Math.min(timeoutMs, OVERLAY_TIMEOUT_MS));

  const update = balanceUpdateButton(page);
  try {
    await update.waitFor({ state: 'visible', timeout: timeoutMs });
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`${BALANCE_UPDATE_NOT_FOUND}: Balance row Update is not visible. ${detail}`);
  }
  const updateCount = await update.count();
  if (updateCount !== 1) {
    throw new Error(`${BALANCE_UPDATE_NOT_FOUND}: expected 1 Balance Update control, found ${updateCount}`);
  }
  console.log('[sgap-wallet] balance-update control=Balance row Update');

  let accepted: Promise<void> | undefined;
  const dialogHandler = (dialog: Dialog): void => {
    accepted = dialog.accept(String(amount));
  };
  page.on('dialog', dialogHandler);

  try {
    await clickHostWithIndicator(page, update, { timeout: timeoutMs }, 'balance-update');
    if (accepted !== undefined) {
      await accepted;
      console.log('[sgap-wallet] dialog=native-prompt accepted');
    } else {
      const modal = walletDialog(page);
      try {
        await modal.waitFor({ state: 'visible', timeout: Math.min(timeoutMs, OVERLAY_TIMEOUT_MS) });
      } catch (error: unknown) {
        const detail = error instanceof Error ? error.message : String(error);
        throw new Error(
          `${WALLET_DIALOG_NOT_VISIBLE}: expected "Enter a new balance" and button "Update wallet". ${detail}`,
        );
      }
      console.log('[sgap-wallet] dialog visible heading="Enter a new balance for this wallet."');

      const resetLimit = modal.getByRole('button', { name: 'Reset bet limit' });
      if (await resetLimit.isVisible().catch(() => false)) {
        await clickHostWithIndicator(page, resetLimit, { timeout: 5_000 }, 'reset-bet-limit');
      }
      const balanceInput = modal
        .getByRole('textbox', { name: 'e.g. 10' })
        .or(modal.getByPlaceholder('e.g. 10', { exact: true }));
      await balanceInput.first().fill(String(amount), { timeout: timeoutMs });
      await clickHostWithIndicator(
        page,
        modal.getByRole('button', { name: 'Update wallet' }),
        { timeout: timeoutMs },
        'balance-confirm',
      );
      await modal.waitFor({ state: 'hidden', timeout: Math.min(timeoutMs, OVERLAY_TIMEOUT_MS) });
      console.log('[sgap-wallet] dialog hidden');
    }

    const value = await waitForHostBalance(page, amount, Math.min(timeoutMs, OVERLAY_TIMEOUT_MS));
    console.log(`[sgap-wallet] host balance=${value}`);
  } finally {
    page.off('dialog', dialogHandler);
  }
}

/** Parse current host chrome balance label (e.g. "Balance: 19,832.55"). */
export async function readLauncherBalance(page: Page): Promise<number | undefined> {
  const text = await page
    .getByText(/Balance:\s*[\d,]+(?:\.\d+)?/i)
    .first()
    .textContent({ timeout: 2_000 })
    .catch(() => null);
  if (text === null) {
    return undefined;
  }
  const match = text.match(/Balance:\s*([\d,]+(?:\.\d+)?)/i);
  if (match === null) {
    return undefined;
  }
  const value = Number(match[1]!.replace(/,/g, ''));
  return Number.isFinite(value) ? value : undefined;
}

function parseHostNumber(text: string | null, pattern: RegExp): number | undefined {
  if (text === null) {
    return undefined;
  }
  const match = text.match(pattern);
  if (match === null) {
    return undefined;
  }
  const value = Number(match[1]!.replace(/,/g, ''));
  return Number.isFinite(value) ? value : undefined;
}

/** Parse host chrome "Bet limit" spinbutton (e.g. "100"). */
export async function readLauncherBetLimit(page: Page): Promise<number | undefined> {
  const raw = await page
    .getByRole('spinbutton', { name: 'Bet limit' })
    .first()
    .inputValue({ timeout: 2_000 })
    .catch(() => '');
  const value = Number(String(raw).replace(/,/g, ''));
  return raw !== '' && Number.isFinite(value) ? value : undefined;
}

/**
 * Newer host chrome shows "Bet limit: Disabled [Update]" instead of the spinbutton;
 * a disabled limit means no session wager cap, so there is nothing to restore.
 */
export async function isLauncherBetLimitDisabled(page: Page): Promise<boolean> {
  return page
    .getByText(/Bet limit:\s*Disabled/i)
    .first()
    .isVisible({ timeout: 2_000 })
    .catch(() => false);
}

/** Parse host chrome remaining wager cap (e.g. "Remaining: 8"). */
export async function readLauncherBetRemaining(page: Page): Promise<number | undefined> {
  const text = await page
    .getByText(/Remaining:\s*[\d,]+(?:\.\d+)?/i)
    .first()
    .textContent({ timeout: 2_000 })
    .catch(() => null);
  return parseHostNumber(text, /Remaining:\s*([\d,]+(?:\.\d+)?)/i);
}

/**
 * Set the host chrome "Bet limit" spinbutton and restore remaining to that cap.
 * Staging suites always pin this to 15,000 so session wager caps cannot starve later specs.
 *
 * Force-clicks and dismisses the game modal first — under parallel load the Play
 * modal and worker-monitor chrome can intercept a normal click (CSF-005 flake).
 */
export async function setLauncherBetLimit(
  page: Page,
  amount = STAGING_DEFAULT_BET_LIMIT,
  timeoutMs = 20_000,
): Promise<void> {
  skipWithoutLauncher('Setting the host bet limit');
  const existing = await readLauncherBetLimit(page);
  const remainingNow = await readLauncherBetRemaining(page);
  if (
    existing !== undefined &&
    Math.abs(existing - amount) < 0.5 &&
    (remainingNow === undefined || remainingNow >= amount - 0.5)
  ) {
    return;
  }

  if (await isLauncherBetLimitDisabled(page)) {
    return;
  }

  await dismissGameModal(page, Math.min(timeoutMs, OVERLAY_TIMEOUT_MS));

  const spin = page.getByRole('spinbutton', { name: 'Bet limit' }).first();
  await spin.waitFor({ state: 'visible', timeout: timeoutMs });

  const fillLimit = async (): Promise<void> => {
    await clickHostWithIndicator(page, spin, { timeout: timeoutMs, force: true }, 'bet-limit');
    await spin.fill(String(amount), { timeout: timeoutMs, force: true });
    await spin.press('Enter').catch(() => undefined);
    await spin.press('Tab').catch(() => undefined);
  };

  await fillLimit();

  const remaining = await readLauncherBetRemaining(page);
  const current = await readLauncherBetLimit(page);
  const remainingTooLow = remaining !== undefined && remaining < amount - 0.5;
  const limitMismatch = current === undefined || Math.abs(current - amount) >= 0.5;
  const reset = page.getByRole('button', { name: /^Reset$/i }).first();

  if ((remainingTooLow || limitMismatch) && (await reset.isVisible().catch(() => false))) {
    await clickHostWithIndicator(page, reset, { timeout: 5_000, force: true }, 'reset-bet-limit');
    const afterReset = await readLauncherBetLimit(page);
    if (afterReset === undefined || Math.abs(afterReset - amount) >= 0.5) {
      await fillLimit();
    }
  }

  const deadline = Date.now() + Math.min(timeoutMs, 8_000);
  while (Date.now() < deadline) {
    const value = await readLauncherBetLimit(page);
    const left = await readLauncherBetRemaining(page);
    if (value !== undefined && Math.abs(value - amount) < 0.5 && (left === undefined || left >= amount - 0.5)) {
      return;
    }
    await page.waitForTimeout(250);
  }
}

const BOTTOM_HUD_ACTIONS = ['spin', 'autoplay', 'buyFeature'] as const;

function pagePointInViewport(
  point: { readonly x: number; readonly y: number },
  viewport: { readonly width: number; readonly height: number },
): boolean {
  return point.x >= 0 && point.y >= 0 && point.x < viewport.width && point.y < viewport.height;
}

/**
 * After F2 relock, Spin / Autoplay / Buy at the bottom HUD must still map inside
 * the visible viewport. Do not clamp or retarget — fail so layout can be diagnosed.
 */
async function assertBottomHudInViewport(options: {
  readonly page: Page;
  readonly driver: PlaywrightGameDriver;
  readonly manifest: GameManifest;
}): Promise<void> {
  const viewport = options.page.viewportSize();
  if (viewport === null) {
    throw new Error(`${PLAYABLE_IFRAME_HUD_OUT_OF_VIEW}: Playwright viewport size is unavailable after refresh`);
  }

  const iframeBox = await options.page.locator(options.driver.iframeSelector).boundingBox();
  const fullscreen = await options.page
    .evaluate(() => document.fullscreenElement !== null)
    .catch(() => false);

  const hits: string[] = [];
  const outside: string[] = [];
  for (const action of BOTTOM_HUD_ACTIONS) {
    if (options.manifest.canvasActions?.actions[action] === undefined) {
      continue;
    }
    const point = await options.driver.canvasPagePoint(action);
    const inside = pagePointInViewport(point, viewport);
    hits.push(`${action}=${Math.round(point.x)},${Math.round(point.y)}${inside ? '' : ' OUT'}`);
    if (!inside) {
      outside.push(
        `${action} page=${Math.round(point.x)},${Math.round(point.y)} viewport=${viewport.width}x${viewport.height}`,
      );
    }
  }

  const iframe = iframeBox === null
    ? 'none'
    : `${Math.round(iframeBox.width)}x${Math.round(iframeBox.height)}@${Math.round(iframeBox.x)},${Math.round(iframeBox.y)}`;
  console.log(
    `[sgap-wallet] refresh vp=${viewport.width}x${viewport.height} iframe=${iframe} fullscreen=${fullscreen ? 'yes' : 'no'} hud ${hits.join(' ') || 'none'}`,
  );

  if (outside.length > 0) {
    throw new Error(
      `${PLAYABLE_IFRAME_HUD_OUT_OF_VIEW}: bottom HUD click is outside the visible viewport after relock (${outside.join('; ')}; iframe=${iframe})`,
    );
  }
}

/**
 * Re-open the game iframe and re-prime canvas (no balance change).
 * Applies the F2 fixture relock after prepare and again after splash/prime.
 */
export async function refreshGameSession(options: {
  readonly page: Page;
  readonly platform: PlaywrightPlatform;
  readonly driver: PlaywrightGameDriver;
  readonly manifest: GameManifest;
  readonly timeoutMs?: number;
}): Promise<void> {
  const timeoutMs = options.timeoutMs ?? 90_000;
  const iframeSelector = options.driver.iframeSelector;

  await options.platform.openGame({ timeoutMs });
  await options.platform.prepareActiveGameView({ timeoutMs });
  await options.platform.relockPortraitToViewport();
  await logGameSurface(options.page, iframeSelector, 'after-refresh-prepare-relock', options.manifest);

  await options.driver.attach();
  await primeCanvasSession({
    page: options.page,
    driver: options.driver,
    manifest: options.manifest,
    initializeBody: options.platform.getInitializeBody(),
  });
  await options.platform.relockPortraitToViewport();
  await logGameSurface(options.page, iframeSelector, 'after-refresh-prime-relock', options.manifest);
  await assertBottomHudInViewport(options);
  console.log('[sgap-wallet] game reopened iframe ready');
}

/**
 * Apply host balance (100 USD default), re-open the game, and re-prime the canvas session.
 */
export async function setLauncherBalanceAndRefreshGame(options: {
  readonly page: Page;
  readonly platform: PlaywrightPlatform;
  readonly driver: PlaywrightGameDriver;
  readonly manifest: GameManifest;
  readonly amount?: number;
  readonly timeoutMs?: number;
}): Promise<void> {
  const amount = options.amount ?? 100;
  const timeoutMs = options.timeoutMs ?? 90_000;

  await setLauncherBalance(options.page, amount, Math.min(timeoutMs, 25_000));

  await refreshGameSession(options);
}

/** Restore staging wallet to the default high balance and re-open the game. */
export async function restoreStagingWallet(options: {
  readonly page: Page;
  readonly platform: PlaywrightPlatform;
  readonly driver: PlaywrightGameDriver;
  readonly manifest: GameManifest;
  readonly amount?: number;
  readonly timeoutMs?: number;
}): Promise<void> {
  await setLauncherBalanceAndRefreshGame({
    ...options,
    amount: options.amount ?? STAGING_DEFAULT_WALLET,
  });
}
