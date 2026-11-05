/**
 * PEN-005 — Extra stake precision is rounded to the published currency places.
 *
 * Manual Test Case ID: PEN-005 (docs/catalogs/PERSONALTESTING.md §2)
 * Intent: StartRound(0.123456789) is rejected, or booked at the rounded stake
 * with the wallet moving by that stake minus the win. The raw value must not
 * be stored.
 */

import { test } from '../../fixtures/index.js';
import {
  cashout,
  expectPenChecks,
  penCheck,
  readBalance,
  rejectionReason,
  requireJoined,
  startPenSession,
  startRound,
  wasDealt,
} from '../../support/pen-hub.js';

const MANUAL_TEST_ID = 'PEN-005' as const;
const SENT = 0.123456789;

test.describe('PEN — Input validation', () => {
  test(`${MANUAL_TEST_ID} extra precision follows currency places`, async ({ sgapSession, sgapDriver, page }, testInfo) => {
    test.setTimeout(300_000);
    const session = await startPenSession({ sgapSession, sgapDriver, page, testInfo, manualTestId: MANUAL_TEST_ID });
    try {
      requireJoined(session);
      const publishedPlaces = session.config?.currencyDecimalPlaces;
      const currency = typeof session.config?.raw.currency === 'string' ? session.config.raw.currency : undefined;
      const places = publishedPlaces ?? (currency === 'USD' ? 2 : undefined);
      const rounded = places === undefined ? undefined : roundToPlaces(SENT, places);
      const configKeys = Object.keys(session.config?.raw ?? {});
      const before = session.balance ?? (await readBalance(session)) ?? 0;
      const { completion, round } = await startRound(session, SENT, 0);
      const dealt = wasDealt(round);
      const afterStart = round?.balance ?? (await readBalance(session)) ?? before;
      const settled = dealt ? await cashout(session) : undefined;
      const after = (await readBalance(session)) ?? afterStart;
      const reason = rejectionReason(completion, round);
      const rejected = !dealt && Math.abs(after - before) <= 0.0001;
      const booked = wasDealt(round) ? round.betAmount : undefined;
      const win = settled?.round?.winAmount ?? 0;
      const ledgerHolds =
        booked !== undefined && Math.abs(after - (before - booked + win)) <= 0.0001;
      const storedRounded =
        booked !== undefined &&
        rounded !== undefined &&
        Math.abs(booked - rounded) <= tolerance(places ?? 0) &&
        (Math.abs(rounded - SENT) <= tolerance(places ?? 0) || Math.abs(booked - SENT) > tolerance(places ?? 0));
      const passed = rejected || (places !== undefined && storedRounded && ledgerHolds);
      await expectPenChecks(
        testInfo,
        [
          penCheck(
            passed,
            rejected
              ? `Stake ${SENT} rejected (${reason ?? 'no reason given'}), balance ${before} → ${after}`
              : storedRounded && ledgerHolds
                ? publishedPlaces === undefined
                  ? `Stake ${SENT} was booked at ${booked}. currencyDecimalPlaces was absent; the debit matches USD cents and the wallet ended at ${after}`
                  : `Stake ${SENT} was booked at ${booked} (${publishedPlaces} decimal places) and the wallet ended at ${after}`
                : places === undefined
                  ? `Stake ${SENT} was booked at ${booked ?? 'unknown'} and currencyDecimalPlaces was absent (${configKeys.join(', ') || 'no config'})`
                  : `Stake ${SENT} was booked at ${booked ?? 'unknown'}, not ${rounded} for ${places} decimal places`,
            places === undefined ? 'rejected, or a published currency precision' : `rejected, or booked at ${rounded}`,
            { booked, win, before, after, reason, configKeys },
          ),
        ],
        { startRound: completion, places, rounded, before, afterStart, after },
      );
    } finally {
      session.client.close();
    }
  });
});

function roundToPlaces(value: number, places: number): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function tolerance(places: number): number {
  return places === 0 ? 0.0001 : 5 * 10 ** -(places + 1);
}
