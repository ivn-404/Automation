/**
 * DiJoker launcher helpers — host-page balance Update control.
 *
 * The sandbox chrome above the game shows:
 *   Balance: 19,832.55   [Update]
 * BF-004 / ES-005 set this to 100 USD (see config/parallel-workers.json minimumBetBalance).
 * Parallel lanes set 15,000 USD by default; do not force 100 on every test.
 * clicks, so we dismiss (or force-click) before updating, then refresh the game.
 */

import type { Dialog, Page } from 'playwright';

import type { GameManifest } from '../../src/core/models/index.js';
import { clickHostWithIndicator } from '../../src/driver/click-tracker.js';
import type { PlaywrightGameDriver } from '../../src/driver/playwright-game-driver.js';
import { primeCanvasSession } from '../../src/platform/index.js';
import type { PlaywrightPlatform } from '../../src/platform/playwright-platform.js';

/** Default sandbox wallet after low-balance tests — keeps later specs able to buy/spin. */
export const STAGING_DEFAULT_WALLET = 20_000;

/** Host chrome "Bet limit" — session wager cap. Staging suites always use 15,000. */
export const STAGING_DEFAULT_BET_LIMIT = 15_000;

/** Close the Play-in-modal overlay so host chrome (Balance Update) is clickable. */
async function dismissGameModal(page: Page): Promise<void> {
  await page.keyboard.press('Escape').catch(() => undefined);

  const modal = page.locator('div.fixed.inset-0.z-50').filter({
    has: page.locator('iframe[title="Game session"]'),
  });
  if (!(await modal.first().isVisible().catch(() => false))) {
    return;
  }

  // Common close affordances on the DiJoker game-player chrome.
  const closeCandidates = [
    modal.getByRole('button', { name: /^close$/i }),
    modal.locator('button').filter({ has: page.locator('svg') }).first(),
    page.getByRole('button', { name: /^close$/i }),
  ];
  for (const candidate of closeCandidates) {
    if (await candidate.isVisible().catch(() => false)) {
      await clickHostWithIndicator(page, candidate, { force: true, timeout: 5_000 }, 'dismiss-modal').catch(
        () => undefined,
      );
      break;
    }
  }

  await page.keyboard.press('Escape').catch(() => undefined);
  await modal
    .first()
    .waitFor({ state: 'hidden', timeout: 8_000 })
    .catch(() => undefined);
}

/**
 * Set the launcher / sandbox player balance via the host "Update" control.
 * Always targets 100 USD for insufficient-balance scenarios unless overridden.
 *
 * DiJoker uses an "Update wallet" HTML modal (not window.prompt). A native
 * dialog handler is kept as a fallback. Bet limit is a separate host spinbutton.
 */
export async function setLauncherBalance(
  page: Page,
  amount = 100,
  timeoutMs = 20_000,
): Promise<void> {
  const current = await readLauncherBalance(page);
  if (current !== undefined && Math.abs(current - amount) < 0.5) {
    return;
  }

  await dismissGameModal(page);

  const update = page.getByRole('button', { name: 'Update', exact: true }).first();
  await update.waitFor({ state: 'visible', timeout: timeoutMs });

  let accepted: Promise<void> | undefined;
  const dialogHandler = (dialog: Dialog): void => {
    accepted = dialog.accept(String(amount));
  };
  page.on('dialog', dialogHandler);

  try {
    await clickHostWithIndicator(page, update, { timeout: timeoutMs, force: true }, 'balance-update');
    if (accepted !== undefined) {
      await accepted;
    } else {
      const walletModal = page
        .locator('div')
        .filter({ hasText: 'Enter a new balance' })
        .filter({ has: page.getByRole('button', { name: 'Update wallet' }) })
        .first();
      await walletModal.waitFor({ state: 'visible', timeout: Math.min(timeoutMs, 8_000) });
      const resetLimit = walletModal.getByRole('button', { name: 'Reset bet limit' });
      if (await resetLimit.isVisible().catch(() => false)) {
        await clickHostWithIndicator(page, resetLimit, { timeout: 5_000, force: true }, 'reset-bet-limit');
      }
      const balanceInput = walletModal
        .getByRole('textbox', { name: 'e.g. 10' })
        .or(walletModal.getByPlaceholder('e.g. 10', { exact: true }));
      await balanceInput.first().fill(String(amount), { timeout: timeoutMs });
      await clickHostWithIndicator(
        page,
        walletModal.getByRole('button', { name: 'Update wallet' }),
        { timeout: timeoutMs, force: true },
        'balance-confirm',
      );
      await walletModal.waitFor({ state: 'hidden', timeout: Math.min(timeoutMs, 8_000) }).catch(async () => {
        await page.keyboard.press('Escape').catch(() => undefined);
      });
    }

    const deadline = Date.now() + Math.min(timeoutMs, 8_000);
    while (Date.now() < deadline) {
      const value = await readLauncherBalance(page);
      if (value !== undefined && Math.abs(value - amount) < 0.5) {
        return;
      }
      await page.waitForTimeout(250);
    }
  } finally {
    page.off('dialog', dialogHandler);
  }
}

/** Parse current host chrome balance label (e.g. "Balance: 19,832.55"). */
export async function readLauncherBalance(page: Page): Promise<number | undefined> {
  const text = await page
    .getByText(/Balance:\s*[\d,]+(?:\.\d+)?/i)
    .first()
    .textContent()
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
    .inputValue()
    .catch(() => '');
  const value = Number(String(raw).replace(/,/g, ''));
  return raw !== '' && Number.isFinite(value) ? value : undefined;
}

/** Parse host chrome remaining wager cap (e.g. "Remaining: 8"). */
export async function readLauncherBetRemaining(page: Page): Promise<number | undefined> {
  const text = await page
    .getByText(/Remaining:\s*[\d,]+(?:\.\d+)?/i)
    .first()
    .textContent()
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
  const existing = await readLauncherBetLimit(page);
  const remainingNow = await readLauncherBetRemaining(page);
  if (
    existing !== undefined &&
    Math.abs(existing - amount) < 0.5 &&
    (remainingNow === undefined || remainingNow >= amount - 0.5)
  ) {
    return;
  }

  await dismissGameModal(page);

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

/**
 * Re-open the game iframe and re-prime canvas (no balance change).
 */
export async function refreshGameSession(options: {
  readonly page: Page;
  readonly platform: PlaywrightPlatform;
  readonly driver: PlaywrightGameDriver;
  readonly manifest: GameManifest;
  readonly timeoutMs?: number;
}): Promise<void> {
  const timeoutMs = options.timeoutMs ?? 90_000;
  await options.platform.openGame({ timeoutMs });
  await options.platform.prepareActiveGameView({ timeoutMs });
  await options.driver.attach();
  await primeCanvasSession({
    page: options.page,
    driver: options.driver,
    manifest: options.manifest,
    initializeBody: options.platform.getInitializeBody(),
  });
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
