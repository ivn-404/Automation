/**
 * PEN-071 — Slot client fields, session, and a dropped /bet response.
 *
 * Manual Test Case ID: PEN-071
 * Intent: PEN-070 covers stake sign, a forged balance, and sequential replay.
 * This case sends the other client-controlled fields (payout, feature flags,
 * line, identity), a tampered bearer, two in-flight copies, and one spin whose
 * response is withheld from the page. A pass is a rejection or a wallet that
 * moved by exactly the stake the server accepted. A missing round id is not
 * treated as protection.
 */

import type { Page, Route } from 'playwright';

import { test } from '../../fixtures/index.js';
import type { VerificationResult } from '../../../src/core/models/index.js';
import { settleCanvasToBaseGame } from '../../../src/platform/index.js';
import {
  InMemoryExecutionTracker,
  createDefaultExecutionReporters,
} from '../../../src/reporting/index.js';
import { ensureBaseHud } from '../../support/session-guard.js';
import { readLauncherBalance } from '../../support/launcher-balance.js';
import { expectPenChecks, penCheck, tamperJwt } from '../../support/pen-hub.js';
import {
  captureLiveSlotBet,
  postSlotBet,
  readSlotProbeText,
  unresolvedRefusal,
  type CapturedSlotBet,
  type SlotProbeResult,
} from '../../support/pen-slot.js';
import { spinForBet } from '../../support/canvas-bet-flow.js';

const MANUAL_TEST_ID = 'PEN-071' as const;
const FORGED_PAYOUT = 250_000;

