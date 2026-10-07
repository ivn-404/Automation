/**
 * Offline leave-one-out reelRegion search against a saved canvas + bet.json.
 * Usage: node scripts/offline-reel-probe.mjs
 */
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import path from 'node:path';

import {
  decodePng,
  cropImage,
  bestTemplateMatch,
  encodePng,
} from '../dist/verification/reel/image-match.js';
import { parseReelGridFromBetResponse } from '../dist/verification/reel/parse-reel-area.js';
import {
  learnLiveSymbolTemplates,
  cellRect,
} from '../dist/verification/reel/canvas-reel-reader.js';

const canvasPng = readFileSync('test-results/reel-probe/canvas.png');
const body = JSON.parse(readFileSync('test-results/reel-probe/bet.json', 'utf8'));
const image = decodePng(canvasPng);
const symbols = [
  { id: 0, name: 'Heart' },
  { id: 1, name: 'Star' },
  { id: 2, name: 'Flower' },
  { id: 3, name: 'Triangle' },
  { id: 4, name: 'Diamond' },
  { id: 5, name: 'Teardrop' },
  { id: 6, name: 'Circle' },
  { id: 7, name: 'Square' },
  { id: 8, name: 'Scallop' },
  { id: 9, name: 'Scatter' },
];
const configBase = {
  areaPath: 'slot.area',
  tumblesPath: 'slot.tumbles',
  symbolTemplateDir: 'config/symbols/sugar-wonderland',
  reelRegion: { x: 0.05, y: 0.26, width: 0.88, height: 0.38 },
  cellInset: 0.12,
  matchThreshold: 0.4,
  symbols,
};
const backend = parseReelGridFromBetResponse(body, configBase);

function scoreRegion(region, inset) {
  const config = { ...configBase, reelRegion: region, cellInset: inset };
  const templates = learnLiveSymbolTemplates({
    canvasImage: image,
    backendGrid: backend,
    config,
  });
  let matchCount = 0;
  const total = backend.columns * backend.rows;
  for (let col = 0; col < backend.columns; col += 1) {
    for (let row = 0; row < backend.rows; row += 1) {
      const selfIndex = col * backend.rows + row;
      const cell = backend.cells[col][row];
      const selfTemplate = templates[selfIndex];
      const others = templates.filter((_, i) => i !== selfIndex);
      const match = bestTemplateMatch(
        selfTemplate.image,
        others.map((e) => ({ id: e.id, image: e.image })),
      );
      if (match && match.id === cell.symbolId && match.score >= 0.4) {
        matchCount += 1;
      }
    }
  }
  return { matchCount, total };
}

const results = [];
for (let yi = 240; yi <= 300; yi += 10) {
  for (let hi = 360; hi <= 420; hi += 10) {
    const y = yi / 1000;
    const height = hi / 1000;
    const bottom = y + height;
    if (bottom < 0.62 || bottom > 0.72) {
      continue;
    }
    for (const x of [0.03, 0.04, 0.05]) {
      for (const width of [0.9, 0.92, 0.94]) {
        if (x + width > 0.995) {
          continue;
        }
        for (const inset of [0.1, 0.12, 0.15]) {
          const region = { x, y, width, height };
          const { matchCount, total } = scoreRegion(region, inset);
          results.push({ matchCount, total, inset, region });
        }
      }
    }
  }
}
results.sort((a, b) => b.matchCount - a.matchCount);
console.log('scored', results.length);
console.log('TOP 20:');
for (const r of results.slice(0, 20)) {
  console.log(`${r.matchCount}/${r.total} inset=${r.inset}`, JSON.stringify(r.region));
}
const best = results[0];
console.log('\nBEST', best);

const outDir = 'test-results/reel-probe/offline-best';
mkdirSync(outDir, { recursive: true });
for (let col = 0; col < backend.columns; col += 1) {
  for (let row = 0; row < backend.rows; row += 1) {
    const cell = backend.cells[col][row];
    const rect = cellRect(
      best.region,
      backend.columns,
      backend.rows,
      col,
      row,
      best.inset,
      image.width,
      image.height,
    );
    const crop = cropImage(image, rect.x, rect.y, rect.width, rect.height);
    writeFileSync(
      path.join(outDir, `c${cell.column}r${cell.row}_id${cell.symbolId}.png`),
      encodePng(crop),
    );
  }
}
writeFileSync(path.join(outDir, 'best.json'), JSON.stringify(best, null, 2));
console.log('wrote', outDir);
