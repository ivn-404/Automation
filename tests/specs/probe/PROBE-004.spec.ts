/**
 * PROBE-004 — reel data contract.
 *
 * Not a QA catalog ID. Validates a game's reel configuration against live play
 * before any reel-dependent case relies on it: a few real spins, each /bet board
 * read through manifest.reelValidation (payload paths, row order, symbol catalog —
 * inherited from the package catalog when the manifest omits them).
 *
 * Pass/fail is the payload: every board is a rectangular Column×Row matrix and
 * every symbol id is in the catalog. The reel region is attached as a canvas shot
 * with the Column×Row grid drawn over it, for a human to confirm the overlay sits
 * on the reels (the region cannot be proven from the payload).
 */

import { test, expect } from '../../fixtures/index.js';
import { getLauncherMode } from '../../fixtures/local-launcher-html.js';
import { settleCanvasToBaseGame } from '../../../src/platform/index.js';
import { captureLocator } from '../../../src/platform/stable-screenshot.js';
import { decodePng, encodePng } from '../../../src/verification/reel/image-match.js';
import { readBackendSpin, type BackendSpinRead } from '../../../src/verification/reel/backend-reader.js';
import { requireCapabilities } from '../../support/capabilities.js';
import { spinForBet } from '../../support/canvas-bet-flow.js';
import { waitForIdleHud } from '../../support/canvas-healing.js';
import { ensureBaseHud } from '../../support/session-guard.js';

const MANUAL_TEST_ID = 'PROBE-004' as const;
const SPINS = Number(process.env.SGAP_PROBE_SPINS ?? '3');

function drawGrid(png: Buffer, region: { x: number; y: number; width: number; height: number }, columns: number, rows: number): Buffer {
  const image = decodePng(png);
  const data = Buffer.from(image.data);
  const plot = (x: number, y: number): void => {
    for (const [dx, dy] of [[0, 0], [1, 0], [0, 1]] as const) {
      const px = x + dx;
      const py = y + dy;
      if (px < 0 || py < 0 || px >= image.width || py >= image.height) continue;
      const i = (py * image.width + px) * 4;
      data[i] = 255;
      data[i + 1] = 0;
      data[i + 2] = 0;
      data[i + 3] = 255;
    }
  };
  const x0 = Math.floor(region.x * image.width);
  const y0 = Math.floor(region.y * image.height);
  const w = Math.floor(region.width * image.width);
  const h = Math.floor(region.height * image.height);
  for (let col = 0; col <= columns; col += 1) {
    const x = Math.round(x0 + (col * w) / columns);
    for (let y = y0; y < y0 + h; y += 1) plot(x, y);
  }
  for (let row = 0; row <= rows; row += 1) {
    const y = Math.round(y0 + (row * h) / rows);
    for (let x = x0; x < x0 + w; x += 1) plot(x, y);
  }
  return encodePng({ width: image.width, height: image.height, data });
}

test.describe('PROBE — reel data contract', () => {
  requireCapabilities('spin', 'reelValidation');

  test(`${MANUAL_TEST_ID} does the reel configuration match live boards?`, async ({
    sgapSession,
    sgapDriver,
    page,
  }, testInfo) => {
    test.setTimeout(420_000);
    test.skip(getLauncherMode() !== 'staging', 'Needs a real /bet');
    testInfo.annotations.push(
      { type: 'manualTestId', description: MANUAL_TEST_ID },
      { type: 'category', description: 'PROBE' },
      { type: 'gameId', description: sgapSession.manifest.gameId },
    );
    const reel = sgapSession.manifest.reelValidation!;
    const knownIds = new Set(reel.symbols.map((symbol) => symbol.id));

    await expect(sgapDriver.isAttached()).resolves.toBe(true);
    await sgapDriver.gameCanvas().waitFor({ state: 'visible' });
    await ensureBaseHud(sgapSession, sgapDriver, page);
    await settleCanvasToBaseGame(page, sgapDriver, sgapSession.manifest, sgapSession.platform.getInitializeBody());

    const rows: string[] = [];
    const seen = new Set<number>();
    let last: BackendSpinRead | undefined;
    for (let index = 1; index <= SPINS; index += 1) {
      const result = await spinForBet(sgapSession, sgapDriver, page);
      const read = readBackendSpin(result.raw, {
        areaPath: reel.areaPath,
        tumblesPath: reel.tumblesPath,
        featureItemsPath: reel.featureItemsPath,
        rowOrder: reel.rowOrder,
        symbols: reel.symbols,
      });
      last = read;
      read.uniqueSymbolIds.forEach((id) => seen.add(id));
      const ragged = read.rawArea.some((column) => column.length !== read.rows);
      const unknown = read.uniqueSymbolIds.filter((id) => !knownIds.has(id));
      rows.push(
        `spin ${index}: ${read.columns}x${read.rows} from ${read.sourcePath} boards=${read.boards.length} tumbles=${read.tumbles.length} ids=[${read.uniqueSymbolIds.join(',')}]` +
          `${ragged ? ' RAGGED' : ''}${unknown.length > 0 ? ` UNKNOWN=[${unknown.join(',')}]` : ''}`,
      );
      expect(read.columns, `spin ${index}: board has columns`).toBeGreaterThan(0);
      expect(read.rows, `spin ${index}: board has rows`).toBeGreaterThan(0);
      expect(ragged, `spin ${index}: every column has ${read.rows} rows`).toBe(false);
      expect(unknown, `spin ${index}: every symbol id is in the catalog`).toEqual([]);
      await waitForIdleHud(page, sgapDriver, sgapSession.manifest, 12_000);
    }

    const shot = await captureLocator(sgapDriver.gameCanvas(), { label: 'reel overlay' });
    await testInfo.attach('reel-region-overlay.png', {
      body: drawGrid(shot, reel.reelRegion, last!.columns, last!.rows),
      contentType: 'image/png',
    });
    rows.push(
      `catalog ids seen: ${[...seen].sort((a, b) => a - b).join(',')} of ${knownIds.size}`,
      `reelRegion: ${JSON.stringify(reel.reelRegion)} rowOrder=${reel.rowOrder ?? 'top-to-bottom'}`,
      `last board (visual rows, R1 = top):`,
      ...last!.boards[0]!.names.map((row, i) => `  R${i + 1} ${row.join(' | ')}`),
    );
    const report = rows.join('\n');
    console.log(`\n[${MANUAL_TEST_ID}] ${sgapSession.manifest.gameId}\n${report}\n`);
    await testInfo.attach('probe-004.txt', { body: report, contentType: 'text/plain' });
  });
});
