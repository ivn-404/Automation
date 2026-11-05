/**
 * PEN-022 — A token from the previous page load cannot join.
 *
 * Manual Test Case ID: PEN-022 (docs/catalogs/PERSONALTESTING.md §5)
 * Intent: capture the hub token, reload, and connect with the old token.
 * A refresh-token control is replayed when the launcher shows one.
 */

import { test } from '../../fixtures/index.js';
import { ScratchHubClient, parseScratchRound, type HubCompletion } from '../../../src/network/index.js';
import { recordPenExchange } from '../../support/pen-evidence.js';
import { expectPenChecks, penCheck, requireJoined, startPenSession } from '../../support/pen-hub.js';

const MANUAL_TEST_ID = 'PEN-022' as const;

test.describe('PEN — Session', () => {
  test(`${MANUAL_TEST_ID} an old access token is rejected`, async ({ sgapSession, sgapDriver, page }, testInfo) => {
    test.setTimeout(420_000);
    const first = await startPenSession({ sgapSession, sgapDriver, page, testInfo, manualTestId: MANUAL_TEST_ID });
    let second = first;
    try {
      requireJoined(first);
      const oldUrl = first.hubUrl;
      const oldArgs = first.joinArgs;
      const refresh = page.getByRole('button', { name: /copy refresh/i });
      const refreshVisible = await refresh.first().isVisible().catch(() => false);
      let refreshToken = '';
      if (refreshVisible) {
        await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
        await refresh.first().click();
        refreshToken = await page.evaluate(() => navigator.clipboard.readText()).catch(() => '');
      }
      first.client.close();
      await page.reload({ waitUntil: 'domcontentloaded' });
      await sgapSession.platform.openGameHost({ timeoutMs: 90_000 });
      await sgapSession.platform.openGame({ timeoutMs: 90_000 });
      await sgapSession.platform.prepareGameView('desktop', { timeoutMs: 90_000 });
      second = await startPenSession({ sgapSession, sgapDriver, page, testInfo, manualTestId: MANUAL_TEST_ID });
      const oldClient = await ScratchHubClient.connect(oldUrl, { handshakeTimeoutMs: 8_000 }).catch(() => undefined);
      let rejected = oldClient === undefined;
      let detail = oldClient === undefined ? 'socket refused the old token' : '';
      if (oldClient !== undefined) {
        const completion = await oldClient
          .invoke('JoinScratch', oldArgs, { timeoutMs: 8_000 })
          .catch((error: Error): HubCompletion => ({ error: error.message }));
        const round = completion.error === undefined ? parseScratchRound('JoinScratch', completion.result, oldArgs) : undefined;
        rejected = completion.error !== undefined || (round?.errorCode ?? null) !== null;
        detail = rejected ? (completion.error ?? round?.message ?? 'rejected') : 'old token joined';
        oldClient.close();
        await recordPenExchange({
          page,
          title: 'JoinScratch with the previous page access token',
          request: { target: 'JoinScratch', accessToken: '[previous session, redacted]' },
          response: completion,
        });
      }
      const liveAccess = new URL(first.hubUrl).searchParams.get('access_token') ?? '';
      const copiedLiveAccess = refreshToken.length > 20 && refreshToken === liveAccess;
      let refreshRejected = false;
      let refreshDetail = copiedLiveAccess
        ? 'clipboard held the live access token, so a separate refresh token was not replayed'
        : 'no refresh token was copied';
      if (!copiedLiveAccess && refreshToken.length > 20 && second.hubUrl.length > 0) {
        const refreshed = new URL(second.hubUrl);
        refreshed.searchParams.set('access_token', refreshToken);
        const refreshClient = await ScratchHubClient.connect(refreshed.href, { handshakeTimeoutMs: 8_000 }).catch(() => undefined);
        if (refreshClient === undefined) {
          refreshRejected = true;
          refreshDetail = 'socket refused the refresh token';
        } else {
          const completion = await refreshClient
            .invoke('JoinScratch', second.joinArgs, { timeoutMs: 8_000 })
            .catch((error: Error): HubCompletion => ({ error: error.message }));
          const round = completion.error === undefined ? parseScratchRound('JoinScratch', completion.result, second.joinArgs) : undefined;
          refreshRejected = completion.error !== undefined || (round?.errorCode ?? null) !== null;
          refreshDetail = refreshRejected ? (completion.error ?? round?.message ?? 'rejected') : 'refresh token joined';
          refreshClient.close();
          await recordPenExchange({
            page,
            title: 'JoinScratch with the copied refresh token',
            request: { target: 'JoinScratch', accessToken: '[refresh token, redacted]' },
            response: completion,
          });
        }
      }
      await expectPenChecks(
        testInfo,
        [
          penCheck(rejected, rejected ? `Old access token was rejected (${detail})` : 'Old access token still joined after reload', 'rejected', detail),
          penCheck(
            refreshRejected,
            refreshRejected
              ? `Refresh token was rejected (${refreshDetail})`
              : refreshVisible
                ? `Copy Refresh Token did not yield a rejected hub login (${refreshDetail})`
                : 'No Copy Refresh Token control was on the launcher',
            'rejected',
            refreshDetail,
          ),
        ],
        { refreshVisible, refreshCopied: refreshToken.length > 20, copiedLiveAccess },
      );
    } finally {
      second.client.close();
      first.client.close();
    }
  });
});
