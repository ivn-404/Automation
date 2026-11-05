/**
 * PEN-072 — Titanic Transport cases that PEN-070 and PEN-071 do not already cover.
 *
 * TT-PT-001 local HUD edit, TT-PT-005 forged buy price, TT-PT-008 canvas multiplier
 * text when one is on screen, TT-PT-009 mismatched round id, TT-PT-023 ledger of
 * eight bets (not a ceiling), TT-PT-024 three concurrent bets, TT-PT-025 the bet
 * after a rejection. TT-PT-010 buys a feature, then checks the next bet is refused.
 * TT-PT-015 reloads and checks that round and balance are still the server's.
 * TT-PT-018 opens a second staging player and checks that player's wallet
 * after the first player sends that identity with a forged win.
 * TT-PT-008 spins until a position multiplier is on the reels, paints it,
 * and checks the next bet does not pay that painted value.
 * TT-PT-023 is PEN-073: a capped burst that stops on HTTP 429 or 5xx.
 */

import { test } from '../../fixtures/index.js';
import type { VerificationResult } from '../../../src/core/models/index.js';
import { settleCanvasToBaseGame, PlaywrightPlatform } from '../../../src/platform/index.js';
import {
  InMemoryExecutionTracker,
  createDefaultExecutionReporters,
} from '../../../src/reporting/index.js';
import { ensureBaseHud } from '../../support/session-guard.js';
import { readLauncherBalance } from '../../support/launcher-balance.js';
import { recordPenExchange } from '../../support/pen-evidence.js';
import { expectPenChecks, penCheck } from '../../support/pen-hub.js';
import {
  captureLiveSlotBet,
  postSlotBet,
  readInitializeSnapshot,
  unresolvedRefusal,
  type CapturedSlotBet,
  type SlotProbeResult,
} from '../../support/pen-slot.js';
import { spinForBet } from '../../support/canvas-bet-flow.js';
import {
  checkPositionMultiplierProgress,
  readTumbleClusterWins,
} from '../../../src/verification/position-multiplier.js';

const MANUAL_TEST_ID = 'PEN-072' as const;
const OTHER_PLAYER = 'Titanic Transport_PEN18B';
const FORGED_BALANCE = '999999.99';
const FORGED_WIN = 250_000;
const RAMP = 8;
const PARALLEL = 3;

