/**
 * PEN-019 — Empirical RTP against the configured rtp.
 *
 * A sample large enough to judge a 93–99% band is hundreds of rounds.
 * That is not run on shared staging.
 */

import { test } from '../../fixtures/index.js';

test.describe('PEN — Outcome integrity', () => {
  test.skip('PEN-019 RTP over a large sample (not run on shared staging)', () => {
    // A short sample cannot show that empirical RTP tracks the configured band.
  });
});
