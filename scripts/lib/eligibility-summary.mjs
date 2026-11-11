/**
 * Read-only pre-execution eligibility using the same capability functions as the
 * fixture gate and the same case inventory as case-requirements.mjs.
 * Does not change testMatch, lanes, or what Playwright will run.
 */
import './register-ts-loader.mjs';

import { caseRequirements } from './case-requirements.mjs';
import { packageGamesOf, suiteCases } from './qa-suites.mjs';

const engine = await import('../../src/capabilities/eligibility.ts');
const manifestsApi = await import('../../src/platform/manifest/file-game-manifest-loader.ts');

const { classifyRequirements, formatEligibilitySummary } = engine;
const { FileGameManifestLoader, defaultManifestsDir } = manifestsApi;

function familyOf(catalog, familyId) {
  return catalog.families?.[familyId];
}

function includeForLane(family, gameIndex, packageIndex, environmentPlaced) {
  const scope = family?.scope ?? 'game';
  if (scope === 'environment') return !environmentPlaced && gameIndex === 0;
  if (scope === 'package') return gameIndex === 0;
  return true;
}

/**
 * Print eligibility for the queued packages/games/cases. Returns the rows.
 */
export async function printQueueEligibility({
  catalog,
  suite,
  queue,
  games,
  caseId,
  cwd = process.cwd(),
}) {
  const requirements = caseRequirements(catalog, cwd);
  const selectedCases = caseId ? [caseId] : suiteCases(suite, cwd);
  const loader = new FileGameManifestLoader({ manifestsDir: defaultManifestsDir(cwd) });
  const cache = new Map();
  const rows = [];
  let environmentPlaced = false;

  for (const [packageIndex, pkg] of queue.entries()) {
    const packageGames = packageGamesOf(catalog, pkg, games);
    if (packageGames === undefined) continue;
    const gameIds =
      games === undefined ? packageGames : packageGames.filter((gameId) => games.includes(gameId));
    for (const [gameIndex, gameId] of gameIds.entries()) {
      let manifest = cache.get(gameId);
      if (manifest === undefined) {
        manifest = await loader.load(gameId);
        cache.set(gameId, manifest);
      }
      for (const caseName of selectedCases) {
        const requirement = requirements.get(caseName);
        const familyId = requirement?.family ?? '';
        if (!includeForLane(familyOf(catalog, familyId), gameIndex, packageIndex, environmentPlaced)) {
          continue;
        }
        const classified = classifyRequirements(manifest, requirement?.requires ?? []);
        rows.push({
          packageId: String(pkg),
          gameId,
          gameName: manifest.displayName ?? gameId,
          family: familyId || '—',
          caseId: caseName,
          requires: requirement?.requires ?? [],
          status: classified.status,
          missing: classified.missing,
          reason: classified.reason,
        });
      }
      if (gameIds.length > 0) environmentPlaced = true;
    }
  }

  console.log('');
  console.log(formatEligibilitySummary(rows));
  console.log('');
  return rows;
}
