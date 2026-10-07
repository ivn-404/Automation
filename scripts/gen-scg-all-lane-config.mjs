/**
 * Generate config/parallel-workers-scg-all.json: one lane per scratch-enabled game,
 * all running the SCG suite, with 4 workers so the worker monitor shows 4 games at a
 * time (batches of 4) and publishes a single Allure report at the end.
 *
 * Regenerate whenever the set of scratch games changes:
 *   node scripts/gen-scg-all-lane-config.mjs
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const cwd = process.cwd();
const manifestsDir = path.join(cwd, 'config', 'manifests');

function scratchEnabled(manifest) {
  if (manifest.scratchCard && typeof manifest.scratchCard === 'object') {
    return true;
  }
  const component = (manifest.components ?? []).find((entry) => entry && entry.id === 'scratchCard');
  return Boolean(component && component.enabled);
}

const games = readdirSync(manifestsDir)
  .filter((file) => file.endsWith('.json') && !file.includes('schema'))
  .map((file) => {
    try {
      return JSON.parse(readFileSync(path.join(manifestsDir, file), 'utf8'));
    } catch {
      return undefined;
    }
  })
  .filter((manifest) => manifest && manifest.gameId && scratchEnabled(manifest))
  .map((manifest) => ({ id: manifest.gameId, name: manifest.displayName ?? manifest.gameId }))
  .sort((a, b) => a.id.localeCompare(b.id));

// 4 concurrent windows tile into 4 slots; every lane reuses one of the 4 placements,
// so the currently-running batch of 4 lands in distinct quadrants.
const lanes = games.map((game, index) => {
  const quadrant = index % 4;
  return {
    id: index + 1,
    category: 'SCG',
    categories: ['SCG'],
    gameId: game.id,
    gameName: game.name,
    testMatch: ['scg/**/*.spec.ts'],
    playerId: `${game.name}_SCG1`,
    monitor: Math.floor(quadrant / 2),
    slot: quadrant % 2,
    col: quadrant % 2,
    row: Math.floor(quadrant / 2),
  };
});

const config = {
  workers: 4,
  layout: '1 2 | 3 4',
  notes:
    'Scratch (SCG) suite across every scratch-enabled game. One lane per game, 4 workers so the monitor shows 4 games at a time. Each SCG test stamps a gameId label, so the single Allure report groups by game.',
  defaultBalance: 15000,
  defaultBetLimit: 15000,
  minimumBetBalance: 100,
  lanes,
};

const outPath = path.join(cwd, 'config', 'parallel-workers-scg-all.json');
writeFileSync(outPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
console.log(`Wrote ${outPath} with ${lanes.length} lanes (${config.workers} workers).`);
