/**
 * Drain a buy-feature free-spin session back to base game.
 */

import type { Page } from 'playwright';

import type { BetResponseSnapshot } from '../../src/core/models/index.js';
import { settleCanvasToBaseGame, clearCanvasOverlays } from '../../src/platform/index.js';
import { clearInterferingScreens } from '../../src/eye/index.js';
import type { PlaywrightGameDriver } from '../../src/driver/playwright-game-driver.js';
import {
  discoverFeatureSpinItems,
  freeSpinItemsRemaining,
  getFreeSpinItems,
  isFreeSpinBundleComplete,
} from '../../src/shared/spin-payload-discovery.js';
import { readBackendSpin } from '../../src/verification/reel/backend-reader.js';
import type { SgapSession } from '../fixtures/index.js';
import { featureEnteredFromBody } from './buy-feature-verify.js';
import { spinForBet } from './canvas-bet-flow.js';
import { waitForIdleHud } from './canvas-healing.js';

export function sumWinAmounts(spins: readonly BetResponseSnapshot[]): number {
  return spins.reduce((total, spin) => {
    const win = Number(spin.win?.amount ?? '0');
    return Number.isFinite(win) ? total + win : total;
  }, 0);
}

export function stakeDeducted(beforeAmount: string | undefined, after: BetResponseSnapshot): number {
  const before = Number(beforeAmount ?? 'NaN');
  const next = Number(after.balance?.amount ?? 'NaN');
  const win = Number(after.win?.amount ?? '0');
  if (!Number.isFinite(before) || !Number.isFinite(next)) {
    return Number.NaN;
  }
  return before + win - next;
}

/** Build lightweight spin snapshots from a bundled buy freeSpin.items[] payload. */
function snapshotsFromBundledBuy(
  buyBody: unknown,
  balance?: BetResponseSnapshot['balance'],
): BetResponseSnapshot[] {
  const discovered = discoverFeatureSpinItems(buyBody);
  if (discovered === undefined) {
    return [];
  }
  return discovered.items.map((item, index) => ({
    balance,
    win:
      item.totalWin !== undefined
        ? { amount: String(item.totalWin) }
        : { amount: '0' },
    raw: {
      ...(typeof buyBody === 'object' && buyBody !== null ? buyBody : {}),
      __sgapBundledItemIndex: index,
    },
  }));
}

async function playThroughFeatureUi(
  sgapSession: SgapSession,
  sgapDriver: PlaywrightGameDriver,
  page: Page,
  rounds = 12,
): Promise<void> {
  for (let i = 0; i < rounds; i += 1) {
    await clearInterferingScreens({
      page,
      driver: sgapDriver,
      manifest: sgapSession.manifest,
      platform: sgapSession.platform,
      intent: 'resumeFeature',
    });
    // Advance free-spin reels when turbo does not auto-play, then dismiss overlays.
    await sgapDriver.clickCanvas('spin', { timeoutMs: 5_000, singleInput: true }).catch(() => undefined);
    await sgapDriver.clickCanvas('skip', { timeoutMs: 5_000, singleInput: true }).catch(() => undefined);
    await sgapDriver.clickCanvas('enter', { timeoutMs: 5_000, singleInput: true }).catch(() => undefined);
    await sgapDriver
      .clickCanvas('acknowledge', { timeoutMs: 5_000, singleInput: true })
      .catch(() => undefined);
    await clearCanvasOverlays(sgapDriver, sgapSession.manifest, 2, { forceGridSpam: true });
    await page.waitForTimeout(350);
  }
}

/**
 * Drain free spins after a buy (or sequential FS) payload.
 * Bundled buys (all items in one response) only need UI skip-through — no per-spin /bet.
 */
