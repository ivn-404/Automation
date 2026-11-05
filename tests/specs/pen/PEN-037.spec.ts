/**
 * PEN-037 — A player session cannot turn demoScriptActive on.
 *
 * Manual Test Case ID: PEN-037 (docs/catalogs/PERSONALTESTING.md §7)
 * Intent: JoinScratch and StartRound with demoScriptActive set. The config
 * that comes back must not have it on. A dealt card is cashed out.
 */

import { test } from '../../fixtures/index.js';
import { parseScratchRound } from '../../../src/network/index.js';
import {
  cashout,
  expectPenChecks,
  penCheck,
  requireJoined,
  safeInvoke,
  startPenSession,
  startRound,
  wasDealt,
} from '../../support/pen-hub.js';

const MANUAL_TEST_ID = 'PEN-037' as const;

test.describe('PEN — Protocol', () => {
  test(`${MANUAL_TEST_ID} demoScriptActive stays off`, async ({ sgapSession, sgapDriver, page }, testInfo) => {
    test.setTimeout(300_000);
    const session = await startPenSession({ sgapSession, sgapDriver, page, testInfo, manualTestId: MANUAL_TEST_ID });
    try {
      requireJoined(session);
      const minBet = session.config?.minBet ?? 0.1;
      const joinArgs = withDemoFlag(session.joinArgs);
      const joined = await safeInvoke(session, 'JoinScratch', joinArgs);
      const joinRound = joined.error === undefined ? parseScratchRound('JoinScratch', joined.result, joinArgs) : undefined;
      const bought = await startRound(session, minBet, 0);
      if (wasDealt(bought.round)) {
        await cashout(session);
      }
      const joinFlag = flagOf(joined.result);
      const roundFlag = flagOf(bought.completion.result);
      await expectPenChecks(
        testInfo,
        [
          penCheck(
            joinFlag !== true && roundFlag !== true,
            joinFlag === true || roundFlag === true
              ? 'demoScriptActive was turned on from the client'
              : `demoScriptActive stayed off (join ${String(joinFlag)}, round ${String(roundFlag)})`,
            'not true',
            { joinFlag, roundFlag, joinError: joined.error, roundMessage: joinRound?.message },
          ),
        ],
        { joinArgs, joined, round: bought.completion },
      );
    } finally {
      session.client.close();
    }
  });
});

function withDemoFlag(args: readonly unknown[]): unknown[] {
  const [first, ...rest] = args;
  if (first !== null && typeof first === 'object' && !Array.isArray(first)) {
    return [{ ...first, demoScriptActive: true }, ...rest];
  }
  return [...args, { demoScriptActive: true }];
}

function flagOf(result: unknown): boolean | undefined {
  if (result === null || typeof result !== 'object') {
    return undefined;
  }
  const config = (result as { config?: unknown }).config;
  if (config === null || typeof config !== 'object') {
    return undefined;
  }
  const flag = (config as { demoScriptActive?: unknown }).demoScriptActive;
  return typeof flag === 'boolean' ? flag : undefined;
}
