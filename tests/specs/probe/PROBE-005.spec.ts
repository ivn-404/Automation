/**
 * PROBE-005 — Buy-feature panel map.
 *
 * Not a QA catalog ID. Opens the buy control and records every visible Phaser
 * label so a title with more than one buy choice can be mapped without purchasing.
 * Panel rows titled "… v.N" are parsed into tiers (price, scatters, start multiplier)
 * and must match the manifest's buyFeatureSelections and buyFeatureOptionN* metadata.
 * A normal spin or two first plays out any feature the session reopened on.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { test, expect } from '../../fixtures/index.js';
import { listPhaserInteractive, listPhaserTexts } from '../../../src/runtime/index.js';
import type { PhaserHit, PhaserTextHit } from '../../../src/runtime/index.js';
import { ensureBaseHud, waitForVisiblePhaserText } from '../../support/session-guard.js';
import { buyTierSpec, settleWalletWithSpins } from '../../support/buy-tier-check.js';
import { settleCanvasToBaseGame } from '../../../src/platform/index.js';

const MANUAL_TEST_ID = 'PROBE-005' as const;

function textRows(hits: readonly PhaserTextHit[]) {
  return hits
    .filter((hit) => hit.text.trim().length > 0 && hit.gameWidth > 0 && hit.gameHeight > 0)
    .map((hit) => ({
      text: hit.text.slice(0, 48),
      x: Math.round(((hit.x + hit.width / 2) / hit.gameWidth) * 1000) / 1000,
      y: Math.round(((hit.y + hit.height / 2) / hit.gameHeight) * 1000) / 1000,
      w: hit.width,
      h: hit.height,
    }));
}

function controlRows(hits: readonly PhaserHit[]) {
  return hits
    .filter((hit) => hit.width > 0 && hit.height > 0)
    .map((hit) => ({
      name: hit.name ?? '',
      type: hit.type,
      x: Math.round(hit.xRatio * 1000) / 1000,
      y: Math.round(hit.yRatio * 1000) / 1000,
      w: hit.width,
      h: hit.height,
    }));
}

type TextRow = ReturnType<typeof textRows>[number];

interface PanelTier {
  readonly tier: number;
  readonly title: string;
  readonly cost: number | undefined;
  readonly startMultiplier: number | undefined;
  readonly minScatters: number | undefined;
  readonly description: string;
}

/**
 * Panel rows stack as title ("… v.N"), price ~0.027 below, description ~0.05 below
 * ("4 Scatter, Start Multiplier: 16x", "Random Scatter (3-7), Start Multipliers: 1x").
 */
