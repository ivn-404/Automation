/**
 * Smoke: adaptive backend reader + Package 1 sample 6×5 grid.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { isFreeSpinBundleComplete, freeSpinItemsRemaining, discoverFeatureSpinItems } from '../../shared/spin-payload-discovery.js';

import {
  compareBackendFrontendReels,
  formatBackendSpinGrid,
  parseReelGridFromBetResponse,
  readBackendSpin,
} from './index.js';
import type { FrontendReelRead } from './canvas-reel-reader.js';
import type { ReelValidationConfig } from './types.js';
import { loadPackageCatalog } from './package-catalog.js';

const samplePath = path.join(
  process.cwd(),
  'ResponseSpinDataSample',
  'Package1response.json',
);

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function main(): void {
  const catalog = loadPackageCatalog('package-1');
  const body = JSON.parse(readFileSync(samplePath, 'utf8')) as unknown;

  const read = readBackendSpin(body, { catalog });
  assert(read.columns === 6 && read.rows === 5, `Package 1 sample should be 6×5, got ${read.columns}×${read.rows}`);
  assert(read.unknownSymbolIds.length === 0, `unexpected unknown ids ${read.unknownSymbolIds.join(',')}`);
  assert(
    read.grid.cells[3]![0]!.symbolId === 1 && read.grid.cells[3]![0]!.symbolName === 'Heart Candy',
    `C4 R1 should be backend [1] Heart Candy after bottom-to-top, got [${read.grid.cells[3]![0]!.symbolId}] ${read.grid.cells[3]![0]!.symbolName}`,
  );
  assert(
    read.grid.cells[4]![3]!.symbolId === 0 && read.grid.cells[4]![3]!.symbolName === 'Scatter Candy',
    `C5 R4 should be backend [0] Scatter Candy, got [${read.grid.cells[4]![3]!.symbolId}] ${read.grid.cells[4]![3]!.symbolName}`,
  );

  const pack2 = readBackendSpin(
    {
      slot: {
        area: [
          [1, 2, 3],
          [4, 5, 6],
          [7, 8, 9],
          [10, 11, 0],
          [1, 1, 1],
        ],
        totalWin: 0,
        tumbles: [],
      },
    },
    { rowOrder: 'top-to-bottom' },
  );
  assert(pack2.columns === 5 && pack2.rows === 3, `synthetic Package 2 should be 5×3, got ${pack2.columns}×${pack2.rows}`);
  assert(pack2.unknownSymbolIds.includes(11), 'id 11 should stay unknown without a catalog');

  const config: ReelValidationConfig = {
    areaPath: 'slot.area',
    tumblesPath: 'slot.tumbles',
    rowOrder: 'bottom-to-top',
    symbolTemplateDir: 'config/symbols/sugar-wonderland',
    reelRegion: { x: 0.03, y: 0.26, width: 0.94, height: 0.37 },
    cellInset: 0.12,
    symbols: [...catalog.symbols],
  };

  const grid = parseReelGridFromBetResponse(body, config);
  const frontend: FrontendReelRead = {
    columns: grid.columns,
    rows: grid.rows,
    canvasPng: Buffer.alloc(0),
    cells: grid.cells.map((column) =>
      column.map((cell) => ({
        column: cell.column,
        row: cell.row,
        symbolId: cell.symbolId,
        symbolName: cell.symbolName,
        score: 1,
      })),
    ),
  };

  const report = compareBackendFrontendReels(grid, frontend);
  assert(report.passed && report.matchCount === 30, `Expected 30 MATCH, got ${report.text}`);

  const mismatched = {
    ...frontend,
    cells: frontend.cells.map((column, colIndex) =>
      column.map((cell, rowIndex) =>
        colIndex === 2 && rowIndex === 1
          ? { ...cell, symbolId: 0, symbolName: 'Scatter Candy' }
          : cell,
      ),
    ),
  };
  const bad = compareBackendFrontendReels(grid, mismatched);
  assert(!bad.passed && bad.mismatchCount === 1, `Expected 1 MISMATCH, got ${bad.text}`);

  const buyBundlePath = path.join(
    process.cwd(),
    'tests',
    'fixtures',
    'samples',
    'buy-feature-batch-response.json',
  );
  const buyBody = JSON.parse(readFileSync(buyBundlePath, 'utf8')) as unknown;
  const buyDiscovery = discoverFeatureSpinItems(buyBody, {
    featureItemsPath: catalog.featureItemsPath,
  });
  assert(buyDiscovery !== undefined, 'buy bundle sample should expose discoverable feature items');
  assert(isFreeSpinBundleComplete(buyBody, { featureItemsPath: catalog.featureItemsPath }), 'buy bundle sample should be detected as complete');
  assert(freeSpinItemsRemaining(buyBody, { featureItemsPath: catalog.featureItemsPath }) === 0, 'bundled buy should report 0 spins remaining');

  const buyRead = readBackendSpin(buyBody, { catalog });
  assert(buyRead.spinGroups.length === 11, `buy bundle should expand to 11 spin groups, got ${buyRead.spinGroups.length}`);
  assert(
    buyRead.spinGroups.filter((group) => group.fsIndex !== undefined).length === 10,
    'buy bundle should include 10 free-spin groups',
  );
  assert(buyRead.boards.length >= 11, `buy bundle should flatten at least 11 boards, got ${buyRead.boards.length}`);
  assert(
    buyRead.spinGroups[1]?.title === 'Free Spin 1/10',
    `first FS group title should be Free Spin 1/10, got ${buyRead.spinGroups[1]?.title}`,
  );
  assert(
    buyRead.spinGroups[1]?.sourcePath === `${buyDiscovery!.itemsPath}[0].area`,
    `first FS source path should reference discovered items path`,
  );

  const altPackageBody = {
    slot: {
      area: [
        [1, 2, 3],
        [4, 5, 6],
        [7, 8, 9],
      ],
      tumbles: [],
      feature: {
        items: [
          { spinsRemaining: 2, area: [[1, 1, 1], [2, 2, 2], [3, 3, 3]], tumbles: [] },
          { spinsRemaining: 1, area: [[4, 4, 4], [5, 5, 5], [6, 6, 6]], tumbles: [] },
        ],
      },
    },
  };
  const altDiscovery = discoverFeatureSpinItems(altPackageBody);
  assert(altDiscovery?.itemsPath === 'slot.feature.items', 'tree walk should find slot.feature.items');
  assert(altDiscovery?.items.length === 2, 'alternate package shape should yield 2 feature boards');
  const altRead = readBackendSpin(altPackageBody);
  assert(altRead.spinGroups.length === 3, 'opener + 2 feature spins for alternate package shape');

  console.log(formatBackendSpinGrid(read));
  console.log('');
  console.log(bad.text.split('\n').slice(0, 12).join('\n'));
  console.log('reel validation smoke passed');
}

main();
