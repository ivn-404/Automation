/**
 * PEN-008 — A stake above the wallet is refused.
 *
 * Manual Test Case ID: PEN-008 (docs/catalogs/PERSONALTESTING.md §2)
 * Intent: lower the host wallet under minBet and JoinScratch again on the
 * same token. StartRound(minBet) must be rejected with the balance unchanged.
 * A max-bet rejection on a funded account is not this case.
 */

import { test } from '../../fixtures/index.js';
import { restoreStagingWallet, setLauncherBalance } from '../../support/launcher-balance.js';
import {
  cashout,
  expectPenChecks,
  openSecondClient,
  penCheck,
  readBalance,
  rejectionReason,
  requireJoined,
  startPenSession,
  startRound,
  wasDealt,
} from '../../support/pen-hub.js';

const MANUAL_TEST_ID = 'PEN-008' as const;

test.describe('PEN — Input validation', () => {
  test(`${MANUAL_TEST_ID} stake above the wallet is rejected`, async ({ sgapSession, sgapDriver, page }, testInfo) => {
    test.setTimeout(420_000);
    const session = await startPenSession({ sgapSession, sgapDriver, page, testInfo, manualTestId: MANUAL_TEST_ID });
    let rejoin: Awaited<ReturnType<typeof openSecondClient>> | undefined;
    try {
      requireJoined(session);
      const minBet = session.config?.minBet ?? 0.1;
      await cashout(session);
      await setLauncherBalance(page, minBet / 2);
      session.client.close();
      rejoin = await openSecondClient(session);
      test.skip(!rejoin.joined, `Rejoin after the wallet change failed: ${rejoin.joinError ?? 'unknown'}`);
      const joined = { ...session, client: rejoin.client };
      const before = rejoin.joinResult?.balance ?? (await readBalance(joined)) ?? 0;
      test.skip(
        before + 0.0001 >= minBet,
        `Hub balance stayed ${before} after the host wallet was set below minBet ${minBet}`,
      );
      const { completion, round } = await startRound(joined, minBet, 0);
      const after = round?.balance ?? (await readBalance(joined)) ?? before;
      const reason = rejectionReason(completion, round) ?? '';
      await expectPenChecks(
        testInfo,
        [
          penCheck(
            !wasDealt(round),
            wasDealt(round)
              ? `Stake ${minBet} was dealt from balance ${before}`
              : `Stake ${minBet} rejected from balance ${before} (${reason || 'no reason given'})`,
            'rejected, no card',
            reason || round?.betAmount,
          ),
          penCheck(
            Math.abs(after - before) <= 0.0001,
            `Insufficient-funds stake left the balance unchanged (${before} → ${after})`,
            before,
            after,
          ),
          penCheck(
            /insufficient|not enough/i.test(reason),
            `Refusal names the funds (${reason || 'no reason given'})`,
            'insufficient funds',
            reason || 'no reason given',
          ),
        ],
        { startRound: completion, before, after, minBet },
      );
    } finally {
      rejoin?.client.close();
      session.client.close();
      await restoreStagingWallet({
        page,
        platform: sgapSession.platform,
        driver: sgapDriver,
        manifest: sgapSession.manifest,
        amount: 15000,
      }).catch(() => undefined);
    }
  });
});
