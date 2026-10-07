/**
 * PEN-052 — The scratch token must be scoped to its own game.
 *
 * Manual Test Case ID: PEN-052 (docs/PERSONALTESTING.md §security-extensions)
 * Intent: reuse the captured scratch token but JoinScratch with a foreign gameId. The
 * hub must refuse to bind the session to a game the token was not issued for.
 */

import { test } from '../../fixtures/index.js';
import { expectPenChecks, penCheck, safeInvoke, startPenSession } from '../../support/pen-hub.js';
import { parseScratchRound } from '../../../src/network/index.js';

const MANUAL_TEST_ID = 'PEN-052' as const;
const FOREIGN_GAME_ID = '99999999';

/** Deep-clones the JoinScratch args and swaps the token's gameId for a foreign one. */
function withForeignGame(
  joinArgs: readonly unknown[],
  ownGameId: string | undefined,
): { readonly args: unknown[]; readonly mutated: boolean } {
  let mutated = false;
  const swap = (value: unknown): unknown => {
    if (typeof value === 'string' && ownGameId !== undefined && value === ownGameId) {
      mutated = true;
      return FOREIGN_GAME_ID;
    }
    if (Array.isArray(value)) {
      return value.map(swap);
    }
    if (value !== null && typeof value === 'object') {
      const out: Record<string, unknown> = {};
      for (const [key, val] of Object.entries(value)) {
        out[key] = /gameid/iu.test(key) ? ((mutated = true), FOREIGN_GAME_ID) : swap(val);
      }
      return out;
    }
    return value;
  };
  return { args: joinArgs.map(swap), mutated };
}

test.describe('PEN — Authorization & token integrity', () => {
  test(`${MANUAL_TEST_ID} token is scoped to its game`, async ({ sgapSession, sgapDriver, page }, testInfo) => {
    test.setTimeout(300_000);
    const session = await startPenSession({ sgapSession, sgapDriver, page, testInfo, manualTestId: MANUAL_TEST_ID });
    try {
      const ownGameId = typeof session.claims?.gameId === 'string' ? session.claims.gameId : undefined;
      const { args, mutated } = withForeignGame(session.joinArgs, ownGameId);
      test.skip(
        !mutated,
        `JoinScratch args carry no recognizable gameId to swap (args: ${JSON.stringify(session.joinArgs)})`,
      );

      const completion = await safeInvoke(session, 'JoinScratch', args, { timeoutMs: 10_000 });
      const round =
        completion.error === undefined ? parseScratchRound('JoinScratch', completion.result, args) : undefined;
      const rejected = completion.error !== undefined || (round?.errorCode ?? null) !== null;

      await expectPenChecks(
        testInfo,
        [
          penCheck(
            rejected,
            `Foreign gameId ${FOREIGN_GAME_ID} rejected (${completion.error ?? round?.errorCode ?? 'ACCEPTED — token not game-scoped'})`,
            'rejected',
            completion.error ?? round?.errorCode ?? 'accepted',
          ),
        ],
        { ownGameId, sentArgs: args, completion },
      );
    } finally {
      session.client.close();
    }
  });
});
