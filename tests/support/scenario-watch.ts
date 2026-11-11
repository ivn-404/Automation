/**
 * Watch /bet payloads for scatter free spins, Hold & Win, and hasMaxWin.
 *
 * Fruit Attack (and other DiJoker titles) put those on the body: slot.freeSpin,
 * a hold/respin/bonus node, and slot.hasMaxWin. When the flag is true, max win hit.
 * A clip dumps on that /bet — we do not wait for return-to-base.
 */

import { getByPath } from '../../src/shared/json-path.js';

export const SCENARIO_RETRIGGER_MAXWIN = 'scatter-last-retrigger-maxwin' as const;
export const SCENARIO_HOLDWIN_MAXWIN = 'hold-win-maxwin' as const;

export type HuntScenarioId = typeof SCENARIO_RETRIGGER_MAXWIN | typeof SCENARIO_HOLDWIN_MAXWIN;

export interface BetView {
  readonly inFreeSpin: boolean;
  readonly spinsLeft?: number;
  readonly inHoldAndWin: boolean;
  readonly holdRespinsLeft?: number;
  readonly lockedCount?: number;
  readonly maxWin: boolean;
  readonly totalWin?: number;
  readonly stake?: number;
  readonly slotKeys: readonly string[];
}

export interface ScenarioProgress {
  readonly completed: readonly HuntScenarioId[];
  readonly view: BetView;
  readonly session: 'base' | 'freeSpin' | 'holdAndWin';
  readonly latchedRetriggerOnLast: boolean;
  readonly latchedHoldAndWin: boolean;
  readonly latchedMaxWin: boolean;
}

const HOLD_KEY =
  /^(holds?|holdAndWin|holdWin|hold_and_win|locked?|sticky|respins?|respinCount|bonusHold|bonusGame|moneyRespin)$/iu;
