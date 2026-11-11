/**
 * Gross Buy Feature cost. `buyFeat` on Sugar is an activation flag (0/1), not 100×.
 * Never infer gross spend from a wallet that already includes feature wins.
 */

export type GrossBuyCostSource = 'totalBet' | 'stakeTimesMultiplier' | 'unknown';

export interface GrossBuyCost {
  readonly cost: number | undefined;
  readonly source: GrossBuyCostSource;
}

export interface BuyBudgetAllow {
  readonly action: 'allow';
  readonly nextCost: number;
}

export interface BuyBudgetStopCap {
  readonly action: 'stop-cap';
  readonly nextCost: number;
}

export interface BuyBudgetStopUnknown {
  readonly action: 'stop-unknown';
}

export type BuyBudgetDecision = BuyBudgetAllow | BuyBudgetStopCap | BuyBudgetStopUnknown;

function finitePositive(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

/** True when buyFeat is a 0/1 (or boolean-like) activation flag, not a price multiplier. */
export function isBuyFeatActivationFlag(buyFeat: number | undefined): boolean {
  return buyFeat === 0 || buyFeat === 1;
}

/**
 * Gross purchase cost from the buy request + documented multiplier.
 * `totalBet` is used only when it is larger than the line stake (purchase, not the bet).
 */
export function resolveGrossBuyCost(input: {
  readonly stake?: number;
  readonly totalBet?: number;
  readonly buyFeat?: number;
  readonly multiplier: number;
}): GrossBuyCost {
  const stake = finitePositive(input.stake);
  const totalBet = finitePositive(input.totalBet);
  const multiplier = finitePositive(input.multiplier);
  if (totalBet !== undefined && (stake === undefined || totalBet > stake + 0.001)) {
    return { cost: totalBet, source: 'totalBet' };
  }
  if (stake !== undefined && multiplier !== undefined) {
    return { cost: stake * multiplier, source: 'stakeTimesMultiplier' };
  }
  return { cost: undefined, source: 'unknown' };
}

export function decideNextBuyBudget(
  spent: number,
  nextCost: number | undefined,
  maxSpend: number,
): BuyBudgetDecision {
  if (!(maxSpend > 0)) {
    return { action: 'allow', nextCost: finitePositive(nextCost) ?? 0 };
  }
  const cost = finitePositive(nextCost);
  if (cost === undefined) {
    return { action: 'stop-unknown' };
  }
  if (spent + cost > maxSpend) {
    return { action: 'stop-cap', nextCost: cost };
  }
  return { action: 'allow', nextCost: cost };
}