export async function drainFreeSpins(
  sgapSession: SgapSession,
  sgapDriver: PlaywrightGameDriver,
  page: Page,
  initialRemainingOrBuyBody: number | unknown,
  maxSpins = 16,
): Promise<readonly BetResponseSnapshot[]> {
  const buyBody =
    typeof initialRemainingOrBuyBody === 'number' ? undefined : initialRemainingOrBuyBody;
  const initialRemaining =
    typeof initialRemainingOrBuyBody === 'number'
      ? initialRemainingOrBuyBody
      : freeSpinItemsRemaining(initialRemainingOrBuyBody);

  if (buyBody !== undefined && isFreeSpinBundleComplete(buyBody)) {
    let balance: BetResponseSnapshot['balance'] | undefined;
    if (typeof buyBody === 'object' && buyBody !== null && 'balance' in buyBody) {
      const rawBalance = (buyBody as { balance: unknown }).balance;
      if (typeof rawBalance === 'number' || typeof rawBalance === 'string') {
        balance = { amount: String(rawBalance) };
      } else if (
        typeof rawBalance === 'object' &&
        rawBalance !== null &&
        'amount' in rawBalance
      ) {
        balance = { amount: String((rawBalance as { amount: unknown }).amount) };
      }
    }
    const bundled = snapshotsFromBundledBuy(buyBody, balance);
    await playThroughFeatureUi(
      sgapSession,
      sgapDriver,
      page,
      Math.min(16, Math.max(8, bundled.length || 8)),
    );
    await settleCanvasToBaseGame(page, sgapDriver, sgapSession.manifest, buyBody);
    // Bundled buys report remaining=0 so settle is a no-op — keep advancing until idle HUD.
    const idle = await waitForIdleHud(page, sgapDriver, sgapSession.manifest, 24_000);
    if (!idle.healed) {
      await playThroughFeatureUi(sgapSession, sgapDriver, page, 8);
      await waitForIdleHud(page, sgapDriver, sgapSession.manifest, 16_000);
    }
    if (!(await sgapDriver.isAttached())) {
      await sgapDriver.attach();
    }
    return bundled;
  }

  const spins: BetResponseSnapshot[] = [];
  let remaining = initialRemaining;
  let beforeAmount: string | undefined;

  for (let i = 0; i < maxSpins && remaining > 0; i += 1) {
    const betTimeoutMs = 45_000;
    sgapSession.betWatcher!.reset();
    sgapSession.betWatcher!.arm({ timeoutMs: betTimeoutMs });
    await clearInterferingScreens({
      page,
      driver: sgapDriver,
      manifest: sgapSession.manifest,
      platform: sgapSession.platform,
      intent: 'resumeFeature',
    });
    await sgapDriver.clickCanvas('skip', { timeoutMs: 8_000, singleInput: true }).catch(() => undefined);
    await sgapDriver.clickCanvas('enter', { timeoutMs: 8_000, singleInput: true }).catch(() => undefined);

    let bet: BetResponseSnapshot;
    try {
      bet = await sgapSession.betWatcher!.read({ timeoutMs: betTimeoutMs });
    } catch {
      bet = await spinForBet(sgapSession, sgapDriver, page);
    }
    if (beforeAmount !== undefined) {
      const deducted = stakeDeducted(beforeAmount, bet);
      if (Number.isFinite(deducted) && deducted > 0.02) {
        break;
      }
    }
    spins.push(bet);
    remaining = freeSpinItemsRemaining(bet.raw);
    beforeAmount = bet.balance?.amount;
    await clearCanvasOverlays(sgapDriver, sgapSession.manifest, 4, {
      forceGridSpam: true,
    });
  }

  const leftoverHint =
    remaining > 0
      ? (spins.at(-1)?.raw ?? { slot: { freeSpin: { items: [null] } } })
      : sgapSession.platform.getInitializeBody();
  await settleCanvasToBaseGame(page, sgapDriver, sgapSession.manifest, leftoverHint);
  const idle = await waitForIdleHud(page, sgapDriver, sgapSession.manifest, 24_000);
  if (!idle.healed) {
    await playThroughFeatureUi(sgapSession, sgapDriver, page, 8);
    await waitForIdleHud(page, sgapDriver, sgapSession.manifest, 16_000);
  }
  if (!(await sgapDriver.isAttached())) {
    await sgapDriver.attach();
  }

  return spins;
}

