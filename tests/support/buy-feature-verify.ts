/**
 * Buy-feature verification helpers (network + manifest math).
 */

import type { Response } from 'playwright';

import type { GameManifest } from '../../src/core/models/index.js';
import { getByPath, toAmountString } from '../../src/shared/json-path.js';
import {
  discoverFeatureSpinItems,
  freeSpinItemsRemaining,
  isFreeSpinBundleComplete,
} from '../../src/shared/spin-payload-discovery.js';

export { freeSpinItemsRemaining, isFreeSpinBundleComplete, discoverFeatureSpinItems };

/** True when buy/bet payload opened a free-spin / bonus feature (bundled or sequential). */
export function featureEnteredFromBody(body: unknown): boolean {
  if (isFreeSpinBundleComplete(body)) {
    return true;
  }
  if (freeSpinItemsRemaining(body) > 0) {
    return true;
  }
  const discovered = discoverFeatureSpinItems(body);
  if (discovered !== undefined && discovered.items.length > 0) {
    return true;
  }
  return getByPath(body, 'slot.bonus') !== undefined;
}

/** @deprecated Prefer featureEnteredFromBody — bundled buys report remaining=0. */
export function featureTriggeredFromBody(body: unknown): boolean {
  return featureEnteredFromBody(body);
}

/** Default Sugar buy cost = bet × 100 when metadata omits multiplier. */
export function resolveBuyFeatureMultiplier(manifest: GameManifest): number {
  const raw = manifest.metadata?.buyFeatureMultiplier;
  if (raw !== undefined) {
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return 100;
}

export function expectedBuyCost(
  stake: number,
  manifest: GameManifest,
  buyFeatMultiplier?: number,
): number {
  const mult =
    buyFeatMultiplier !== undefined && buyFeatMultiplier > 0
      ? buyFeatMultiplier
      : resolveBuyFeatureMultiplier(manifest);
  return stake * mult;
}

export function parseRequestBuyFeat(response: Response): number | undefined {
  try {
    const body = response.request().postDataJSON();
    const raw = getByPath(body, 'buyFeat');
    if (raw === undefined) {
      return undefined;
    }
    const value = Number(raw);
    return Number.isFinite(value) && value > 0 ? value : undefined;
  } catch {
    return undefined;
  }
}

export function parseResponseStake(response: Response): number | undefined {
  try {
    const body = response.request().postDataJSON() as {
      bet?: number | string;
      stake?: number | string;
      amount?: number | string;
    } | null;
    if (body === null) {
      return undefined;
    }
    const candidate = body.bet ?? body.stake ?? body.amount;
    if (candidate === undefined) {
      return undefined;
    }
    const value = Number(candidate);
    return Number.isFinite(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

export function parseRequestLineBet(response: Response): number | undefined {
  return parseResponseStake(response);
}

export function parseRequestTotalBet(response: Response): number | undefined {
  try {
    const body = response.request().postDataJSON();
    const total = toAmountString(getByPath(body, 'totalBet'));
    if (total === undefined) {
      return undefined;
    }
    const value = Number(total);
    return Number.isFinite(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

/** Total buy cost inferred from wallet movement: before − after + win. */
export function resolveBuyPurchaseCost(options: {
  readonly beforeBalance?: string;
  readonly afterBalance?: string;
  readonly winAmount?: string;
}): number | undefined {
  const before = Number(options.beforeBalance ?? 'NaN');
  const after = Number(options.afterBalance ?? 'NaN');
  const win = Number(options.winAmount ?? '0');
  if (!Number.isFinite(before) || !Number.isFinite(after)) {
    return undefined;
  }
  const deducted = before - after + win;
  return Number.isFinite(deducted) && deducted >= 0 ? deducted : undefined;
}
