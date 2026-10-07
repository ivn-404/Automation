/**
 * Scratch-card round verification from the scratch hub websocket.
 * Does not execute actions — validates the StartRound / Cashout answers only.
 *
 * Rules (product brief): a win needs at least 3 matching symbols; the match count
 * can't exceed the grid dimension (3×3 → 3, 4×4 → 4, 5×5 → 5).
 */

import type { VerificationKind } from '../core/constants/index.js';
import type { VerificationResult } from '../core/models/index.js';
import type { ScratchRoundSnapshot } from '../network/index.js';

const MIN_WINNING_MATCH = 3;
const AMOUNT_TOLERANCE = 0.005;

function check(
  kind: VerificationKind,
  passed: boolean,
  message: string,
  expected?: unknown,
  actual?: unknown,
): VerificationResult {
  return { kind, passed, message, expected, actual };
}

function near(left: number, right: number): boolean {
  return Math.abs(left - right) <= AMOUNT_TOLERANCE;
}

/** Validates the card the hub dealt on BUY CARD (StartRound). */
export function verifyScratchCardBought(
  started: ScratchRoundSnapshot,
  expectedDimension: number,
): VerificationResult[] {
  const card = started.card;
  const results: VerificationResult[] = [
    check(
      'stateManagement',
      started.errorCode === null && card !== undefined,
      card !== undefined
        ? `StartRound dealt a card: "${started.message}"`
        : `StartRound returned no card: "${started.message}" (errorCode ${started.errorCode})`,
    ),
    check('bet', started.betAmount > 0, `Card bet ${started.betAmount}`, '> 0', started.betAmount),
  ];
  if (card === undefined) {
    return results;
  }

  const dimension = card.gridDimension;
  results.push(
    check(
      'stateManagement',
      dimension === expectedDimension,
      `Grid ${dimension}x${dimension} (selected ${expectedDimension}x${expectedDimension})`,
      expectedDimension,
      dimension,
    ),
    check(
      'stateManagement',
      card.cells.length === dimension * dimension,
      `Card has ${card.cells.length} cells for ${dimension}x${dimension}`,
      dimension * dimension,
      card.cells.length,
    ),
    check(
      'win',
      card.matchCount <= dimension,
      `Match count ${card.matchCount} ≤ grid dimension ${dimension}`,
      `≤ ${dimension}`,
      card.matchCount,
    ),
  );

  if (card.isWin) {
    results.push(
      check(
        'win',
        card.matchCount >= MIN_WINNING_MATCH,
        `Winning card (${card.tier}) matches ${card.matchCount} symbols`,
        `≥ ${MIN_WINNING_MATCH}`,
        card.matchCount,
      ),
      check(
        'win',
        near(card.winAmount, started.betAmount * card.winMultiplier),
        `Win ${card.winAmount} = bet ${started.betAmount} × ${card.winMultiplier}`,
        started.betAmount * card.winMultiplier,
        card.winAmount,
      ),
    );
    const symbol = started.payTable.find((row) => row.tier === card.tier)?.symbol;
    if (symbol !== undefined) {
      const shown = card.cells.filter((cell) => cell.symbol === symbol).length;
      results.push(
        check(
          'win',
          shown >= card.matchCount,
          `${symbol} appears ${shown}× on the card for a ${card.matchCount}-match ${card.tier}`,
          `≥ ${card.matchCount}`,
          shown,
        ),
      );
    }
    results.push(
      check(
        'win',
        started.payTable.some((row) => row.tier === card.tier),
        `Win tier ${card.tier} is in the ${dimension}x${dimension} paytable`,
      ),
    );
  } else {
    results.push(
      check('win', card.winAmount === 0, `Losing card (${card.tier}) pays 0`, 0, card.winAmount),
    );
  }
  return results;
}

/**
 * Win rule both ways: a winning card shows ≥3 of its tier symbol, and a losing
 * card shows no paytable symbol three or more times.
 */
