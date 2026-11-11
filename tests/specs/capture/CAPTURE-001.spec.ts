/**
 * CAPTURE-001 — rare-event hunt (autoplay / base spin only, never Buy Feature).
 * Worker 1 lane. Same goal as CAPTURE-002/003/004.
 */

import { test } from '../../fixtures/index.js';
import { requireCapabilities } from '../../support/capabilities.js';
import { runCaptureHunt } from '../../support/run-capture-hunt.js';

const MANUAL_TEST_ID = 'CAPTURE-001' as const;

test.describe('CAPTURE — rare max-win sequences', () => {
  requireCapabilities('spin', 'bet', 'autoplay');

  test(`${MANUAL_TEST_ID} hunt last-spin retrigger and hold-and-win max win`, async ({
    sgapSession,
    sgapDriver,
    page,
  }, testInfo) => {
    test.setTimeout(0);
    await runCaptureHunt({ caseId: MANUAL_TEST_ID, sgapSession, sgapDriver, page, testInfo });
  });
});
