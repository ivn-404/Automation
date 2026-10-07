/**
 * PEN-051 — The hub must validate the JWT signature and expiry.
 *
 * Manual Test Case ID: PEN-051 (docs/PERSONALTESTING.md §security-extensions)
 * Intent: connect with a tampered access_token and confirm the backend refuses it.
 * Variants: `alg:none`, a flipped `sub` claim, and an expired `exp`. We cannot re-sign
 * (no key), so every variant also breaks the signature — a correct server rejects them
 * all, either at the socket upgrade or at JoinScratch. Accepting ANY is a critical flaw.
 */

import { test } from '../../fixtures/index.js';
import { expectPenChecks, penCheck, startPenSession, tamperToken, type TokenTamper } from '../../support/pen-hub.js';
import { ScratchHubClient, parseScratchRound, type HubCompletion } from '../../../src/network/index.js';

const MANUAL_TEST_ID = 'PEN-051' as const;
const VARIANTS: readonly TokenTamper[] = ['alg-none', 'flipped-claim', 'expired'];

test.describe('PEN — Authorization & token integrity', () => {
  test(`${MANUAL_TEST_ID} tampered tokens are rejected`, async ({ sgapSession, sgapDriver, page }, testInfo) => {
    test.setTimeout(300_000);
    const session = await startPenSession({ sgapSession, sgapDriver, page, testInfo, manualTestId: MANUAL_TEST_ID });
    try {
      const checks = [];
      const evidence = [];
      for (const variant of VARIANTS) {
        const tamperedUrl = tamperToken(session.hubUrl, variant);
        let rejected = false;
        let detail = '';
        let probe: ScratchHubClient | undefined;
        try {
          probe = await ScratchHubClient.connect(tamperedUrl, { handshakeTimeoutMs: 8_000 });
          const completion = await probe
            .invoke('JoinScratch', session.joinArgs, { timeoutMs: 8_000 })
            .catch((error: Error): HubCompletion => ({ error: error.message }));
          const round =
            completion.error === undefined
              ? parseScratchRound('JoinScratch', completion.result, session.joinArgs)
              : undefined;
          const boundPlayer = (completion.result as { player?: { playerId?: unknown } } | undefined)?.player?.playerId;
          rejected = completion.error !== undefined || (round?.errorCode ?? null) !== null;
          detail = rejected
            ? `socket opened but JoinScratch rejected (${completion.error ?? round?.errorCode})`
            : `ACCEPTED — joined as "${String(boundPlayer)}"; token neither signature- nor expiry-validated`;
        } catch (error) {
          rejected = true;
          detail = `connection refused at upgrade: ${(error as Error).message}`;
        } finally {
          probe?.close();
        }
        checks.push(
          penCheck(rejected, `Tampered token [${variant}] rejected — ${detail}`, 'rejected', detail),
        );
        evidence.push({ variant, rejected, detail });
      }
      await expectPenChecks(testInfo, checks, evidence);
    } finally {
      session.client.close();
    }
  });
});
