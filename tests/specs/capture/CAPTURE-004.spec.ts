/**
 * CAPTURE-004 — same hunt as CAPTURE-001, worker 4 lane (unique testMatch).
 */

import { test } from '../../fixtures/index.js';
import { requireCapabilities } from '../../support/capabilities.js';
import { runCaptureHunt } from '../../support/run-capture-hunt.js';

const MANUAL_TEST_ID = 'CAPTURE-004' as const;

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