const REMAINING_KEY = /^(left|remaining|respins?|respinCount|roundsLeft|spinsLeft|spinsRemaining)$/iu;
const MAX_WIN_KEY = /^(hasMaxWin|maxWinReached|isMaxWin)$/iu;
const HOLD_PATHS = [
  'slot.holdAndWin',
  'slot.holdWin',
  'slot.hold_and_win',
  'slot.respin',
  'slot.respins',
  'slot.bonus.holdAndWin',
  'slot.bonus.respin',
  'slot.bonus.respins',
  'slot.bonusGame',
  'slot.bonusHold',
  'slot.moneyRespin',
  'data.slot.holdAndWin',
  'data.slot.respin',
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isTrue(value: unknown): boolean {
  return value === true || value === 'true' || value === 1 || value === '1';
}

function readNumber(value: unknown): number | undefined {
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function slotRoot(body: unknown): Record<string, unknown> | undefined {
  if (!isRecord(body)) {
    return undefined;
  }
  if (isRecord(body.slot)) {
    return body.slot;
  }
  if (isRecord(body.data) && isRecord(body.data.slot)) {
    return body.data.slot;
  }
  if (isRecord(body.result) && isRecord(body.result.slot)) {
    return body.result.slot;
  }
  return undefined;
}

function walk(
  value: unknown,
  visit: (key: string, child: unknown) => void,
  depth = 0,
): void {
  if (depth > 8 || value === null || typeof value !== 'object') {
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value.slice(0, 40)) {
      walk(entry, visit, depth + 1);
    }
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    visit(key, child);
    walk(child, visit, depth + 1);
  }
}

function countLocked(value: unknown): number {
  if (!Array.isArray(value)) {
    return 0;
  }
  let count = 0;
  for (const cell of value) {
    if (cell === true || cell === 1) {
      count += 1;
    } else if (typeof cell === 'object' && cell !== null) {
      count += 1;
    } else if (typeof cell === 'number' && cell > 0) {
      count += 1;
    }
  }
  return count;
}

/** Empty `{ win: 0 }` is every DiJoker /bet — not Hold & Win. */
function bonusLooksLikeHold(node: unknown): boolean {
  if (!isRecord(node)) {
    return false;
  }
  const keys = Object.keys(node).filter((key) => key !== 'win' && key !== 'totalWin');
  if (keys.length === 0) {
    return false;
  }
  if (Array.isArray(node.items) && node.items.length > 0) {
    return true;
  }
  return keys.some(
    (key) =>
      REMAINING_KEY.test(key) ||
      /lock|stick|hold|coin|apple|cell|position|respin|symbol/iu.test(key),
  );
}

function readSpinsLeftFromFreeSpin(freeSpin: unknown): number | undefined {
  if (!isRecord(freeSpin)) {
    return undefined;
  }
  for (const key of ['spinsLeft', 'spinsRemaining', 'remaining', 'left', 'roundsLeft']) {
    const n = readNumber(freeSpin[key]);
    if (n !== undefined) {
      return n;
    }
  }
  const items = freeSpin.items;
  if (!Array.isArray(items) || items.length === 0) {
    return undefined;
  }
  for (const item of items) {
    if (!isRecord(item)) {
      continue;
    }
    for (const key of ['spinsLeft', 'spinsRemaining', 'remaining', 'left']) {
      const n = readNumber(item[key]);
      if (n !== undefined) {
        return n;
      }
    }
  }
  return items.length > 0 ? items.length : undefined;
}

function readScatter(slot: Record<string, unknown> | undefined, body: unknown): {
  inFreeSpin: boolean;
  spinsLeft?: number;
} {
  const freeSpin = slot?.freeSpin ?? slot?.freeSpins ?? getByPath(body, 'slot.freeSpin');
  if (freeSpin === undefined || freeSpin === null || freeSpin === false) {
    return { inFreeSpin: false };
  }
  const spinsLeft = readSpinsLeftFromFreeSpin(freeSpin);
  const items = isRecord(freeSpin) && Array.isArray(freeSpin.items) ? freeSpin.items : [];
  const inFreeSpin = items.length > 0 || spinsLeft !== undefined;
  return { inFreeSpin, spinsLeft };
}

function inspectHoldNode(
  node: unknown,
): { active: boolean; respinsLeft?: number; lockedCount?: number } {
  let active = false;
  let respinsLeft: number | undefined;
  let lockedCount: number | undefined;
  if (node === undefined || node === null || node === false) {
    return { active: false };
  }
  if (isTrue(node)) {
    return { active: true };
  }
  const asNumber = readNumber(node);
  if (asNumber !== undefined && asNumber > 0 && asNumber <= 8) {
    return { active: true, respinsLeft: asNumber };
  }
  if (!isRecord(node)) {
    return { active: false };
  }
  for (const [inner, value] of Object.entries(node)) {
    if (REMAINING_KEY.test(inner)) {
      const n = readNumber(value);
      if (n !== undefined && n >= 0 && n <= 8) {
        respinsLeft = n;
        active = true;
      }
    }
    if (/lock|stick|hold|coins|apples|cells|positions/iu.test(inner)) {
      const n = countLocked(value);
      if (n > 0) {
        lockedCount = Math.max(lockedCount ?? 0, n);
        active = true;
      }
    }
    if (inner === 'items' && Array.isArray(value) && value.length > 0) {
      active = true;
    }
  }
  if (!active && bonusLooksLikeHold(node)) {
    active = true;
  }
  return { active, respinsLeft, lockedCount };
}

function readHold(
  slot: Record<string, unknown> | undefined,
  body: unknown,
  holdAndWinPath?: string,
): { active: boolean; respinsLeft?: number; lockedCount?: number } {
  let active = false;
  let respinsLeft: number | undefined;
  let lockedCount: number | undefined;

  const merge = (next: { active: boolean; respinsLeft?: number; lockedCount?: number }): void => {
    if (!next.active) {
      return;
    }
    active = true;
    if (next.respinsLeft !== undefined) {
      respinsLeft = next.respinsLeft;
    }
    if (next.lockedCount !== undefined) {
      lockedCount = Math.max(lockedCount ?? 0, next.lockedCount);
    }
  };

  if (holdAndWinPath !== undefined) {
    merge(inspectHoldNode(getByPath(body, holdAndWinPath)));
  }
  for (const path of HOLD_PATHS) {
    merge(inspectHoldNode(getByPath(body, path)));
  }
  if (slot !== undefined && bonusLooksLikeHold(slot.bonus)) {
    merge(inspectHoldNode(slot.bonus));
  }

  walk(body, (key, child) => {
    if (!HOLD_KEY.test(key)) {
      return;
    }
    merge(inspectHoldNode(child));
  });

  return { active, respinsLeft, lockedCount };
}

function readMaxWinFlag(body: unknown, flagPath?: string): boolean {
  if (flagPath !== undefined && isTrue(getByPath(body, flagPath))) {
    return true;
  }
  const slot = slotRoot(body);
  if (slot !== undefined && isTrue(slot.hasMaxWin)) {
    return true;
  }
  for (const path of ['hasMaxWin', 'data.hasMaxWin', 'data.slot.hasMaxWin', 'slot.hasMaxWin']) {
    if (isTrue(getByPath(body, path))) {
      return true;
    }
  }
  let hit = false;
  walk(body, (key, child) => {
    if (MAX_WIN_KEY.test(key) && isTrue(child)) {
      hit = true;
    }
  });
  return hit;
}

function readTotalWin(body: unknown): number | undefined {
  for (const path of ['slot.totalWin', 'data.slot.totalWin', 'slot.bonus.win', 'slot.base.win', 'totalWin', 'win']) {
    const n = readNumber(getByPath(body, path));
    if (n !== undefined && n > 0) {
      return n;
    }
  }
  return undefined;
}

export function describeSlotFlags(body: unknown): string {
  const slot = slotRoot(body);
  const keys = slot === undefined ? [] : Object.keys(slot);
  const freeSpin = slot?.freeSpin ?? slot?.freeSpins;
  const freeSpinKeys = isRecord(freeSpin) ? Object.keys(freeSpin).join(',') : String(freeSpin ?? '-');
  const bonus = slot?.bonus;
  const bonusKeys = isRecord(bonus) ? Object.keys(bonus).join(',') : String(bonus ?? '-');
  return `slotKeys=${keys.join(',') || '-'} hasMaxWin=${String(slot?.hasMaxWin ?? getByPath(body, 'slot.hasMaxWin') ?? '-')} freeSpin={${freeSpinKeys}} bonus={${bonusKeys}}`;
}

export function readBetView(
  body: unknown,
  options?: {
    readonly stake?: number;
    readonly maxWinFlagPath?: string;
    readonly maxWinMultiplier?: number;
    readonly maxWinAmount?: number;
    readonly holdBoardSize?: number;
    readonly holdAndWinPath?: string;
  },
): BetView {
  const slot = slotRoot(body);
  const scatter = readScatter(slot, body);
  const hold = readHold(slot, body, options?.holdAndWinPath);
  const totalWin = readTotalWin(body);
  const stake = options?.stake;
  const capFromMultiplier =
    stake !== undefined && options?.maxWinMultiplier !== undefined
      ? stake * options.maxWinMultiplier
      : undefined;
  const cap = options?.maxWinAmount ?? capFromMultiplier;
  const atCap = cap !== undefined && totalWin !== undefined && totalWin + 0.01 >= cap;
  const fullBoard =
    options?.holdBoardSize !== undefined &&
    hold.lockedCount !== undefined &&
    hold.lockedCount >= options.holdBoardSize;
  return {
    inFreeSpin: scatter.inFreeSpin,
    spinsLeft: scatter.spinsLeft,
    inHoldAndWin: hold.active,
    holdRespinsLeft: hold.respinsLeft,
    lockedCount: hold.lockedCount,
    maxWin: readMaxWinFlag(body, options?.maxWinFlagPath) || atCap || fullBoard,
    totalWin,
    stake,
    slotKeys: slot === undefined ? [] : Object.keys(slot),
  };
}

export class ScenarioWatcher {
  private previous?: BetView;
  private session: 'base' | 'freeSpin' | 'holdAndWin' = 'base';
  private latchedRetriggerOnLast = false;
  private latchedHoldAndWin = false;
  private latchedMaxWin = false;
  private readonly done = new Set<HuntScenarioId>();

  ingest(
    body: unknown,
    options?: {
      readonly stake?: number;
      readonly maxWinFlagPath?: string;
      readonly maxWinMultiplier?: number;
      readonly maxWinAmount?: number;
      readonly holdBoardSize?: number;
      readonly holdAndWinPath?: string;
    },
  ): ScenarioProgress {
    const view = readBetView(body, options);
    const prev = this.previous;
    const completed: HuntScenarioId[] = [];

    if (this.session === 'base' && (view.inFreeSpin || view.inHoldAndWin)) {
      this.session = view.inHoldAndWin && !view.inFreeSpin ? 'holdAndWin' : 'freeSpin';
      this.latchedRetriggerOnLast = false;
      this.latchedHoldAndWin = false;
      this.latchedMaxWin = false;
    }
    if (view.inHoldAndWin) {
      this.session = this.session === 'base' ? 'holdAndWin' : this.session;
      this.latchedHoldAndWin = true;
    }

    if (
      this.session !== 'base' &&
      prev?.inFreeSpin === true &&
      (prev.spinsLeft === 0 || prev.spinsLeft === 1) &&
      view.spinsLeft !== undefined &&
      prev.spinsLeft !== undefined &&
      view.spinsLeft > prev.spinsLeft
    ) {
      this.latchedRetriggerOnLast = true;
    }

    if (view.maxWin && (this.session !== 'base' || view.inFreeSpin || view.inHoldAndWin)) {
      this.latchedMaxWin = true;
    }

    const inScatter = view.inFreeSpin || this.session === 'freeSpin';
    const inHold = view.inHoldAndWin || this.latchedHoldAndWin || this.session === 'holdAndWin';

    // Dump on the /bet where the payload says it hit — max win often closes the round.
    if (view.maxWin && inHold && !this.done.has(SCENARIO_HOLDWIN_MAXWIN)) {
      this.done.add(SCENARIO_HOLDWIN_MAXWIN);
      completed.push(SCENARIO_HOLDWIN_MAXWIN);
    }
    if (view.maxWin && inScatter && !this.done.has(SCENARIO_RETRIGGER_MAXWIN)) {
      this.done.add(SCENARIO_RETRIGGER_MAXWIN);
      completed.push(SCENARIO_RETRIGGER_MAXWIN);
    }

    const leftFeature = this.session !== 'base' && !view.inFreeSpin && !view.inHoldAndWin;
    if (leftFeature) {
      if (this.latchedRetriggerOnLast && this.latchedMaxWin && !this.done.has(SCENARIO_RETRIGGER_MAXWIN)) {
        this.done.add(SCENARIO_RETRIGGER_MAXWIN);
        completed.push(SCENARIO_RETRIGGER_MAXWIN);
      }
      if (this.latchedHoldAndWin && this.latchedMaxWin && !this.done.has(SCENARIO_HOLDWIN_MAXWIN)) {
        this.done.add(SCENARIO_HOLDWIN_MAXWIN);
        completed.push(SCENARIO_HOLDWIN_MAXWIN);
      }
      this.session = 'base';
      this.latchedRetriggerOnLast = false;
      this.latchedHoldAndWin = false;
      this.latchedMaxWin = false;
    }

    this.previous = view;
    return {
      completed,
      view,
      session: this.session,
      latchedRetriggerOnLast: this.latchedRetriggerOnLast,
      latchedHoldAndWin: this.latchedHoldAndWin,
      latchedMaxWin: this.latchedMaxWin,
    };
  }

  captured(): ReadonlySet<HuntScenarioId> {
    return this.done;
  }
}
