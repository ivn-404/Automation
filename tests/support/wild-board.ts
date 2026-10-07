/**
 * Package 1 wilds = multiplier bombs (ids 10–22) and any symbol kind "wild".
 * WD-001 explode = bomb on a board followed by a tumble/cascade in the same spin.
 */

import type { Page } from 'playwright';

import type { GameManifest, ReelSymbolDef } from '../../src/core/models/index.js';
import { settleCanvasToBaseGame } from '../../src/platform/index.js';
import { readBackendSpin } from '../../src/verification/reel/backend-reader.js';
import type { PlaywrightGameDriver } from '../../src/driver/playwright-game-driver.js';
import type { SgapSession } from '../fixtures/index.js';
import { buyFeatureForBet } from './canvas-bet-flow.js';
import { featureEnteredFromBody } from './buy-feature-verify.js';
import { drainFreeSpins } from './free-spin-flow.js';

export interface WildBoardView {
  readonly maxOnOneBoard: number;
  readonly boardsWithExactlyOne: number;
  readonly boardsWithTwoOrMore: number;
  readonly exploded: boolean;
  readonly multiplierIdsSeen: readonly number[];
  readonly boardCount: number;
}

function wildIdsFromManifest(symbols: readonly ReelSymbolDef[]): ReadonlySet<number> {
  const ids = symbols
    .filter((entry) => entry.kind === 'wild' || entry.kind === 'multiplier')
    .map((entry) => entry.id);
  return new Set(ids);
}

function countWildsOnBoard(
  ids: readonly (readonly number[])[],
  wildIds: ReadonlySet<number>,
): number {
  let count = 0;
  for (const row of ids) {
    for (const id of row) {
      if (wildIds.has(id)) {
        count += 1;
      }
    }
  }
  return count;
}

export function readWildBoard(
  body: unknown,
  manifest: GameManifest,
): WildBoardView {
  const symbols = manifest.reelValidation?.symbols ?? [];
  const wildIds = wildIdsFromManifest(symbols);
  const multiplierIdsSeen = new Set<number>();
  let maxOnOneBoard = 0;
  let boardsWithExactlyOne = 0;
  let boardsWithTwoOrMore = 0;
  let exploded = false;
  let boardCount = 0;

  const read = readBackendSpin(body, {
    areaPath: manifest.reelValidation?.areaPath,
    tumblesPath: manifest.reelValidation?.tumblesPath,
    featureItemsPath: manifest.reelValidation?.featureItemsPath,
    rowOrder: manifest.reelValidation?.rowOrder,
    symbols,
    gameId: manifest.gameId,
  });

  for (const group of read.spinGroups) {
    const boards = group.boards.filter((board) => !board.symbolsOnly && board.ids.length > 0);
    for (let i = 0; i < boards.length; i += 1) {
      const board = boards[i]!;
      boardCount += 1;
      const count = countWildsOnBoard(board.ids, wildIds);
      maxOnOneBoard = Math.max(maxOnOneBoard, count);
      if (count === 1) {
        boardsWithExactlyOne += 1;
      }
      if (count >= 2) {
        boardsWithTwoOrMore += 1;
      }
      for (const row of board.ids) {
        for (const id of row) {
          if (wildIds.has(id)) {
            multiplierIdsSeen.add(id);
          }
        }
      }
      if (count > 0) {
        const laterTumble = boards.slice(i + 1).length > 0 || (group.symbolsOnlyTumbleCount ?? 0) > 0;
        if (laterTumble) {
          exploded = true;
        }
      }
    }
    if (
      !exploded &&
      boards.some((board) => countWildsOnBoard(board.ids, wildIds) > 0) &&
      (group.symbolsOnlyTumbleCount ?? 0) > 0
    ) {
      exploded = true;
    }
  }

  return {
    maxOnOneBoard,
    boardsWithExactlyOne,
    boardsWithTwoOrMore,
    exploded,
    multiplierIdsSeen: [...multiplierIdsSeen].sort((a, b) => a - b),
    boardCount,
  };
}

export async function huntWildBoard(
  sgapSession: SgapSession,
  sgapDriver: PlaywrightGameDriver,
  page: Page,
  matches: (view: WildBoardView) => boolean,
  maxBuys = 6,
): Promise<{ readonly view: WildBoardView; readonly attempts: number; readonly entered: boolean }> {
  let best: WildBoardView = {
    maxOnOneBoard: 0,
    boardsWithExactlyOne: 0,
    boardsWithTwoOrMore: 0,
    exploded: false,
    multiplierIdsSeen: [],
    boardCount: 0,
  };
  let attempts = 0;
  let entered = false;

  for (let attempt = 1; attempt <= maxBuys; attempt += 1) {
    attempts = attempt;
    await settleCanvasToBaseGame(
      page,
      sgapDriver,
      sgapSession.manifest,
      sgapSession.platform.getInitializeBody(),
    ).catch(() => undefined);

    const buy = await buyFeatureForBet(sgapSession, sgapDriver, page);
    entered = featureEnteredFromBody(buy.raw) || entered;
    const view = readWildBoard(buy.raw, sgapSession.manifest);
    if (
      view.exploded ||
      view.boardsWithTwoOrMore > best.boardsWithTwoOrMore ||
      view.maxOnOneBoard > best.maxOnOneBoard
    ) {
      best = view;
    }
    if (matches(view)) {
      await drainFreeSpins(sgapSession, sgapDriver, page, buy.raw, 24);
      return { view, attempts, entered };
    }
    await drainFreeSpins(sgapSession, sgapDriver, page, buy.raw, 24);
  }

  return { view: best, attempts, entered };
}
