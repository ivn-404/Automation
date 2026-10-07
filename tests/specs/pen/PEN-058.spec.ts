/**
 * PEN-058 — No RNG seed leaks and outcomes are not deterministic.
 *
 * Manual Test Case ID: PEN-058 (docs/PERSONALTESTING.md §security-extensions)
 * Intent: over a sample of rounds, the hub must never expose seed/rng material a client
 * could use to predict outcomes, and the dealt cards must vary (not a fixed sequence).
 * The distribution is attached as evidence for manual review.
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

const MANUAL_TEST_ID = 'PEN-058' as const;
const SAMPLE = 12;
const SEED_KEY = /\b(seed|rng|prng|entropy|nonce|randomstate)\b/iu;

test.describe('PEN — Outcome & RNG integrity', () => {
  test(`${MANUAL_TEST_ID} no seed leak and outcomes vary`, async ({ sgapSession, sgapDriver, page }, testInfo) => {
    test.setTimeout(300_000);
    const session = await startPenSession({ sgapSession, sgapDriver, page, testInfo, manualTestId: MANUAL_TEST_ID });
    try {
      requireJoined(session);
      const bet = session.config?.minBet ?? 0.1;
      const fingerprints: string[] = [];
      const distribution: Record<string, number> = {};
      let seedLeak: string | undefined;

      for (let i = 0; i < SAMPLE; i += 1) {
        const bought = await startRound(session, bet, i % 9);
        if (!wasDealt(bought.round)) {
          continue;
        }
        const raw = JSON.stringify(bought.completion.result ?? {});
        for (const key of Object.keys(JSON.parse(raw) as Record<string, unknown>)) {
          if (SEED_KEY.test(key)) {
            seedLeak = key;
          }
        }
        if (SEED_KEY.test(raw)) {
          seedLeak ??= raw.slice(0, 120);
        }
        const card = bought.round?.card;
        const tier = card?.tier ?? 'unknown';
        distribution[tier] = (distribution[tier] ?? 0) + 1;
        fingerprints.push(`${tier}:${card?.winMultiplier ?? 0}`);
        await cashout(session);
      }

      test.skip(fingerprints.length < 3, `Only ${fingerprints.length} rounds could be dealt to sample RNG`);
      const distinct = new Set(fingerprints).size;

      await expectPenChecks(
        testInfo,
        [
          penCheck(
            seedLeak === undefined,
            seedLeak === undefined ? 'No seed/RNG material exposed in round payloads' : `SEED LEAK — payload exposes "${seedLeak}"`,
            'no seed material',
            seedLeak ?? 'none',
          ),
          penCheck(
            distinct > 1,
            `Outcomes vary across ${fingerprints.length} rounds (${distinct} distinct)`,
            '> 1 distinct',
            distinct,
          ),
        ],
        { rounds: fingerprints.length, distinct, distribution },
      );
    } finally {
      session.client.close();
    }
  });
});
