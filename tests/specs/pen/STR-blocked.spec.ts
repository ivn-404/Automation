/**
 * STR-001 … STR-007 — Scratch stress.
 *
 * These are load, churn, and soak cases. They are not run against shared staging.
 */

import { test } from '../../fixtures/index.js';

test.describe('STR — Scratch stress', () => {
  test.skip('STR-001 sustained buy and settle (10k rounds would flood shared staging)', () => {});
  test.skip('STR-002 many concurrent sessions (needs the environment owner)', () => {});
  test.skip('STR-003 StartRound flood (not an open-ended load test)', () => {});
  test.skip('STR-004 connect and disconnect churn (high reconnect rate)', () => {});
  test.skip('STR-005 spike, idle, then spike (burst load)', () => {});
  test.skip('STR-006 largest grid at maxBet under sustained load', () => {});
  test.skip('STR-007 long soak (hours on one environment)', () => {});
});
