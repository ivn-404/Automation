/**
 * PEN-018 — Identical client fields do not determine the card.
 *
 * Manual Test Case ID: PEN-018 (docs/catalogs/PERSONALTESTING.md §4)
 * Intent: eight buys at the same stake and grid. The cards are not one
 * repeated outcome, and the payload has no seed.
 */

import { test } from '../../fixtures/index.js';
import {
  cashout,
  expectPenChecks,
  penCheck,
  requireJoined,
  startPenSession,
  startRound,
  wasDealt,
} from '../../support/pen-hub.js';

const MANUAL_TEST_ID = 'PEN-018' as const;
const SAMPLE = 8;
const SEED_KEY = /\b(seed|rng|prng|entropy|nonce|randomstate)\b/iu;

test.describe('PEN — Outcome integrity', () => {
  test(`${MANUAL_TEST_ID} the same bet and grid do not fix the card`, async ({ sgapSession, sgapDriver, page }, testInfo) => {
    test.setTimeout(300_000);
    const session = await startPenSession({ sgapSession, sgapDriver, page, testInfo, manualTestId: MANUAL_TEST_ID });
    try {
      requireJoined(session);
      const bet = session.config?.minBet ?? 0.1;
      const fingerprints: string[] = [];
      let seedLeak: string | undefined;
      for (let index = 0; index < SAMPLE; index += 1) {
        const bought = await startRound(session, bet, 0);
        if (!wasDealt(bought.round)) {
          continue;
        }
        const raw = JSON.stringify(bought.completion.result ?? {});
        if (SEED_KEY.test(raw)) {
          seedLeak ??= raw.slice(0, 120);
        }
        fingerprints.push(`${bought.round.card.tier}:${bought.round.card.winMultiplier}:${bought.round.card.cells.map((cell) => cell.symbol).join('')}`);
        await cashout(session);
      }
      test.skip(fingerprints.length < 3, `Only ${fingerprints.length} cards were dealt`);
      const distinct = new Set(fingerprints).size;
      await expectPenChecks(
        testInfo,
        [
          penCheck(seedLeak === undefined, seedLeak === undefined ? 'No seed was exposed' : `Payload exposed seed-like text`, 'no seed', seedLeak ?? 'none'),
          penCheck(
            distinct > 1,
            `${fingerprints.length} identical bets produced ${distinct} distinct cards`,
            '> 1 distinct card',
            distinct,
          ),
        ],
        { fingerprints },
      );
    } finally {
      session.client.close();
    }
  });
});