export interface ScatterFeatureHit {
  readonly bet: BetResponseSnapshot;
  readonly spinsTaken: number;
  readonly scatterCount: number;
}

/** Sugar (and similar) open free spins at this many scatters on the stop board. */
const DEFAULT_SCATTER_TRIGGER_AT = 4;

function scatterIdsFromManifest(manifest: SgapSession['manifest']): ReadonlySet<number> {
  const symbols = manifest.reelValidation?.symbols ?? [];
  const ids = symbols.filter((entry) => entry.kind === 'scatter').map((entry) => entry.id);
  return new Set(ids.length > 0 ? ids : [0]);
}

function countScattersOnBoard(body: unknown, manifest: SgapSession['manifest']): number {
  try {
    const read = readBackendSpin(body, {
      areaPath: manifest.reelValidation?.areaPath,
      tumblesPath: manifest.reelValidation?.tumblesPath,
      rowOrder: manifest.reelValidation?.rowOrder,
      symbols: manifest.reelValidation?.symbols,
      gameId: manifest.gameId,
    });
    const board = read.boards[0];
    if (board === undefined) {
      return 0;
    }
    const scatterIds = scatterIdsFromManifest(manifest);
    let count = 0;
    for (const column of board.ids) {
      for (const id of column) {
        if (scatterIds.has(id)) {
          count += 1;
        }
      }
    }
    return count;
  } catch {
    return 0;
  }
}

/**
 * Spin base game until a natural scatter opens the feature (not Buy Feature).
 * Amplify / turbo should be armed by the caller — they shorten the hunt.
 */
export async function spinUntilScatterFeature(
  sgapSession: SgapSession,
  sgapDriver: PlaywrightGameDriver,
  page: Page,
  options?: {
    readonly maxSpins?: number;
    readonly scatterTriggerAt?: number;
  },
): Promise<ScatterFeatureHit> {
  const maxSpins = options?.maxSpins ?? 80;
  const scatterTriggerAt = options?.scatterTriggerAt ?? DEFAULT_SCATTER_TRIGGER_AT;

  for (let spin = 1; spin <= maxSpins; spin += 1) {
    const bet = await spinForBet(sgapSession, sgapDriver, page);
    const scatterCount = countScattersOnBoard(bet.raw, sgapSession.manifest);
    const entered = featureEnteredFromBody(bet.raw);
    if (entered || scatterCount >= scatterTriggerAt) {
      return { bet, spinsTaken: spin, scatterCount };
    }
    await settleCanvasToBaseGame(
      page,
      sgapDriver,
      sgapSession.manifest,
      bet.raw,
    ).catch(() => undefined);
  }

  throw new Error(
    `No scatter feature after ${maxSpins} base spins ` +
      `(need ≥${scatterTriggerAt} scatters or a free-spin payload)`,
  );
}

export interface FreeSpinSessionView {
  readonly multiplierValue: number;
  readonly itemCount: number;
  /** spinsLeft per item in payload order (bundled) or single remaining. */
  readonly spinsLeftSeries: readonly number[];
  readonly initialCount: number;
  /** True when the last observed remaining/spinsLeft reaches 0 or the bundle is complete. */
  readonly countExhausted: boolean;
  /** spinsLeft increased mid-session, or ≥scatterTriggerAt scatters on a non-opener board. */
  readonly hadRetrigger: boolean;
  readonly maxScatterOnItem: number;
  readonly sumItemWins: number;
}

function freeSpinRoot(body: unknown): Record<string, unknown> | undefined {
  if (typeof body !== 'object' || body === null) {
    return undefined;
  }
  const slot = (body as { slot?: unknown }).slot;
  if (typeof slot === 'object' && slot !== null && 'freeSpin' in slot) {
    const freeSpin = (slot as { freeSpin: unknown }).freeSpin;
    if (typeof freeSpin === 'object' && freeSpin !== null) {
      return freeSpin as Record<string, unknown>;
    }
  }
  if ('freeSpin' in body) {
    const freeSpin = (body as { freeSpin: unknown }).freeSpin;
    if (typeof freeSpin === 'object' && freeSpin !== null) {
      return freeSpin as Record<string, unknown>;
    }
  }
  return undefined;
}

