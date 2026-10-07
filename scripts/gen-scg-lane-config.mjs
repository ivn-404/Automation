/**
 * Generate a worker-monitor lane config that runs the SCG (scratch) suite for one
 * package of games (max 4 concurrent). Games map to lanes; each SCG test stamps a
 * gameId label so the Allure report groups by game.
 *
 * Usage:
 *   node scripts/gen-scg-lane-config.mjs --package 1
 *   node scripts/gen-scg-lane-config.mjs --games sugar-wonderland,beelze-bop --name custom
 *   node scripts/gen-scg-lane-config.mjs --package 1 --spec SCG-024   # one case only
 *
 * Writes config/parallel-workers-scg-<name>.json and prints the path.
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { loadCatalog } from './lib/qa-suites.mjs';

const cwd = process.cwd();
const manifestsDir = path.join(cwd, 'config', 'manifests');

/** Game packages (DiJoker groupings) from config/qa-suites.json. */
const PACKAGES = loadCatalog(cwd).packages;

function argValue(flag) {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const packageArg = argValue('--package');
const gamesArg = argValue('--games');
const specArg = argValue('--spec');
let name = argValue('--name');
let gameIds;

if (packageArg !== undefined) {
  gameIds = PACKAGES[packageArg];
  if (gameIds === undefined) {
    console.error(`Unknown package "${packageArg}". Known: ${Object.keys(PACKAGES).join(', ')}`);
    process.exit(1);
  }
  name = name ?? `pkg${packageArg}`;
} else if (gamesArg !== undefined) {
  gameIds = gamesArg.split(',').map((value) => value.trim()).filter(Boolean);
  name = name ?? 'custom';
} else {
  console.error('Provide --package <n> or --games <id,id,...>');
  process.exit(1);
}
if (specArg !== undefined) {
  name = `${name}-${specArg.toLowerCase()}`;
}
const testMatch = specArg !== undefined ? `scg/**/${specArg}.spec.ts` : 'scg/**/*.spec.ts';

const manifests = new Map(
  readdirSync(manifestsDir)
    .filter((file) => file.endsWith('.json') && !file.includes('schema'))
    .map((file) => {
      try {
        return JSON.parse(readFileSync(path.join(manifestsDir, file), 'utf8'));
      } catch {
        return undefined;
      }
    })
    .filter((manifest) => manifest && manifest.gameId)
    .map((manifest) => [manifest.gameId, manifest]),
);

const lanes = gameIds.map((gameId, index) => {
  const manifest = manifests.get(gameId);
  if (manifest === undefined) {
    console.error(`No manifest for gameId "${gameId}".`);
    process.exit(1);
  }
  const gameName = manifest.displayName ?? gameId;
  const quadrant = index % 4;
  return {
    id: index + 1,
    category: 'SCG',
    categories: ['SCG'],
    gameId,
    gameName,
    testMatch: [testMatch],
    playerId: `${gameName}_SCG1`,
    monitor: Math.floor(quadrant / 2),
    slot: quadrant % 2,
    col: quadrant % 2,
    row: Math.floor(quadrant / 2),
  };
});

const config = {
  workers: Math.min(lanes.length, 4),
  layout: '1 2 | 3 4',
  notes: `SCG scratch suite for ${name} (${gameIds.join(', ')}). Max 4 games at a time; one Allure report grouped by gameId.`,
  defaultBalance: 15000,
  defaultBetLimit: 15000,
  minimumBetBalance: 100,
  lanes,
};

const outPath = path.join(cwd, 'config', `parallel-workers-scg-${name}.json`);
writeFileSync(outPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
console.log(`Wrote ${outPath}: ${lanes.length} games, ${config.workers} workers.`);
console.log(`Games: ${gameIds.join(', ')}`);