test.describe('PEN — Slot pack gaps', () => {
  test(`${MANUAL_TEST_ID} remaining Titanic slot checks that one session can run`, async ({
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
      { type: 'ttPt', description: 'TT-PT-001,005,008,009,023,024,025' },
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
      const captured = await captureLiveSlotBet(page, sgapSession.manifest, () =>
        spinForBet(sgapSession, sgapDriver, page),
      );
      const stake = Number(captured.body.bet ?? '1');
      let cursor = await readLauncherBalance(page);
      const results: VerificationResult[] = [];

      const painted = await paintIdleTexts(page, sgapDriver.iframeSelector);
      evidence.hudPaint = painted;
      const afterPaint = await probe(page, captured, captured.body);
      evidence.afterHudPaint = summary(afterPaint);
      const hudIgnored =
        painted.balanceFrom !== undefined &&
        settled(cursor, afterPaint, stake) &&
        (afterPaint.balance ?? 0) < 100_000;
      results.push(
        penCheck(
          hudIgnored,
          hudIgnored
            ? `TT-PT-001 painted HUD ${painted.balanceFrom} → ${FORGED_BALANCE} and the server balance stayed ${afterPaint.balance}`
            : `TT-PT-001 could not show a local balance edit leaving the server wallet unchanged (${painted.balanceFrom ?? 'no balance text'} → ${afterPaint.balance ?? 'none'})`,
          'server balance stays the real wallet',
          { painted, after: summary(afterPaint) },
        ),
      );
      cursor = take(cursor, afterPaint);

      if (painted.multiplierFrom !== undefined) {
        const canvasWin = await probe(page, captured, captured.body);
        evidence.canvasMultiplier = { painted: painted.multiplierFrom, ...summary(canvasWin) };
        const ignored = settled(cursor, canvasWin, stake) && (canvasWin.win ?? 0) < stake * 100;
        results.push(
          penCheck(
            ignored,
            ignored
              ? `TT-PT-008 changed on-screen "${painted.multiplierFrom}" to 5000x and the server paid ${canvasWin.win ?? 0}`
              : `TT-PT-008 on-screen multiplier edit was reflected in the payout (win ${canvasWin.win ?? 'none'})`,
            'server win is not the painted 5000x',
            summary(canvasWin),
          ),
        );
        cursor = take(cursor, canvasWin);
      }

      const foreignRound = await probe(page, captured, {
        ...captured.body,
        roundId: '00000000-0000-0000-0000-000000000099',
        unresolvedSpin: '00000000-0000-0000-0000-000000000099',
        win: FORGED_WIN,
      });
      evidence.foreignRound = summary(foreignRound);
      const unresolved = /unresolved/i.test(foreignRound.message ?? '');
      const rejectedClean =
        foreignRound.status >= 400 &&
        !foreignRound.leaked &&
        (foreignRound.win ?? 0) < FORGED_WIN &&
        (foreignRound.balance === undefined || (cursor !== undefined && foreignRound.balance <= cursor + 0.02));
      const roundOk =
        !unresolved &&
        (rejectedClean || (acceptedSpin(cursor, foreignRound, stake) && (foreignRound.win ?? 0) < FORGED_WIN));
      results.push(
        penCheck(
          roundOk,
          roundOk
            ? `TT-PT-009 mismatched round id ${foreignRound.status >= 400 ? 'was rejected' : 'was booked as one stake'} (HTTP ${foreignRound.status}, win ${foreignRound.win ?? 'none'})`
            : `TT-PT-009 mismatched round id did not settle on its own (HTTP ${foreignRound.status}, ${foreignRound.message ?? 'no message'}, win ${foreignRound.win ?? 'none'})`,
          'rejected with no credit, or one stake and the server win',
          summary(foreignRound),
        ),
      );
      cursor = take(cursor, foreignRound);

      const rejected = await probe(page, captured, { ...captured.body, bet: '-100' });
      evidence.rejected = summary(rejected);
      const resumed = await probe(page, captured, captured.body);
      evidence.resumed = summary(resumed);
      const recovered = rejected.status >= 400 && !rejected.leaked && acceptedSpin(cursor, resumed, stake);
      results.push(
        penCheck(
          recovered,
          recovered
            ? `TT-PT-025 after HTTP ${rejected.status} the next bet resumed at ${resumed.balance}`
            : `TT-PT-025 the bet after a rejection did not resume (reject HTTP ${rejected.status} ${rejected.message ?? ''}, next HTTP ${resumed.status} ${resumed.balance ?? 'no balance'})`,
          'rejection, then one stake',
          { rejected: summary(rejected), resumed: summary(resumed) },
        ),
      );
      cursor = take(cursor, resumed);

      const ramp: SlotProbeResult[] = [];
      let rampOk = true;
      evidence.rampStart = cursor;
      for (let index = 0; index < RAMP; index += 1) {
        const step = await probe(page, captured, captured.body);
        ramp.push(step);
        if (!acceptedSpin(cursor, step, stake)) {
          rampOk = false;
        }
        cursor = take(cursor, step);
      }
      evidence.ramp = ramp.map(summary);
      const limited = ramp.some((step) => step.status === 429);
      results.push(
        penCheck(
          rampOk,
          rampOk
            ? `TT-PT-023 eight sequential bets ${limited ? 'hit HTTP 429' : 'each moved the wallet by one stake. No ceiling was observed'}`
            : 'TT-PT-023 eight sequential bets did not each move the wallet by one stake',
          'each accepted bet moves balance by stake − win',
          evidence.ramp,
        ),
      );

      const burstStart = cursor;
      const burst = await Promise.all(
        Array.from({ length: PARALLEL }, () => probe(page, captured, captured.body)),
      );
      evidence.burst = burst.map(summary);
      const accepted = burst.filter((step) => step.status < 300 && step.balance !== undefined);
      const final = burstFinal(burstStart, accepted, stake);
      const credited =
        burstStart !== undefined &&
        accepted.every((step) => (step.balance ?? 0) <= burstStart + (step.win ?? 0) + 0.02);
      const follow = await probe(page, captured, captured.body);
      const followOk =
        final !== undefined &&
        accepted.length === PARALLEL &&
        credited &&
        !burst.some((step) => step.leaked) &&
        acceptedSpin(final, follow, stake);
      evidence.burstFollow = summary(follow);
      results.push(
        penCheck(
          followOk,
          followOk
            ? `TT-PT-024 three concurrent bets settled at ${final}, then the next bet was ${follow.balance}`
            : `TT-PT-024 three concurrent bets did not leave one wallet (expected ${final}, accepted ${accepted.length}, next HTTP ${follow.status} ${follow.balance ?? 'no balance'})`,
          'final = start − N × stake + Σwins, then one more stake',
          { burst: evidence.burst, follow: summary(follow) },
        ),
      );
      cursor = take(final, follow);

      const forgedBuy = await probe(page, captured, {
        ...captured.body,
        buyFeat: 2,
        totalBet: '1',
        price: 1,
      });
      evidence.forgedBuy = summary(forgedBuy);
      const buyOk = buyPriceHeld(cursor, forgedBuy, stake);
      results.push(
        penCheck(
          buyOk,
          buyOk
            ? `TT-PT-005 forged buy price was not the feature cost (HTTP ${forgedBuy.status}, balance ${forgedBuy.balance ?? 'unchanged'}, freeSpins ${forgedBuy.freeSpinItems ?? 0})`
            : `TT-PT-005 a feature was granted without the 500x debit (HTTP ${forgedBuy.status}, balance ${forgedBuy.balance ?? 'none'})`,
          'reject, bill one base stake with no feature, or bill the 500x option',
          summary(forgedBuy),
        ),
      );

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

  test('TT-PT-010 bet during an unresolved round, then TT-PT-015 refresh', async ({
    sgapSession,
    sgapDriver,
    page,
  }, testInfo) => {
    test.setTimeout(480_000);
    const tracker = new InMemoryExecutionTracker();
    await tracker.start('TT-PT-010', testInfo.project.name);
    testInfo.annotations.push(
      { type: 'manualTestId', description: 'TT-PT-010' },
      { type: 'category', description: 'PEN' },
      { type: 'ttPt', description: 'TT-PT-010,TT-PT-015' },
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
      const captured = await captureLiveSlotBet(page, sgapSession.manifest, () =>
        spinForBet(sgapSession, sgapDriver, page),
      );
      const before = await readLauncherBalance(page);
      const stake = Number(captured.body.bet ?? '1');
      const buy = await probe(page, captured, { ...captured.body, buyFeat: 2 });
      evidence.buy = summary(buy);
      const opened =
        buyPriceHeld(before, buy, stake) && (buy.freeSpinItems ?? 0) > 0 && buy.balance !== undefined;
      const during = opened ? await probe(page, captured, captured.body) : undefined;
      evidence.during = during !== undefined ? summary(during) : { opened: false };
      const refused =
        during !== undefined &&
        unresolvedRefusal(during) &&
        !during.leaked &&
        (during.balance === undefined || during.balance <= (buy.balance ?? 0) + 0.02);
      const results: VerificationResult[] = [
        penCheck(
          refused,
          refused
            ? `TT-PT-010 a bet during the open feature was refused (HTTP ${during?.status}, ${during?.message ?? 'no message'})`
            : `TT-PT-010 a bet during the open feature was not refused (buy HTTP ${buy.status}, freeSpins ${buy.freeSpinItems ?? 0}, next HTTP ${during?.status ?? 'not sent'})`,
          'HTTP 422 unresolved spin, wallet not credited',
          { buy: summary(buy), during: during !== undefined ? summary(during) : undefined },
        ),
      ];

      if (opened && buy.balance !== undefined) {
        const loadTimeoutMs = 90_000;
        const boughtBalance = buy.balance;
        let nextAuthorization: string | undefined;
        let balanceResponse: { json(): Promise<unknown> } | undefined;
        const seenSlots: string[] = [];
        const onRequest = (request: { url(): string; headers(): Record<string, string> }): void => {
          if (!request.url().includes('/api/v1/slots/')) {
            return;
          }
          const authorization = request.headers().authorization;
          if (authorization !== undefined && authorization.length > 0) {
            nextAuthorization = authorization;
          }
        };
        const onResponse = (response: { ok(): boolean; url(): string; json(): Promise<unknown> }): void => {
          if (!response.url().includes('/api/v1/slots/')) {
            return;
          }
          seenSlots.push(response.url());
          if (response.ok() && response.url().includes('/api/v1/slots/balance')) {
            balanceResponse = response;
          }
        };
        page.on('request', onRequest);
        page.on('response', onResponse);
        try {
          await page.reload({ waitUntil: 'domcontentloaded', timeout: loadTimeoutMs });
          await sgapSession.platform.openGameHost({ timeoutMs: loadTimeoutMs });
          await sgapSession.platform.openGame({ timeoutMs: loadTimeoutMs });
          const deadline = Date.now() + 10_000;
          while (balanceResponse === undefined && Date.now() < deadline) {
            await page.waitForTimeout(200);
          }
        } finally {
          page.off('request', onRequest);
          page.off('response', onResponse);
        }
        const balanceBody = await balanceResponse?.json().catch(() => undefined);
        const serverBalance = readInitializeSnapshot(balanceBody).balance;
        const snapshot = readInitializeSnapshot(sgapSession.platform.getInitializeBody());
        evidence.initialize = snapshot;
        evidence.serverBalance = serverBalance;
        evidence.seenSlots = seenSlots;
        const refreshed: CapturedSlotBet = {
          ...captured,
          headers: {
            ...(nextAuthorization !== undefined ? { authorization: nextAuthorization } : {}),
            'content-type': captured.headers['content-type'] ?? 'application/json',
          },
        };
        const after =
          nextAuthorization === undefined
            ? undefined
            : await probe(page, refreshed, captured.body);
        evidence.afterRefresh = after !== undefined ? summary(after) : { authorization: 'missing' };
        const sameBalance = serverBalance !== undefined && Math.abs(serverBalance - boughtBalance) <= 0.02;
        const stillRefused =
          after !== undefined &&
          unresolvedRefusal(after) &&
          !after.leaked &&
          (after.balance === undefined || after.balance <= boughtBalance + 0.02);
        const recovered = snapshot.roundId !== undefined && sameBalance && stillRefused;
        results.push(
          penCheck(
            recovered,
            recovered
              ? `TT-PT-015 after refresh round ${snapshot.roundId} was still open and the wallet stayed ${serverBalance}`
              : `TT-PT-015 refresh did not keep the open round (round ${snapshot.roundId ?? 'none'}, wallet ${serverBalance ?? 'none'}, slots ${seenSlots.length}, next HTTP ${after?.status ?? 'no session'} ${after?.message ?? ''})`,
            'initialize keeps the round, the balance call stays at the post-buy wallet, and a new-session bet is refused',
            { snapshot, serverBalance, after: after !== undefined ? summary(after) : undefined, buyBalance: boughtBalance },
          ),
        );
      } else {
        results.push(
          penCheck(
            false,
            'TT-PT-015 refresh was not run because the feature round did not open',
            'an open round to refresh into',
            summary(buy),
          ),
        );
      }

      await expectPenChecks(testInfo, results, evidence);
      await tracker.record({
        manualTestId: 'TT-PT-010',
        status: 'passed',
        startedAt: (await tracker.get('TT-PT-010'))!.startedAt,
        finishedAt: new Date().toISOString(),
        browserProject: testInfo.project.name,
        verificationResults: results,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      await tracker.finish('TT-PT-010', 'failed', message);
      throw error;
    } finally {
      await createDefaultExecutionReporters().publish(await tracker.list());
    }
  });

  test('TT-PT-018 another player wallet', async ({
    sgapSession,
    sgapDriver,
    page,
  }, testInfo) => {
    test.setTimeout(480_000);
    const tracker = new InMemoryExecutionTracker();
    await tracker.start('TT-PT-018', testInfo.project.name);
    testInfo.annotations.push(
      { type: 'manualTestId', description: 'TT-PT-018' },
      { type: 'category', description: 'PEN' },
      { type: 'ttPt', description: 'TT-PT-018' },
      { type: 'gameId', description: sgapSession.manifest.gameId },
    );

    const evidence: Record<string, unknown> = {};
    let closeOther: (() => Promise<void>) | undefined;
    try {
      await ensureBaseHud(sgapSession, sgapDriver, page);
      await settleCanvasToBaseGame(
        page,
        sgapDriver,
        sgapSession.manifest,
        sgapSession.platform.getInitializeBody(),
      );
      const captured = await captureLiveSlotBet(page, sgapSession.manifest, () =>
        spinForBet(sgapSession, sgapDriver, page),
      );
      const other = await openOtherPlayer(page, sgapSession);
      closeOther = other.close;
      const before = await readOtherBalance(page, captured.url, other.authorization);
      evidence.other = {
        playerId: other.playerId,
        balance: before,
        sessionId: other.sessionId,
      };
      const attack = await probe(page, captured, {
        ...captured.body,
        playerId: other.playerId,
        ...(other.operatorId !== undefined ? { operatorId: other.operatorId } : {}),
        ...(other.sessionId !== undefined ? { sessionId: other.sessionId } : {}),
        win: FORGED_WIN,
        balance: FORGED_BALANCE,
      });
      evidence.attack = summary(attack);
      const after = await readOtherBalance(page, captured.url, other.authorization);
      evidence.otherAfter = after;
      const unchanged = before !== undefined && after !== undefined && Math.abs(after - before) <= 0.02;
      const isolated = unchanged && !attack.leaked && (attack.win ?? 0) < FORGED_WIN;
      const results: VerificationResult[] = [
        penCheck(
          isolated,
          isolated
            ? `TT-PT-018 ${other.playerId} stayed at ${after} after the other session sent a forged win (HTTP ${attack.status})`
            : `TT-PT-018 the other wallet did not stay put (before ${before ?? 'none'}, after ${after ?? 'none'}, HTTP ${attack.status} ${attack.message ?? ''})`,
          'the second player balance is unchanged and the forged win is not paid',
          { before, after, attack: summary(attack) },
        ),
      ];
      await expectPenChecks(testInfo, results, evidence);
      await tracker.record({
        manualTestId: 'TT-PT-018',
        status: 'passed',
        startedAt: (await tracker.get('TT-PT-018'))!.startedAt,
        finishedAt: new Date().toISOString(),
        browserProject: testInfo.project.name,
        verificationResults: results,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      await tracker.finish('TT-PT-018', 'failed', message);
      throw error;
    } finally {
      await closeOther?.();
      await createDefaultExecutionReporters().publish(await tracker.list());
    }
  });

  test('TT-PT-008 painted position multiplier', async ({
    sgapSession,
    sgapDriver,
    page,
  }, testInfo) => {
    test.setTimeout(600_000);
    const tracker = new InMemoryExecutionTracker();
    await tracker.start('TT-PT-008', testInfo.project.name);
    testInfo.annotations.push(
      { type: 'manualTestId', description: 'TT-PT-008' },
      { type: 'category', description: 'PEN' },
      { type: 'ttPt', description: 'TT-PT-008' },
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
      const captured = await captureLiveSlotBet(page, sgapSession.manifest, () =>
        spinForBet(sgapSession, sgapDriver, page),
      );
      const stake = Number(captured.body.bet ?? '1');
      const hunt: { readonly paid?: number; readonly sample: readonly string[] }[] = [];
      let painted: { from?: string; sample: string[] } = { sample: [] };
      let cursor = await readLauncherBalance(page);
      for (let index = 0; index < 6 && painted.from === undefined; index += 1) {
        const bet = await spinForBet(sgapSession, sgapDriver, page);
        const steps = checkPositionMultiplierProgress(readTumbleClusterWins(bet.raw, 'slot.tumbles'));
        const paid = steps.filter((step) => step.applied > 1).map((step) => step.applied);
        const amount = bet.balance?.amount;
        const parsed = amount === undefined ? Number.NaN : Number(amount);
        if (Number.isFinite(parsed)) {
          cursor = parsed;
        }
        await settleCanvasToBaseGame(
          page,
          sgapDriver,
          sgapSession.manifest,
          sgapSession.platform.getInitializeBody(),
        );
        painted = await paintMultiplierMark(page, sgapDriver.iframeSelector);
        hunt.push({ ...(paid.length > 0 ? { paid: paid[paid.length - 1] } : {}), sample: painted.sample });
        if (bet.transactionState !== undefined && bet.transactionState !== 'completed') {
          break;
        }
      }
      evidence.hunt = hunt;
      evidence.painted = painted;
      const canvasWin = painted.from !== undefined ? await probe(page, captured, captured.body) : undefined;
      evidence.canvasWin = canvasWin !== undefined ? summary(canvasWin) : undefined;
      await recordPenExchange({
        page,
        title: painted.from !== undefined ? `Painted reel text ${painted.from} to 5000x` : 'No position-multiplier text on the reels',
        request: { lookedFor: 'x2, x4, x8, x16, or x32 on the reel band', found: painted.sample.slice(0, 12) },
        response: canvasWin !== undefined ? summary(canvasWin) : { posted: false, reason: 'no reel multiplier to paint' },
      });
      const ignored =
        painted.from !== undefined &&
        canvasWin !== undefined &&
        settled(cursor, canvasWin, stake) &&
        (canvasWin.win ?? 0) < stake * 100;
      const results: VerificationResult[] = [
        penCheck(
          ignored,
          ignored
            ? `TT-PT-008 painted on-screen "${painted.from}" to 5000x and the server paid ${canvasWin?.win ?? 0}`
            : `TT-PT-008 did not show a position multiplier leaving the server win unchanged (${(painted.from ?? painted.sample.slice(0, 8).join(', ')) || 'no reel text'})`,
          'a visible multiplier is painted to 5000x and the next bet pays the server win',
          { painted, hunt, after: canvasWin !== undefined ? summary(canvasWin) : undefined },
        ),
      ];
      await expectPenChecks(testInfo, results, evidence);
      await tracker.record({
        manualTestId: 'TT-PT-008',
        status: 'passed',
        startedAt: (await tracker.get('TT-PT-008'))!.startedAt,
        finishedAt: new Date().toISOString(),
        browserProject: testInfo.project.name,
        verificationResults: results,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      await tracker.finish('TT-PT-008', 'failed', message);
      throw error;
    } finally {
      await createDefaultExecutionReporters().publish(await tracker.list());
    }
  });
});

function probe(page: Parameters<typeof postSlotBet>[0], captured: CapturedSlotBet, body: Record<string, unknown>) {
  return postSlotBet(page, captured, body);
}

async function openOtherPlayer(
  page: Parameters<typeof postSlotBet>[0],
  session: {
    environment: ConstructorParameters<typeof PlaywrightPlatform>[0]['environment'];
    manifest: ConstructorParameters<typeof PlaywrightPlatform>[0]['manifest'];
    ui: ConstructorParameters<typeof PlaywrightPlatform>[0]['ui'];
  },
): Promise<{
  playerId: string;
  operatorId?: string;
  sessionId?: string;
  authorization?: string;
  close: () => Promise<void>;
}> {
  const browser = page.context().browser();
  if (browser === null) {
    return { playerId: OTHER_PLAYER, close: async () => undefined };
  }
  const context = await browser.newContext({ viewport: { width: 960, height: 1032 } });
  const otherPage = await context.newPage();
  const previous = process.env.SGAP_PLAYER_ID;
  process.env.SGAP_PLAYER_ID = OTHER_PLAYER;
  let authorization: string | undefined;
  const onRequest = (request: { url(): string; headers(): { authorization?: string } }): void => {
    if (!request.url().includes('/api/v1/slots/')) {
      return;
    }
    const header = request.headers().authorization;
    if (header !== undefined && header.length > 0) {
      authorization = header;
    }
  };
  otherPage.on('request', onRequest);
  try {
    const platform = new PlaywrightPlatform({
      page: otherPage,
      environment: session.environment,
      manifest: session.manifest,
      ui: session.ui,
    });
    const timeoutMs = 90_000;
    await platform.openGameHost({ timeoutMs });
    await platform.openGame({ timeoutMs });
    await platform.prepareGameView('desktop', { timeoutMs });
    const deadline = Date.now() + 10_000;
    while (authorization === undefined && Date.now() < deadline) {
      await otherPage.waitForTimeout(200);
    }
    const identity = playerIdentity(platform.getInitializeBody());
    return {
      playerId: identity.playerId ?? OTHER_PLAYER,
      ...(identity.operatorId !== undefined ? { operatorId: identity.operatorId } : {}),
      ...(identity.sessionId !== undefined ? { sessionId: identity.sessionId } : {}),
      ...(authorization !== undefined ? { authorization } : {}),
      close: async () => {
        otherPage.off('request', onRequest);
        await context.close();
      },
    };
  } catch (error: unknown) {
    otherPage.off('request', onRequest);
    await context.close();
    if (previous === undefined) {
      delete process.env.SGAP_PLAYER_ID;
    } else {
      process.env.SGAP_PLAYER_ID = previous;
    }
    throw error;
  } finally {
    if (process.env.SGAP_PLAYER_ID === OTHER_PLAYER) {
      if (previous === undefined) {
        delete process.env.SGAP_PLAYER_ID;
      } else {
        process.env.SGAP_PLAYER_ID = previous;
      }
    }
  }
}

function playerIdentity(body: unknown): { playerId?: string; operatorId?: string; sessionId?: string } {
  const record = body !== null && typeof body === 'object' ? (body as Record<string, unknown>) : undefined;
  const nested = record?.data;
  const root = nested !== null && typeof nested === 'object' ? (nested as Record<string, unknown>) : record;
  const text = (value: unknown): string | undefined =>
    typeof value === 'string' && value.length > 0 ? value : undefined;
  return {
    ...(text(root?.playerId) !== undefined ? { playerId: text(root?.playerId) } : {}),
    ...(text(root?.operatorId) !== undefined ? { operatorId: text(root?.operatorId) } : {}),
    ...(text(root?.sessionId) !== undefined ? { sessionId: text(root?.sessionId) } : {}),
  };
}

async function readOtherBalance(
  page: Parameters<typeof postSlotBet>[0],
  betUrl: string,
  authorization: string | undefined,
): Promise<number | undefined> {
  if (authorization === undefined) {
    return undefined;
  }
  const url = new URL(betUrl);
  url.pathname = '/api/v1/slots/balance';
  url.search = '';
  const response = await page.request.post(url.href, {
    headers: { authorization, 'content-type': 'application/json' },
    data: {},
    failOnStatusCode: false,
    timeout: 20_000,
  });
  if (!response.ok()) {
    return undefined;
  }
  return readInitializeSnapshot(await response.json()).balance;
}

async function paintMultiplierMark(
  page: Parameters<typeof postSlotBet>[0],
  iframeSelector: string,
): Promise<{ from?: string; sample: string[] }> {
  const iframe = page.locator(iframeSelector).first();
  const handle = (await iframe.count()) === 0 ? null : await iframe.elementHandle();
  const frame = await handle?.contentFrame();
  if (frame === null || frame === undefined) {
    return { sample: [] };
  }
  return frame.evaluate(() => {
    const win = window as Window & { Phaser?: { GAMES?: unknown[] }; phaserGame?: unknown };
    const games: unknown[] = [];
    const push = (value: unknown): void => {
      if (value !== null && typeof value === 'object' && !games.includes(value)) {
        games.push(value);
      }
    };
    push(win.phaserGame);
    for (const game of win.Phaser?.GAMES ?? []) {
      push(game);
    }
    const sample: string[] = [];
    const remember = (label: string): void => {
      if (sample.length < 24 && !sample.includes(label)) {
        sample.push(label);
      }
    };
    let from: string | undefined;
    const mark = /^(?:x|×)?\s*(?:2|4|8|16|32)(?:\.0+)?\s*(?:x|×)?$/iu;
    const walk = (node: {
      visible?: boolean;
      alpha?: number;
      type?: string;
      text?: string;
      name?: string;
      setText?: (value: string) => void;
      texture?: { key?: string };
      frame?: { name?: string };
      getBounds?: () => { y: number; height: number };
      list?: unknown[];
      children?: { list?: unknown[] };
    } | null, gameHeight: number): void => {
      if (from !== undefined || node === null || typeof node !== 'object' || node.visible === false) {
        return;
      }
      if (typeof node.alpha === 'number' && node.alpha <= 0.01) {
        return;
      }
      const type = node.type ?? '';
      const text = typeof node.text === 'string' ? node.text.trim() : '';
      const texture = node.texture?.key ?? '';
      const frameName = typeof node.frame?.name === 'string' ? node.frame.name : '';
      const label = [type, node.name, text, texture, frameName].filter((part) => part !== undefined && part !== '').join(':');
      let boundsY = 0;
      try {
        boundsY = node.getBounds?.().y ?? 0;
      } catch {
        boundsY = 0;
      }
      const onReel = gameHeight === 0 || (boundsY > gameHeight * 0.12 && boundsY < gameHeight * 0.82);
      if (onReel && label.length > 0 && /mult|mark|badge|glow/iu.test(label)) {
        remember(label.slice(0, 80));
      }
      if (onReel && text.length > 0 && text.length < 12) {
        remember(`text:${text}`);
      }
      if (from === undefined && onReel && typeof node.setText === 'function' && mark.test(text)) {
        from = text;
        node.setText('5000x');
        return;
      }
      const kids = Array.isArray(node.list) ? node.list : Array.isArray(node.children?.list) ? node.children.list : [];
      for (const child of kids) {
        walk(child as Parameters<typeof walk>[0], gameHeight);
      }
    };
    for (const game of games) {
      const height = (game as { scale?: { height?: number } }).scale?.height ?? 0;
      const scenes = (game as { scene?: { getScenes?: (active: boolean) => unknown[] } }).scene?.getScenes?.(true) ?? [];
      for (const scene of scenes) {
        for (const root of (scene as { children?: { list?: unknown[] } }).children?.list ?? []) {
          walk(root as Parameters<typeof walk>[0], height);
        }
      }
    }
    return { ...(from !== undefined ? { from } : {}), sample };
  });
}

async function paintIdleTexts(
  page: Parameters<typeof postSlotBet>[0],
  iframeSelector: string,
): Promise<{ balanceFrom?: string; multiplierFrom?: string }> {
  const iframe = page.locator(iframeSelector).first();
  const handle = (await iframe.count()) === 0 ? null : await iframe.elementHandle();
  const frame = await handle?.contentFrame();
  if (frame === null || frame === undefined) {
    return {};
  }
  return frame.evaluate((forged) => {
    const win = window as Window & { Phaser?: { GAMES?: unknown[] }; phaserGame?: unknown };
    const games: unknown[] = [];
    const push = (value: unknown): void => {
      if (value !== null && typeof value === 'object' && !games.includes(value)) {
        games.push(value);
      }
    };
    push(win.phaserGame);
    for (const game of win.Phaser?.GAMES ?? []) {
      push(game);
    }
    const nodes: { text: string; set: (value: string) => void }[] = [];
    const walk = (node: { visible?: boolean; alpha?: number; type?: string; text?: string; setText?: (value: string) => void; list?: unknown[]; children?: { list?: unknown[] } } | null): void => {
      if (node === null || typeof node !== 'object' || node.visible === false) {
        return;
      }
      if ((node.type === 'Text' || node.type === 'BitmapText') && typeof node.text === 'string' && typeof node.setText === 'function') {
        nodes.push({ text: node.text.trim(), set: (value) => node.setText!(value) });
      }
      const kids = Array.isArray(node.list) ? node.list : Array.isArray(node.children?.list) ? node.children.list : [];
      for (const child of kids) {
        walk(child as typeof node);
      }
    };
    for (const game of games) {
      const scenes = (game as { scene?: { getScenes?: (active: boolean) => unknown[] } }).scene?.getScenes?.(true) ?? [];
      for (const scene of scenes) {
        for (const root of (scene as { children?: { list?: unknown[] } }).children?.list ?? []) {
          walk(root as Parameters<typeof walk>[0]);
        }
      }
    }
    const amount = nodes.find((node) => /^\d[\d,]*\.\d{2}$/u.test(node.text.replace(/[^\d.,]/gu, '')));
    const multiplier = nodes.find((node) => /^\d+(\.\d+)?x$/iu.test(node.text));
    const painted: { balanceFrom?: string; multiplierFrom?: string } = {};
    if (amount !== undefined) {
      painted.balanceFrom = amount.text;
      amount.set(forged);
    }
    if (multiplier !== undefined) {
      painted.multiplierFrom = multiplier.text;
      multiplier.set('5000x');
    }
    return painted;
  }, FORGED_BALANCE);
}

function summary(result: SlotProbeResult): Record<string, unknown> {
  return {
    status: result.status,
    ...(result.balance !== undefined ? { balance: result.balance } : {}),
    ...(result.win !== undefined ? { win: result.win } : {}),
    ...(result.freeSpinItems !== undefined ? { freeSpinItems: result.freeSpinItems } : {}),
    ...(result.message !== undefined ? { message: result.message } : {}),
    leaked: result.leaked,
  };
}

function settled(before: number | undefined, result: SlotProbeResult, stake: number): boolean {
  if (result.leaked || (result.win ?? 0) >= FORGED_WIN) {
    return false;
  }
  if (result.status >= 400) {
    return result.balance === undefined || before === undefined || result.balance <= before + 0.02;
  }
  if (before === undefined || result.balance === undefined) {
    return false;
  }
  return Math.abs(result.balance - (before - stake + (result.win ?? 0))) <= 0.02;
}

function acceptedSpin(before: number | undefined, result: SlotProbeResult, stake: number): boolean {
  return result.status < 300 && settled(before, result, stake);
}

function take(before: number | undefined, result: SlotProbeResult): number | undefined {
  return result.status < 300 && result.balance !== undefined ? result.balance : before;
}

function buyPriceHeld(before: number | undefined, result: SlotProbeResult, stake: number): boolean {
  if (result.leaked || before === undefined) {
    return false;
  }
  if (result.status >= 400) {
    return result.balance === undefined || result.balance <= before + 0.02;
  }
  if (result.balance === undefined) {
    return false;
  }
  const drop = before - result.balance;
  const feature = (result.freeSpinItems ?? 0) > 0;
  if (feature) {
    return drop >= 99;
  }
  return Math.abs(result.balance - (before - stake + (result.win ?? 0))) <= 0.05 || drop >= 99;
}

function burstFinal(
  start: number | undefined,
  accepted: readonly SlotProbeResult[],
  stake: number,
): number | undefined {
  if (start === undefined) {
    return undefined;
  }
  const wins = accepted.reduce((sum, step) => sum + (step.win ?? 0), 0);
  return start - accepted.length * stake + wins;
}
