/**
 * PEN-039 — Identity comes from the token, not the payload.
 *
 * Manual Test Case ID: PEN-039 (docs/PERSONALTESTING.md §7)
 * Intent: JoinScratch carries a playerName and gameId as arguments. Spoofing them
 * must not make the server act as a different player/game — identity must be taken
 * from the authenticated access_token. Server should reject the spoof or bind to the
 * token's player, never to the spoofed value. Needs a baseline join to be meaningful.
 */

import { test } from '../../fixtures/index.js';
import { expectPenChecks, penCheck, requireJoined, safeInvoke, startPenSession } from '../../support/pen-hub.js';

const MANUAL_TEST_ID = 'PEN-039' as const;

function returnedPlayerId(result: unknown): string | undefined {
  const body = result as { player?: { playerId?: unknown }; config?: { playerId?: unknown } } | null;
  const id = body?.player?.playerId ?? body?.config?.playerId;
  return typeof id === 'string' ? id : undefined;
}

test.describe('PEN — Session & identity', () => {
  test(`${MANUAL_TEST_ID} spoofed identity in payload is ignored`, async ({ sgapSession, sgapDriver, page }, testInfo) => {
    test.setTimeout(300_000);
    const session = await startPenSession({ sgapSession, sgapDriver, page, testInfo, manualTestId: MANUAL_TEST_ID });
    try {
      requireJoined(session);
      const tokenPlayer = typeof session.claims?.pId === 'string' ? session.claims.pId : undefined;

      // Rebuild JoinScratch args with a spoofed player name (arg6) and gameId (arg3).
      const spoofed = [...session.joinArgs];
      spoofed[3] = '99999999';
      spoofed[6] = 'Attacker_000001';
      const completion = await safeInvoke(session, 'JoinScratch', spoofed);
      const player = completion.error === undefined ? returnedPlayerId(completion.result) : undefined;

      await expectPenChecks(testInfo, [
        penCheck(
          completion.error !== undefined || player === undefined || player === tokenPlayer,
          `Spoofed identity rejected or bound to token player (token ${tokenPlayer ?? '?'}, returned ${player ?? 'n/a'}, ${completion.error ?? 'no error'})`,
          `rejected or ${tokenPlayer}`,
          completion.error ?? player,
        ),
        penCheck(player !== 'Attacker_000001', 'Server never acted as the spoofed player name'),
      ], { spoofedArgs: spoofed, completion, tokenPlayer, returnedPlayer: player });
    } finally {
      session.client.close();
    }
  });
});
