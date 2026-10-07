/**
 * PEN-064 — Transport is TLS-only and unauthenticated connections are refused.
 *
 * Manual Test Case ID: PEN-064 (docs/PERSONALTESTING.md §security-extensions)
 * Intent: the hub must be reachable only over wss:// and must reject a connection with no
 * access_token. Foreign-origin behavior is recorded as evidence (this API authenticates
 * with a query-string token, so Origin enforcement is informational, not a gate).
 */

import { test } from '../../fixtures/index.js';
import { ScratchHubClient, parseScratchRound, type HubCompletion } from '../../../src/network/index.js';
import { expectPenChecks, penCheck, startPenSession } from '../../support/pen-hub.js';

const MANUAL_TEST_ID = 'PEN-064' as const;

function stripToken(hubUrl: string): string {
  const url = new URL(hubUrl);
  url.searchParams.delete('access_token');
  return url.toString();
}

test.describe('PEN — Rate limiting & transport', () => {
  test(`${MANUAL_TEST_ID} TLS enforced and anonymous connections refused`, async ({ sgapSession, sgapDriver, page }, testInfo) => {
    test.setTimeout(300_000);
    const session = await startPenSession({ sgapSession, sgapDriver, page, testInfo, manualTestId: MANUAL_TEST_ID });
    try {
      const tlsEnforced = session.hubUrl.startsWith('wss://');

      // Anonymous connection: strip the token and confirm it cannot join.
      let anonRejected = false;
      let anonDetail = '';
      let anonProbe: ScratchHubClient | undefined;
      try {
        anonProbe = await ScratchHubClient.connect(stripToken(session.hubUrl), { handshakeTimeoutMs: 8_000 });
        const completion = await anonProbe
          .invoke('JoinScratch', session.joinArgs, { timeoutMs: 8_000 })
          .catch((error: Error): HubCompletion => ({ error: error.message }));
        const round = completion.error === undefined ? parseScratchRound('JoinScratch', completion.result, session.joinArgs) : undefined;
        anonRejected = completion.error !== undefined || (round?.errorCode ?? null) !== null;
        anonDetail = anonRejected ? `rejected (${completion.error ?? round?.errorCode})` : 'ACCEPTED — no token required';
      } catch (error) {
        anonRejected = true;
        anonDetail = `refused at upgrade: ${(error as Error).message}`;
      } finally {
        anonProbe?.close();
      }

      // Foreign-origin connect (informational evidence only).
      let originOutcome = '';
      let originProbe: ScratchHubClient | undefined;
      try {
        originProbe = await ScratchHubClient.connect(session.hubUrl, {
          handshakeTimeoutMs: 8_000,
          socketOptions: { headers: { Origin: 'https://evil.example.com' } },
        });
        originOutcome = 'connected (Origin not enforced — expected for query-token auth)';
      } catch (error) {
        originOutcome = `refused: ${(error as Error).message}`;
      } finally {
        originProbe?.close();
      }

      await expectPenChecks(
        testInfo,
        [
          penCheck(tlsEnforced, `Hub is TLS-only (${session.hubUrl.split('://')[0]}://)`, 'wss', session.hubUrl.split('://')[0]),
          penCheck(anonRejected, `Anonymous connection refused — ${anonDetail}`, 'rejected', anonDetail),
        ],
        { tlsEnforced, anonDetail, originOutcome },
      );
    } finally {
      session.client.close();
    }
  });
});
