/**
 * Shared board so four workers hunting the same rare events can stop when both
 * scenarios already have a clip from any lane.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import type { HuntScenarioId } from './scenario-watch.js';

export interface HuntCaptureMeta {
  readonly scenario: HuntScenarioId;
  readonly workerId: string;
  readonly gameId: string;
  readonly dir: string;
  readonly at: string;
}

interface HuntBoard {
  readonly scenarios: Partial<Record<HuntScenarioId, HuntCaptureMeta>>;
}

const boardDir = (): string =>
  path.join(process.cwd(), 'test-results', 'capture-hunt');

const boardPath = (): string => path.join(boardDir(), 'board.json');

function readBoard(): HuntBoard {
  const file = boardPath();
  if (!existsSync(file)) {
    return { scenarios: {} };
  }
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as HuntBoard;
  } catch {
    return { scenarios: {} };
  }
}

function writeBoard(board: HuntBoard): void {
  mkdirSync(boardDir(), { recursive: true });
  const tmp = `${boardPath()}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(board, null, 2));
  renameSync(tmp, boardPath());
}

export function markScenarioCaptured(meta: HuntCaptureMeta): HuntCaptureMeta {
  const board = readBoard();
  const existing = board.scenarios[meta.scenario];
  if (existing !== undefined) {
    return existing;
  }
  writeBoard({ scenarios: { ...board.scenarios, [meta.scenario]: meta } });
  return meta;
}

export function capturedScenarios(): Partial<Record<HuntScenarioId, HuntCaptureMeta>> {
  return readBoard().scenarios;
}

export function huntComplete(): boolean {
  const scenarios = capturedScenarios();
  return (
    scenarios['scatter-last-retrigger-maxwin'] !== undefined &&
    scenarios['hold-win-maxwin'] !== undefined
  );
}

export function captureDir(gameId: string, workerId: string, scenario: HuntScenarioId): string {
  const stamp = new Date().toISOString().replace(/[:.]/gu, '-');
  return path.join(boardDir(), gameId, `w${workerId}-${scenario}-${stamp}`);
}
