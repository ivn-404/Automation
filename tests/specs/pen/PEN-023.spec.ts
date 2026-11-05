/**
 * PEN-023 — Player B's token does not act as player A.
 *
 * Manual Test Case ID: PEN-023 (docs/catalogs/PERSONALTESTING.md §5)
 */

import { test } from '../../fixtures/index.js';
import { decodeAccessToken, parseScratchRound } from '../../../src/network/index.js';
import { openSecondScratchPlayer } from '../../support/pen-second-scratch.js';
import {
  cashout,
  expectPenChecks,
  penCheck,
  readBalance,
  requireJoined,
  safeInvoke,
  startPenSession,
} from '../../support/pen-hub.js';

const MANUAL_TEST_ID = 'PEN-023' as const;
const OTHER_PLAYER = 'Sugar Wonderland_PEN23B';

test.describe('PEN — Session', () => {
  test(`${MANUAL_TEST_ID} another player cannot use this session`, async ({ sgapSession, sgapDriver, page }, testInfo) => {
    test.setTimeout(420_000);
    const session = await startPenSession({ sgapSession, sgapDriver, page, testInfo, manualTestId: MANUAL_TEST_ID });
    let closeOther: (() => Promise<void>) | undefined;
    try {
      requireJoined(session);
      await cashout(session);
      const before = (await readBalance(session)) ?? session.balance ?? 0;
      const other = await openSecondScratchPlayer(
        page,
        sgapSession.environment,
        sgapSession.manifest,
        sgapSession.ui,
        OTHER_PLAYER,
      );
      closeOther = other.close;
      const spoofed = [...other.joinArgs];
      spoofed[6] = session.claims?.pId ?? 'Sugar Wonderland_PEN20';
      const completion = await safeInvoke({ ...session, client: other.client }, 'JoinScratch', spoofed);
      const returned = completion.error === undefined ? parseScratchRound('JoinScratch', completion.result, spoofed) : undefined;
      const returnedId = (completion.result as { player?: { playerId?: unknown } } | undefined)?.player?.playerId;
      const playerA = typeof session.claims?.pId === 'string' ? session.claims.pId : undefined;
      const playerB = typeof decodeAccessToken(other.hubUrl)?.pId === 'string' ? String(decodeAccessToken(other.hubUrl)?.pId) : other.playerId;
      const boundToA = typeof returnedId === 'string' && playerA !== undefined && returnedId === playerA && returnedId !== playerB;
      const after = (await readBalance(session)) ?? before;
      await expectPenChecks(
        testInfo,
        [
          penCheck(
            !boundToA && (completion.error !== undefined || returned?.errorCode !== null || returnedId === playerB || returnedId === undefined),
            boundToA
              ? `Player B's token joined as player A (${returnedId})`
              : `Player B using A's identity was ${completion.error ?? `bound to ${String(returnedId ?? playerB ?? 'the token')}`}`,
            `not ${playerA ?? 'player A'}`,
            returnedId ?? completion.error,
          ),
          penCheck(
            Math.abs(after - before) <= 0.0001,
            `Player A's wallet was unchanged (${before} → ${after})`,
            before,
            after,
          ),
        ],
        { spoofed, before, after, other: other.playerId },
      );
    } finally {
      await closeOther?.();
      session.client.close();
    }
  });
});
