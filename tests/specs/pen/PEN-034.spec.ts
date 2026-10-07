/**
 * PEN-034 — Unknown / admin-sounding hub targets are absent.
 *
 * Manual Test Case ID: PEN-034 (docs/PERSONALTESTING.md §7)
 * Intent: invoking methods that should not exist (SetBalance, AdminStart, Debug*)
 * must be rejected as unknown, never executed, and must not drop the socket/auth.
 * Runs without a joined session — it only probes the hub's method surface.
 */

import { test } from '../../fixtures/index.js';
import { expectPenChecks, isCleanRejection, penCheck, safeInvoke, startPenSession } from '../../support/pen-hub.js';

const MANUAL_TEST_ID = 'PEN-034' as const;
const FORBIDDEN_TARGETS = ['SetBalance', 'AdminStart', 'DebugWin', 'SetOutcome', 'GrantBalance'] as const;

test.describe('PEN — Protocol hardening', () => {
  test(`${MANUAL_TEST_ID} unknown/admin targets are rejected`, async ({ sgapSession, sgapDriver, page }, testInfo) => {
    test.setTimeout(300_000);
    const session = await startPenSession({ sgapSession, sgapDriver, page, testInfo, manualTestId: MANUAL_TEST_ID });
    try {
      const checks = [];
      const evidence = [];
      for (const target of FORBIDDEN_TARGETS) {
        const completion = await safeInvoke(session, target, [999_999]);
        evidence.push({ target, completion });
        checks.push(
          penCheck(
            isCleanRejection(completion) && !/balance/iu.test(String(completion.result ?? '')),
            `${target} rejected, not executed (${completion.error ?? JSON.stringify(completion.result)})`,
            'rejected / method does not exist',
            completion.error ?? completion.result,
          ),
        );
      }
      checks.push(penCheck(session.client.isOpen, 'Socket stays open after unknown-target invocations (auth not dropped)'));
      await expectPenChecks(testInfo, checks, evidence);
    } finally {
      session.client.close();
    }
  });
});
