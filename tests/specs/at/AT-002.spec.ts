/**
 * AT-002 — Additional Test
 *
 * Manual Test Case ID: AT-002
 * Intent: The HUD shows the currency symbol from initialize (`currencySymbol`, e.g. "$")
 * on the amount labels — not the ISO code (`currency`, e.g. "USD") or the currency name.
 */

import { test, expect } from '../../fixtures/index.js';
import { settleCanvasToBaseGame } from '../../../src/platform/index.js';
import {
  InMemoryExecutionTracker,
  createDefaultExecutionReporters,
} from '../../../src/reporting/index.js';
import { listPhaserTexts } from '../../../src/runtime/phaser-locate.js';
import { getByPath } from '../../../src/shared/json-path.js';
import { ensureBaseHud } from '../../support/session-guard.js';
import type { VerificationResult } from '../../../src/core/models/index.js';

const MANUAL_TEST_ID = 'AT-002' as const;
const HUD_LABEL = /^BALANCE$/iu;
const CURRENCY_NAMES = /\b(dollars?|euros?|pounds?|won|yen|yuan|rand|dinars?|pesos?|rupees?)\b/iu;

test.describe('AT — Additional Test', () => {
  test(`${MANUAL_TEST_ID} currency displays its symbol, not the code or name`, async ({
    sgapSession,
    sgapDriver,
    page,
  }, testInfo) => {
    test.setTimeout(300_000);

    const tracker = new InMemoryExecutionTracker();
    await tracker.start(MANUAL_TEST_ID, testInfo.project.name);

    testInfo.annotations.push(
      { type: 'manualTestId', description: MANUAL_TEST_ID },
      { type: 'category', description: 'AT' },
      { type: 'gameId', description: sgapSession.manifest.gameId },
    );

    let verificationResults: VerificationResult[] = [];

    try {
      await expect(sgapDriver.isAttached()).resolves.toBe(true);

      await sgapDriver.gameCanvas().waitFor({ state: 'visible' });
      await ensureBaseHud(sgapSession, sgapDriver, page);
      await settleCanvasToBaseGame(
        page,
        sgapDriver,
        sgapSession.manifest,
        sgapSession.platform.getInitializeBody(),
      );

      const initBody = sgapSession.platform.getInitializeBody();
      const code = String(getByPath(initBody, 'data.currency') ?? getByPath(initBody, 'currency') ?? '').trim();
      const symbol = String(
        getByPath(initBody, 'data.currencySymbol') ?? getByPath(initBody, 'currencySymbol') ?? '',
      ).trim();

      verificationResults.push({
        kind: 'bet',
        passed: code.length > 0 && symbol.length > 0 && symbol !== code,
        message:
          code.length > 0 && symbol.length > 0 && symbol !== code
            ? `Initialize currency=${code}, currencySymbol="${symbol}"`
            : `Initialize must expose a currency code and a distinct symbol (currency="${code}", currencySymbol="${symbol}")`,
        actual: { code, symbol },
      });

      await ensureBaseHud(sgapSession, sgapDriver, page);
      const hud = await listPhaserTexts(page, sgapDriver.iframeSelector);
      const hudTexts = hud.map((hit) => hit.text);
      await testInfo.attach('hud-texts.json', {
        body: JSON.stringify(hudTexts, null, 2),
        contentType: 'application/json',
      });
      await testInfo.attach('hud.png', { body: await page.screenshot(), contentType: 'image/png' });

      verificationResults.push({
        kind: 'bet',
        passed: hudTexts.some((text) => HUD_LABEL.test(text)),
        message: hudTexts.some((text) => HUD_LABEL.test(text))
          ? 'HUD amount labels are on screen'
          : 'HUD BALANCE label not found — cannot read the currency markers',
      });

      const codeMarkers = code.length > 0
        ? hudTexts.filter((text) => new RegExp(`(^|[^A-Z])${code}([^A-Z]|$)`, 'u').test(text))
        : [];
      verificationResults.push({
        kind: 'bet',
        passed: codeMarkers.length === 0,
        message:
          codeMarkers.length === 0
            ? `HUD does not show the currency code ${code}`
            : `HUD shows the currency code instead of the symbol: ${codeMarkers.map((t) => `"${t}"`).join(', ')}`,
        expected: `symbol "${symbol}"`,
        actual: codeMarkers,
      });

      const nameMarkers = hudTexts.filter((text) => CURRENCY_NAMES.test(text));
      verificationResults.push({
        kind: 'bet',
        passed: nameMarkers.length === 0,
        message:
          nameMarkers.length === 0
            ? 'HUD does not spell out the currency name'
            : `HUD shows the currency name: ${nameMarkers.join(', ')}`,
        actual: nameMarkers,
      });

      const symbolMarkers = symbol.length > 0 ? hudTexts.filter((text) => text.includes(symbol)) : [];
      verificationResults.push({
        kind: 'bet',
        passed: symbolMarkers.length > 0,
        message:
          symbolMarkers.length > 0
            ? `HUD shows the currency symbol "${symbol}" (${symbolMarkers.join(', ')})`
            : `HUD never shows the currency symbol "${symbol}"`,
        expected: symbol,
        actual: symbolMarkers,
      });

      for (const result of verificationResults) {
        expect(result.passed, result.message).toBe(true);
      }

      await tracker.record({
        manualTestId: MANUAL_TEST_ID,
        status: 'passed',
        startedAt: (await tracker.get(MANUAL_TEST_ID))!.startedAt,
        finishedAt: new Date().toISOString(),
        browserProject: testInfo.project.name,
        verificationResults,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      await tracker.finish(MANUAL_TEST_ID, 'failed', message);
      const failed = await tracker.get(MANUAL_TEST_ID);
      if (failed !== undefined && verificationResults.length > 0) {
        await tracker.record({ ...failed, verificationResults });
      }
      throw error;
    } finally {
      await createDefaultExecutionReporters().publish(await tracker.list());
    }
  });
});