test.describe('PEN — Slot client trust', () => {
  test(`${MANUAL_TEST_ID} slot /bet ignores client payouts and recovers a dropped response`, async ({
    sgapSession,
    sgapDriver,
    page,
  }, testInfo) => {
    test.setTimeout(420_000);
    const tracker = new InMemoryExecutionTracker();
    await tracker.start(MANUAL_TEST_ID, testInfo.project.name);
    testInfo.annotations.push(
      { type: 'manualTestId', description: MANUAL_TEST_ID },
      { type: 'category', description: 'PEN' },
      { type: 'gameId', description: sgapSession.manifest.gameId },
    );

    const evidence: Record<string, unknown> = {};
    try {
      await ensureBaseHud(sgapSession, sgapDriver, page);
      await settleCanvasToBaseGame(
        page,
        sgapDriver,
        sgapSession.manifest,
        sgapSession.platform.getInitializeBody(),
      );

      const ladder = readLadder(sgapSession.platform.getInitializeBody());
      const captured = await captureLiveSlotBet(page, sgapSession.manifest, () =>
        spinForBet(sgapSession, sgapDriver, page),
      );
      const stake = Number(captured.body.bet ?? '1');
      const hostBefore = await readLauncherBalance(page);
      const maxWin = ladder.maxWin ?? 5000;
      evidence.template = {
        keys: Object.keys(captured.body),
        stake,
        hostBefore,
        betLevels: ladder.levels,
        maxWin,
      };

      const results: VerificationResult[] = [];
      let cursor = hostBefore;

      const forged = await probe(page, captured, {
        ...captured.body,
        win: FORGED_PAYOUT,
        totalWin: FORGED_PAYOUT,
        multiplier: maxWin,
        multipliers: [maxWin, maxWin, maxWin],
        slot: { totalWin: FORGED_PAYOUT },
      });
      evidence.forgedPayout = summary(forged);
      results.push(outcomeCheck('Client win and multiplier fields were not paid out', cursor, forged, stake, maxWin));
      cursor = takeCursor(cursor, forged);

      const forcedFs = await probe(page, captured, { ...captured.body, isFs: true });
      evidence.isFs = summary(forcedFs);
      results.push(outcomeCheck('isFs without a feature did not waive the stake', cursor, forcedFs, stake, maxWin));
      cursor = takeCursor(cursor, forcedFs);

      const buyHigh = await probe(page, captured, { ...captured.body, buyFeat: 99 });
      evidence.buyFeat99 = summary(buyHigh);
      results.push(outcomeCheck('buyFeat 99 did not change the stake', cursor, buyHigh, stake, maxWin));
      cursor = takeCursor(cursor, buyHigh);

      const buyNeg = await probe(page, captured, { ...captured.body, buyFeat: -1 });
      evidence.buyFeatNeg = summary(buyNeg);
      results.push(outcomeCheck('buyFeat -1 did not change the stake', cursor, buyNeg, stake, maxWin));
      cursor = takeCursor(cursor, buyNeg);

      const lineZero = await probe(page, captured, { ...captured.body, line: 0 });
      evidence.lineZero = summary(lineZero);
      results.push(outcomeCheck('line 0 did not grant a free spin', cursor, lineZero, stake, maxWin));
      cursor = takeCursor(cursor, lineZero);

      const lineHigh = await probe(page, captured, { ...captured.body, line: 99 });
      evidence.line99 = summary(lineHigh);
      results.push(outcomeCheck('line 99 did not multiply the stake', cursor, lineHigh, stake, maxWin));
      cursor = takeCursor(cursor, lineHigh);

      const setBalance = await probe(page, captured, {
        ...captured.body,
        action: 'setBalance',
        balance: FORGED_PAYOUT,
        win: FORGED_PAYOUT,
      });
      evidence.setBalance = summary(setBalance);
      results.push(outcomeCheck('action setBalance was not applied', cursor, setBalance, stake, maxWin));
      cursor = takeCursor(cursor, setBalance);

      const minLevel = ladder.levels[0];
      const maxLevel = ladder.levels[ladder.levels.length - 1];
      const belowMin = minLevel !== undefined && minLevel > 0 ? trim(minLevel / 2) : '0.1';
      const aboveMax = maxLevel !== undefined ? trim(maxLevel + 1) : '56';
      evidence.bounds = { belowMin, aboveMax, minLevel, maxLevel };

      const outside: { readonly sent: string; readonly result: SlotProbeResult }[] = [];

      const tiny = await probe(page, captured, { ...captured.body, bet: belowMin });
      evidence.belowMin = { ...summary(tiny), debit: chargedStake(cursor, tiny) };
      outside.push({ sent: belowMin, result: tiny });
      results.push(
        outcomeCheck(
          `Stake ${belowMin} was rejected or debited exactly ${belowMin}`,
          cursor,
          tiny,
          Number(belowMin),
          maxWin,
        ),
      );
      cursor = takeCursor(cursor, tiny);

      const over = await probe(page, captured, { ...captured.body, bet: aboveMax });
      evidence.aboveMax = { ...summary(over), debit: chargedStake(cursor, over) };
      outside.push({ sent: aboveMax, result: over });
      results.push(
        outcomeCheck(
          `Stake ${aboveMax} was rejected or debited exactly ${aboveMax}`,
          cursor,
          over,
          Number(aboveMax),
          maxWin,
        ),
      );
      cursor = takeCursor(cursor, over);

      const offLadder = offLadderStake(ladder.levels);
      if (offLadder !== undefined) {
        const off = await probe(page, captured, { ...captured.body, bet: offLadder });
        evidence.offLadder = { stake: offLadder, ...summary(off), debit: chargedStake(cursor, off) };
        outside.push({ sent: offLadder, result: off });
        results.push(
          outcomeCheck(
            `Off-ladder stake ${offLadder} was rejected or charged as sent`,
            cursor,
            off,
            Number(offLadder),
            maxWin,
          ),
        );
        cursor = takeCursor(cursor, off);
      }

      const acceptedOutside = outside.filter((item) => item.result.status < 300);
      const blocked = outside.some((item) => unresolvedRefusal(item.result));
      results.push(
        penCheck(
          !blocked && acceptedOutside.length === 0,
          blocked
            ? `Stake checks did not run because a round was still open`
            : acceptedOutside.length === 0
              ? `Stakes outside initialize betLevels ${String(minLevel)}–${String(maxLevel)} were rejected`
              : `Server accepted ${acceptedOutside.map((item) => item.sent).join(', ')} outside initialize betLevels ${String(minLevel)}–${String(maxLevel)}`,
          'reject every stake that is not on betLevels',
          acceptedOutside.map((item) => ({ sent: item.sent, ...summary(item.result) })),
        ),
      );

      const precise = await probe(page, captured, { ...captured.body, bet: '1.111' });
      const debit = chargedStake(cursor, precise);
      evidence.precision = { ...summary(precise), debit };
      const precisionBlocked = unresolvedRefusal(precise);
      const precisionOk =
        !precisionBlocked && !precise.leaked && (precise.status >= 400 ? !credited(cursor, precise) : roundedToCents(debit, 1.11));
      results.push(
        penCheck(
          precisionOk,
          precisionBlocked
            ? `Stake 1.111 was not measured because a round was still open`
            : precisionOk
              ? `Stake 1.111 was rejected or rounded to 1.11 (HTTP ${precise.status}, debit ${debit ?? 'none'})`
              : `Stake 1.111 was charged at ${debit ?? 'an unknown debit'}, not currency precision 1.11`,
          'HTTP 4xx, or a debit of 1.11',
          summary(precise),
        ),
      );
      cursor = takeCursor(cursor, precise);

      const spoofed = await probe(page, captured, {
        ...captured.body,
        playerId: 'pen-other-player',
        operatorId: 'pen-other-operator',
        sessionId: 'pen-other-session',
      });
      evidence.spoofedIdentity = summary(spoofed);
      results.push(
        outcomeCheck('Spoofed playerId, operatorId, and sessionId were ignored', cursor, spoofed, stake, maxWin),
      );
      cursor = takeCursor(cursor, spoofed);

      const bearer = captured.headers.authorization?.replace(/^Bearer\s+/iu, '');
      const sessionEvidence: Record<string, unknown>[] = [];
      for (const variant of ['alg-none', 'flipped-claim', 'expired'] as const) {
        const tampered = bearer === undefined ? undefined : tamperJwt(bearer, variant);
        const result =
          tampered === undefined
            ? undefined
            : await postSlotBet(page, captured, captured.body, { authorization: `Bearer ${tampered}` });
        sessionEvidence.push({
          variant,
          forged: tampered !== undefined,
          ...(result !== undefined ? summary(result) : {}),
        });
        results.push(
          penCheck(
            result !== undefined && unauthorized(cursor, result),
            `Tampered bearer [${variant}] was rejected (HTTP ${result?.status ?? 'not a jwt'})`,
            '401 or 403',
            result?.status ?? 'token was not a jwt',
          ),
        );
      }
      evidence.session = sessionEvidence;

      const garbage = await postSlotBet(page, captured, captured.body, { authorization: 'Bearer not-a-token' });
      evidence.garbageBearer = summary(garbage);
      results.push(
        penCheck(
          unauthorized(cursor, garbage),
          `Garbage bearer was rejected (HTTP ${garbage.status})`,
          '401 or 403',
          garbage.status,
        ),
      );

      const [left, right] = await Promise.all([
        probe(page, captured, captured.body),
        probe(page, captured, captured.body),
      ]);
      evidence.parallel = { left: summary(left), right: summary(right) };
      const parallelOk = pairExplained(cursor, left, right, stake);
      results.push(
        penCheck(
          parallelOk,
          parallelOk
            ? `Two in-flight copies settled without a double credit (${cursor} → ${left.balance ?? 'none'} / ${right.balance ?? 'none'})`
            : `Two in-flight copies did not reconcile (${cursor} → ${left.balance ?? 'none'} / ${right.balance ?? 'none'})`,
          'one stake per accepted response, or one shared snapshot',
          evidence.parallel,
        ),
      );
      cursor = laterBalance(cursor, left, right, stake);

      const dropped = await dropClientResponse(page, sgapDriver, captured);
      evidence.dropped = dropped.seen.map((item) => ({
        delivered: item.delivered,
        stake: item.stake,
        ...summary(item.result),
      }));
      const dropOk = chainHolds(cursor, dropped.seen);
      results.push(
        penCheck(
          dropOk && dropped.seen.length > 0 && dropped.seen[0]?.delivered === false,
          dropOk
            ? `A /bet withheld from the page still moved the server wallet once per accepted request (${dropped.seen.length} request(s))`
            : `Dropped /bet did not leave a single coherent wallet (${dropped.seen.length} request(s))`,
          'server balance steps by each accepted stake',
          evidence.dropped,
        ),
      );
      cursor = afterChain(cursor, dropped.seen);

      const resumed = await probe(page, captured, captured.body);
      evidence.resumed = summary(resumed);
      results.push(outcomeCheck('The next bet resumed from the server wallet', cursor, resumed, stake, maxWin));
      cursor = takeCursor(cursor, resumed);

      evidence.hostAfter = await readLauncherBalance(page);
      evidence.serverCursor = cursor;

      await expectPenChecks(testInfo, results, evidence);
      await tracker.record({
        manualTestId: MANUAL_TEST_ID,
        status: 'passed',
        startedAt: (await tracker.get(MANUAL_TEST_ID))!.startedAt,
        finishedAt: new Date().toISOString(),
        browserProject: testInfo.project.name,
        verificationResults: results,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      await tracker.finish(MANUAL_TEST_ID, 'failed', message);
      throw error;
    } finally {
      await createDefaultExecutionReporters().publish(await tracker.list());
    }
  });
});

function probe(page: Page, captured: CapturedSlotBet, body: Record<string, unknown>) {
  return postSlotBet(page, captured, body);
}

interface SeenBet {
  readonly result: SlotProbeResult;
  readonly stake: number;
  readonly delivered: boolean;
}

async function dropClientResponse(
  page: Page,
  driver: {
    clickCanvas: (
      name: string,
      options?: { readonly singleInput?: boolean; readonly timeoutMs?: number },
    ) => Promise<unknown>;
  },
  captured: CapturedSlotBet,
): Promise<{ readonly seen: SeenBet[] }> {
  const seen: SeenBet[] = [];
  const pattern = '**/api/v1/slots/bet**';
  let notify: (() => void) | undefined;
  const arrived = new Promise<void>((resolve) => {
    notify = resolve;
  });
  const handler = async (route: Route): Promise<void> => {
    const payload = route.request().postDataJSON() as { bet?: unknown } | null;
    const sent = Number(payload?.bet ?? captured.body.bet ?? 1);
    const response = await route.fetch();
    const text = await response.text();
    const delivered = seen.length > 0;
    seen.push({
      result: readSlotProbeText(response.status(), text),
      stake: Number.isFinite(sent) ? sent : 1,
      delivered,
    });
    if (!delivered) {
      notify?.();
      await route.abort('failed');
      return;
    }
    await route.fulfill({
      status: response.status(),
      headers: response.headers(),
      body: text,
    });
  };
  await page.route(pattern, handler);
  try {
    await driver.clickCanvas('spin', { singleInput: true, timeoutMs: 15_000 });
    await Promise.race([
      arrived,
      new Promise<void>((_, reject) => {
        setTimeout(() => reject(new Error('spin click produced no /bet')), 25_000);
      }),
    ]);
    await page.waitForTimeout(1_200);
  } finally {
    await page.unroute(pattern, handler);
  }
  return { seen };
}

function summary(result: SlotProbeResult): Record<string, unknown> {
  return {
    status: result.status,
    ...(result.balance !== undefined ? { balance: result.balance } : {}),
    ...(result.roundId !== undefined ? { roundId: result.roundId } : {}),
    ...(result.win !== undefined ? { win: result.win } : {}),
    ...(result.freeSpinItems !== undefined ? { freeSpinItems: result.freeSpinItems } : {}),
    ...(result.message !== undefined ? { message: result.message } : {}),
    leaked: result.leaked,
  };
}

function outcomeCheck(
  label: string,
  before: number | undefined,
  result: SlotProbeResult,
  stake: number,
  maxWin: number,
): VerificationResult {
  const ok = settledClean(before, result, stake, maxWin);
  return penCheck(
    ok,
    ok
      ? `${label} (HTTP ${result.status}, balance ${result.balance ?? 'unchanged'}, win ${result.win ?? 'none'})`
      : `${label} failed (HTTP ${result.status}, ${result.message ?? 'no message'}, balance ${result.balance ?? 'none'}, win ${result.win ?? 'none'})`,
    'rejected, or balance = previous − stake + win, under the cap',
    summary(result),
  );
}

function settledClean(
  before: number | undefined,
  result: SlotProbeResult,
  stake: number,
  maxWin: number,
): boolean {
  if (result.leaked || (result.win ?? 0) >= FORGED_PAYOUT) {
    return false;
  }
  if (result.status >= 400) {
    return !unresolvedRefusal(result) && !credited(before, result);
  }
  if (before === undefined || result.balance === undefined || !Number.isFinite(stake)) {
    return false;
  }
  const expected = before - stake + (result.win ?? 0);
  if (Math.abs(result.balance - expected) <= 0.02) {
    return (result.win ?? 0) <= stake * maxWin + 0.02;
  }
  const withheld =
    result.roundId !== undefined &&
    (result.win ?? 0) > 0 &&
    (result.win ?? 0) < FORGED_PAYOUT &&
    Math.abs(result.balance - (before - stake)) <= 0.02;
  return withheld;
}

function unauthorized(before: number | undefined, result: SlotProbeResult): boolean {
  return (result.status === 401 || result.status === 403) && !result.leaked && !credited(before, result);
}

function chargedStake(before: number | undefined, result: SlotProbeResult): number | undefined {
  if (before === undefined || result.balance === undefined || result.status >= 300) {
    return undefined;
  }
  return before - result.balance + (result.win ?? 0);
}

function credited(before: number | undefined, result: SlotProbeResult): boolean {
  return before !== undefined && result.balance !== undefined && result.balance > before + 0.02;
}

function takeCursor(before: number | undefined, result: SlotProbeResult): number | undefined {
  if (result.status < 300 && result.balance !== undefined) {
    return result.balance;
  }
  return before;
}

function roundedToCents(debit: number | undefined, cents: number): boolean {
  return debit !== undefined && Math.abs(debit - cents) <= 0.0005;
}

function stepOf(from: number, item: SlotProbeResult, stake: number): number {
  return from - stake + (item.win ?? 0);
}

function near(actual: number | undefined, expected: number): boolean {
  return actual !== undefined && Math.abs(actual - expected) <= 0.02;
}

function pairExplained(
  start: number | undefined,
  left: SlotProbeResult,
  right: SlotProbeResult,
  stake: number,
): boolean {
  if (start === undefined || left.leaked || right.leaked || unresolvedRefusal(left) || unresolvedRefusal(right)) {
    return false;
  }
  const leftFirst =
    (left.status >= 300 ? !credited(start, left) : near(left.balance, stepOf(start, left, stake))) &&
    (left.status >= 300 || left.balance === undefined
      ? right.status >= 300
        ? !credited(start, right)
        : near(right.balance, stepOf(start, right, stake))
      : right.status >= 300
        ? !credited(left.balance, right)
        : near(right.balance, stepOf(left.balance, right, stake)));
  const rightFirst =
    (right.status >= 300 ? !credited(start, right) : near(right.balance, stepOf(start, right, stake))) &&
    (right.status >= 300 || right.balance === undefined
      ? left.status >= 300
        ? !credited(start, left)
        : near(left.balance, stepOf(start, left, stake))
      : left.status >= 300
        ? !credited(right.balance, left)
        : near(left.balance, stepOf(right.balance, left, stake)));
  const shared =
    left.status < 300 &&
    right.status < 300 &&
    near(left.balance, right.balance ?? Number.NaN) &&
    near(left.balance, stepOf(start, left, stake)) &&
    Math.abs((left.win ?? 0) - (right.win ?? 0)) <= 0.02;
  const both = start - 2 * stake + (left.win ?? 0) + (right.win ?? 0);
  const settledBoth =
    left.status < 300 &&
    right.status < 300 &&
    (near(left.balance, both) || near(right.balance, both)) &&
    (left.balance ?? 0) <= both + 0.02 &&
    (right.balance ?? 0) <= both + 0.02;
  return leftFirst || rightFirst || shared || settledBoth;
}

function laterBalance(
  start: number | undefined,
  left: SlotProbeResult,
  right: SlotProbeResult,
  stake: number,
): number | undefined {
  if (start === undefined || !pairExplained(start, left, right, stake)) {
    return start;
  }
  const leftThenRight =
    left.status < 300 &&
    left.balance !== undefined &&
    near(left.balance, stepOf(start, left, stake)) &&
    (right.status >= 300 ||
      (right.balance !== undefined && near(right.balance, stepOf(left.balance, right, stake))));
  if (leftThenRight) {
    return right.status < 300 && right.balance !== undefined ? right.balance : left.balance;
  }
  const rightThenLeft =
    right.status < 300 &&
    right.balance !== undefined &&
    near(right.balance, stepOf(start, right, stake)) &&
    (left.status >= 300 ||
      (left.balance !== undefined && near(left.balance, stepOf(right.balance, left, stake))));
  if (rightThenLeft) {
    return left.status < 300 && left.balance !== undefined ? left.balance : right.balance;
  }
  const both = start - 2 * stake + (left.win ?? 0) + (right.win ?? 0);
  if (near(left.balance, both) || near(right.balance, both)) {
    return both;
  }
  return left.balance ?? right.balance ?? start;
}

function chainHolds(start: number | undefined, seen: readonly SeenBet[]): boolean {
  if (start === undefined || seen.length === 0) {
    return false;
  }
  let cursor = start;
  for (const item of seen) {
    if (item.result.leaked || (item.result.win ?? 0) >= FORGED_PAYOUT) {
      return false;
    }
    if (item.result.status >= 300) {
      if (credited(cursor, item.result)) {
        return false;
      }
      continue;
    }
    if (item.result.balance === undefined) {
      return false;
    }
    const expected = cursor - item.stake + (item.result.win ?? 0);
    if (Math.abs(item.result.balance - expected) > 0.02) {
      return false;
    }
    if ((item.result.win ?? 0) > item.stake * 5000 + 0.02) {
      return false;
    }
    cursor = item.result.balance;
  }
  return true;
}

function afterChain(start: number | undefined, seen: readonly SeenBet[]): number | undefined {
  if (!chainHolds(start, seen) || start === undefined) {
    return start;
  }
  let cursor = start;
  for (const item of seen) {
    if (item.result.status < 300 && item.result.balance !== undefined) {
      cursor = item.result.balance;
    }
  }
  return cursor;
}

function readLadder(body: unknown): { readonly levels: number[]; readonly maxWin?: number } {
  const root = body !== null && typeof body === 'object' ? (body as Record<string, unknown>) : undefined;
  const data =
    root?.data !== null && typeof root?.data === 'object' ? (root.data as Record<string, unknown>) : root;
  const raw = data?.betLevels;
  const levels = Array.isArray(raw)
    ? raw.map(Number).filter((level) => Number.isFinite(level)).sort((a, b) => a - b)
    : [];
  const maxWin = typeof data?.maxWin === 'number' ? data.maxWin : undefined;
  return { levels, ...(maxWin !== undefined ? { maxWin } : {}) };
}

function offLadderStake(levels: readonly number[]): string | undefined {
  for (let index = 0; index < levels.length - 1; index += 1) {
    const low = levels[index];
    const high = levels[index + 1];
    if (low === undefined || high === undefined) {
      continue;
    }
    const mid = Math.round(((low + high) / 2) * 100) / 100;
    if (mid > low && mid < high && !levels.some((level) => Math.abs(level - mid) < 0.001)) {
      return trim(mid);
    }
  }
  return undefined;
}

function trim(value: number): string {
  return String(Math.round(value * 100) / 100);
}