function countScatterInArea(
  area: unknown,
  scatterIds: ReadonlySet<number>,
): number {
  if (!Array.isArray(area)) {
    return 0;
  }
  let count = 0;
  for (const column of area) {
    if (!Array.isArray(column)) {
      continue;
    }
    for (const id of column) {
      if (scatterIds.has(Number(id))) {
        count += 1;
      }
    }
  }
  return count;
}

/**
 * Summarise a buy/bet free-spin payload for count, multiplier, and retrigger checks.
 * Works for bundled multi-item buys and single-item sequential responses.
 */
export function readFreeSpinSession(
  body: unknown,
  options?: {
    readonly manifest?: SgapSession['manifest'];
    readonly scatterTriggerAt?: number;
  },
): FreeSpinSessionView | undefined {
  const discovered = discoverFeatureSpinItems(body);
  const root = freeSpinRoot(body);
  if (discovered === undefined && root === undefined) {
    return undefined;
  }

  const scatterTriggerAt = options?.scatterTriggerAt ?? DEFAULT_SCATTER_TRIGGER_AT;
  const scatterIds = options?.manifest
    ? scatterIdsFromManifest(options.manifest)
    : new Set([0]);

  const multiplierRaw = root?.multiplierValue;
  const multiplierValue = Number(multiplierRaw);
  const items = getFreeSpinItems(body);
  const spinsLeftSeries: number[] = [];
  let sumItemWins = 0;
  let maxScatterOnItem = 0;
  let hadRetrigger = false;

  if (items.length > 0) {
    let previousLeft: number | undefined;
    items.forEach((entry, index) => {
      if (typeof entry !== 'object' || entry === null) {
        return;
      }
      const typed = entry as Record<string, unknown>;
      const left = Number(
        typed.spinsLeft ?? typed.spinsRemaining ?? typed.remaining ?? typed.freeSpinsLeft,
      );
      if (Number.isFinite(left)) {
        if (previousLeft !== undefined && left > previousLeft) {
          hadRetrigger = true;
        }
        spinsLeftSeries.push(left);
        previousLeft = left;
      }
      const win = Number(typed.totalWin ?? typed.win ?? 0);
      if (Number.isFinite(win)) {
        sumItemWins += win;
      }
      const scatters = countScatterInArea(typed.area, scatterIds);
      maxScatterOnItem = Math.max(maxScatterOnItem, scatters);
      // Opener board may already hold the trigger scatters; retrigger is later.
      if (index > 0 && scatters >= scatterTriggerAt) {
        hadRetrigger = true;
      }
    });
  } else if (discovered !== undefined) {
    for (const item of discovered.items) {
      if (item.spinsRemaining !== undefined) {
        spinsLeftSeries.push(item.spinsRemaining);
      }
      if (item.totalWin !== undefined) {
        sumItemWins += item.totalWin;
      }
    }
  }

  const remaining = freeSpinItemsRemaining(body);
  if (spinsLeftSeries.length === 0 && remaining > 0) {
    spinsLeftSeries.push(remaining);
  }

  const initialCount =
    spinsLeftSeries[0] ??
    (discovered !== undefined && discovered.items.length > 1
      ? discovered.items.length
      : remaining);

  const countExhausted =
    isFreeSpinBundleComplete(body) ||
    remaining === 0 ||
    (spinsLeftSeries.length > 0 && spinsLeftSeries[spinsLeftSeries.length - 1]! <= 1);

  return {
    multiplierValue: Number.isFinite(multiplierValue) ? multiplierValue : 0,
    itemCount: items.length || discovered?.items.length || 0,
    spinsLeftSeries,
    initialCount,
    countExhausted,
    hadRetrigger,
    maxScatterOnItem,
    sumItemWins,
  };
}