function panelTiers(rows: readonly TextRow[]): PanelTier[] {
  const near = (row: TextRow, y: number) => Math.abs(row.y - y) < 0.014;
  const priceCandidates = (title: TextRow) =>
    rows.filter((other) => near(other, title.y + 0.027) && /^[\d,]+\.\d{2}$/u.test(other.text.trim()));
  const describes = (title: TextRow) => rows.some((other) => near(other, title.y + 0.05) && /scatter/iu.test(other.text));
  // Titles are "… v.N" on some packages and plain names on others; a row with a price under
  // it and a scatter line under that is a tier either way, numbered top to bottom.
  const titles = rows
    .filter(
      (row) =>
        !/^(?:[A-Z]{3}|[\d,]+\.\d{2}|[-+×()]|\d+\s*[x×])$/iu.test(row.text.trim()) &&
        !/scatter/iu.test(row.text) &&
        priceCandidates(row).length > 0 &&
        describes(row),
    )
    .sort((a, b) => a.y - b.y)
    .map((row, index) => ({ row, match: /\bv\.(\d+)\s*$/u.exec(row.text) ?? ['', String(index + 1)] }));
  // Prices share one column; a win popup can leave another amount at the same height.
  const columnXs = titles
    .map(({ row }) => priceCandidates(row))
    .filter((found) => found.length === 1)
    .map((found) => found[0]!.x)
    .sort((a, b) => a - b);
  const columnX = columnXs.length > 0 ? columnXs[Math.floor(columnXs.length / 2)]! : undefined;
  return titles
    .map(({ row, match }) => {
      const price = priceCandidates(row).sort((a, b) =>
        columnX === undefined ? 0 : Math.abs(a.x - columnX) - Math.abs(b.x - columnX),
      )[0];
      const description = rows.find((other) => near(other, row.y + 0.05) && /scatter/iu.test(other.text))?.text ?? '';
      const start = /Start Multipliers?:\s*(\d+)\s*x/iu.exec(description);
      const scatters = /(\d+)\s*(?:-\s*\d+\s*)?Scatter|Scatters?\s*\((\d+)\s*-/iu.exec(description);
      return {
        tier: Number(match![1]),
        title: row.text.replace(/\s+/gu, ' ').trim(),
        cost: price === undefined ? undefined : Number(price.text.replace(/,/gu, '')),
        startMultiplier: start === null ? undefined : Number(start[1]),
        minScatters: scatters === null ? undefined : Number(scatters[1] ?? scatters[2]),
        description: description.replace(/\s+/gu, ' ').trim(),
      };
    })
    .sort((a, b) => a.tier - b.tier);
}

test.describe('PROBE — buy feature map', () => {
  test(`${MANUAL_TEST_ID} record buy-feature choices without purchasing`, async ({
    sgapSession,
    sgapDriver,
    page,
  }, testInfo) => {
    test.setTimeout(300_000);
    test.skip(!(await sgapSession.buyFeature.isAvailable()), 'buyFeature is not enabled');
    testInfo.annotations.push(
      { type: 'manualTestId', description: MANUAL_TEST_ID },
      { type: 'category', description: 'PROBE' },
      { type: 'gameId', description: sgapSession.manifest.gameId },
    );

    await expect(sgapDriver.isAttached()).resolves.toBe(true);
    await sgapDriver.gameCanvas().waitFor({ state: 'visible' });
    await ensureBaseHud(sgapSession, sgapDriver, page);
    await settleCanvasToBaseGame(page, sgapDriver, sgapSession.manifest, sgapSession.platform.getInitializeBody());
    await settleWalletWithSpins(sgapSession, sgapDriver, page, 2);
    const selector = sgapDriver.iframeSelector;
    const buyReady = await waitForVisiblePhaserText(page, selector, /^BUY$/, 20_000);
    expect(buyReady.hit, 'HUD has no BUY label').toBeDefined();
    const buyLabel = buyReady.hit!;

    const beforeTexts = textRows(await listPhaserTexts(page, selector));
    const beforeControls = controlRows(await listPhaserInteractive(page, selector));

    const buyPoint = {
      x: (buyLabel!.x + buyLabel!.width / 2) / buyLabel!.gameWidth,
      y: (buyLabel!.y + buyLabel!.height / 2) / buyLabel!.gameHeight,
    };
    let panel: Awaited<ReturnType<typeof waitForVisiblePhaserText>> | undefined;
    for (let attempt = 0; attempt < 2 && panel?.hit === undefined; attempt += 1) {
      await sgapDriver.clickCanvasAt(buyPoint, {
        timeoutMs: 12_000,
        singleInput: false,
        label: 'buyFeature',
        strategy: 'phaser',
      });
      panel = await waitForVisiblePhaserText(page, selector, /^Buy Feature$/iu, 8_000);
    }
    expect(panel?.hit, 'BUY did not open the buy panel').toBeDefined();
    await page.waitForTimeout(1_000);

    const afterTexts = textRows(await listPhaserTexts(page, selector));
    const afterControls = controlRows(await listPhaserInteractive(page, selector));
    const tiers = panelTiers(afterTexts);
    // The panel's stake sits between its own "-" and "+" on one row; HUD labels behind it sit lower.
    const minus = afterTexts.find((row) => row.text.trim() === '-');
    const plus = afterTexts.find((row) => row.text.trim() === '+' && minus !== undefined && Math.abs(row.y - minus.y) < 0.005);
    const stakeRow =
      minus === undefined || plus === undefined
        ? undefined
        : afterTexts
            .filter(
              (row) =>
                /^(?:[A-Z]{3}\s*)?[\d,]+\.\d{2}$/u.test(row.text.trim()) &&
                Math.abs(row.y - minus.y) < 0.005 &&
                row.x > minus.x &&
                row.x < plus.x,
            )
            // The HUD BUY price can sit behind the panel at the same spot; the panel's own
            // stake is the one level with its "-" / "+".
            .sort(
              (a, b) =>
                Math.abs(a.y - minus.y) - Math.abs(b.y - minus.y) ||
                Math.abs(a.x - (minus.x + plus.x) / 2) - Math.abs(b.x - (minus.x + plus.x) / 2),
            )[0];
    const stake = stakeRow === undefined ? undefined : Number(stakeRow.text.replace(/[^\d.]/gu, ''));
    const declared = [1, 2, 3, 4]
      .map((tier) => buyTierSpec(sgapSession.manifest, tier))
      .filter((spec) => spec !== undefined);
    const mismatches: string[] = [];
    const selections = Number(sgapSession.manifest.metadata?.buyFeatureSelections ?? 1);
    if (tiers.length !== selections) {
      mismatches.push(`panel shows ${tiers.length} tier(s), manifest buyFeatureSelections is ${selections}`);
    }
    for (const spec of declared) {
      const shown = tiers.find((row) => row.tier === spec.tier);
      if (shown === undefined) {
        mismatches.push(`tier ${spec.tier} is declared but not on the panel`);
        continue;
      }
      const shownMultiplier = shown.cost !== undefined && stake ? Math.round((shown.cost / stake) * 100) / 100 : undefined;
      if (shownMultiplier !== spec.costMultiplier) {
        mismatches.push(`tier ${spec.tier} price ${shown.cost} at stake ${stake} is ${shownMultiplier}×, manifest says ${spec.costMultiplier}×`);
      }
      if (shown.startMultiplier !== spec.startMultiplier) {
        mismatches.push(`tier ${spec.tier} start ${shown.startMultiplier ?? 'random'}×, manifest says ${spec.startMultiplier ?? 'random'}×`);
      }
      if (spec.minScatters !== undefined && shown.minScatters !== spec.minScatters) {
        mismatches.push(`tier ${spec.tier} guarantees ${shown.minScatters} scatter(s), manifest says ${spec.minScatters}`);
      }
    }
    console.log(`[${MANUAL_TEST_ID}] stake ${stake} tiers ${JSON.stringify(tiers)}`);
    const report = { stake, tiers, declared, mismatches, beforeTexts, beforeControls, afterTexts, afterControls };
    const outDir = path.join('test-results', 'probe', MANUAL_TEST_ID, sgapSession.manifest.gameId);
    mkdirSync(outDir, { recursive: true });
    const outPath = path.join(outDir, 'buy-map.json');
    writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    await testInfo.attach('buy-map.json', { path: outPath, contentType: 'application/json' });
    console.log(`[${MANUAL_TEST_ID}] after texts ${JSON.stringify(afterTexts)}`);

    await page.keyboard.press('Escape').catch(() => undefined);
    await sgapDriver.clickCanvas('buyFeatureCancel', { timeoutMs: 4_000, singleInput: true }).catch(() => undefined);

    const appeared = afterTexts.filter(
      (row) => !beforeTexts.some((prior) => prior.text === row.text && prior.x === row.x && prior.y === row.y),
    );
    expect(appeared.length, `buy panel showed no new labels: ${JSON.stringify(afterTexts)}`).toBeGreaterThan(0);
    if (tiers.length > 0) {
      expect(mismatches, `buy tiers differ from the manifest: ${mismatches.join('; ')}`).toEqual([]);
    }
  });
});