export function verifyScratchWinRule(started: ScratchRoundSnapshot): VerificationResult[] {
  const card = started.card;
  if (card === undefined) {
    return [check('stateManagement', false, 'StartRound returned no card')];
  }
  const counts = new Map<string, number>();
  for (const cell of card.cells) {
    counts.set(cell.symbol, (counts.get(cell.symbol) ?? 0) + 1);
  }
  if (card.isWin) {
    const symbol = started.payTable.find((row) => row.tier === card.tier)?.symbol ?? '';
    const shown = counts.get(symbol) ?? 0;
    return [
      check(
        'win',
        card.matchCount >= MIN_WINNING_MATCH && shown >= MIN_WINNING_MATCH,
        `Win ${card.tier}: ${symbol} shown ${shown}×, matchCount ${card.matchCount}`,
        `≥ ${MIN_WINNING_MATCH}`,
        { shown, matchCount: card.matchCount },
      ),
    ];
  }
  const paySymbols = new Set(started.payTable.map((row) => row.symbol));
  const triples = [...counts.entries()].filter(
    ([symbol, count]) => paySymbols.has(symbol) && count >= MIN_WINNING_MATCH,
  );
  return [
    check(
      'win',
      triples.length === 0,
      triples.length === 0
        ? `Losing card shows no paytable symbol ${MIN_WINNING_MATCH}+ times`
        : `Losing card shows ${triples.map(([s, n]) => `${s}×${n}`).join(', ')}`,
      `< ${MIN_WINNING_MATCH} of each`,
      Object.fromEntries(counts),
    ),
  ];
}

/**
 * Legend labels the drawer should show for a paytable: one `×N` per base tier
 * (no `Ms` level, Jackpot included) and one `+×F` per bonus level `MsK`, where F
 * is the SmallWinMsK / SmallWin ratio.
 */
export function expectedScratchLegend(
  payTable: ScratchRoundSnapshot['payTable'],
): readonly string[] {
  const base = payTable.filter((row) => !/Ms\d/u.test(row.tier)).map((row) => `×${row.multiplier}`);
  const bonus: string[] = [];
  const levels = new Set<string>();
  for (const row of payTable) {
    const match = row.tier.match(/^(\w+?)(Ms\d)$/u);
    if (match !== null && match[2] !== undefined && !levels.has(match[2])) {
      const plain = payTable.find((entry) => entry.tier === match[1]);
      if (plain !== undefined && plain.multiplier > 0) {
        levels.add(match[2]);
        bonus.push(`+×${row.multiplier / plain.multiplier}`);
      }
    }
  }
  return [...base, ...bonus];
}

/** Validates the settlement after the dust is gone (Cashout) against the bought card. */
export function verifyScratchCardSettled(
  started: ScratchRoundSnapshot,
  settled: ScratchRoundSnapshot,
): VerificationResult[] {
  const bought = started.card;
  const revealed = settled.card;
  const results: VerificationResult[] = [
    check(
      'stateManagement',
      settled.errorCode === null && /scratch complete/iu.test(settled.message),
      `Cashout: "${settled.message}"`,
      'Scratch complete',
      settled.message,
    ),
    check(
      'stateManagement',
      settled.status !== started.status,
      `Round status moved ${started.status} → ${settled.status}`,
    ),
  ];
  if (bought !== undefined && revealed !== undefined) {
    const sameCells =
      bought.cells.length === revealed.cells.length &&
      bought.cells.every((cell, index) => revealed.cells[index]?.symbol === cell.symbol);
    results.push(
      check('uiSynchronization', sameCells, 'Settled card is the card that was bought'),
      check(
        'win',
        near(settled.winAmount, bought.winAmount),
        `Settled win ${settled.winAmount} matches dealt win ${bought.winAmount}`,
        bought.winAmount,
        settled.winAmount,
      ),
    );
  }
  if (started.balance !== undefined && settled.balance !== undefined) {
    const expected = started.balance + settled.winAmount;
    results.push(
      check(
        'balance',
        near(settled.balance, expected),
        `Balance ${started.balance} + win ${settled.winAmount} = ${settled.balance}`,
        expected,
        settled.balance,
      ),
    );
  }
  return results;
}
