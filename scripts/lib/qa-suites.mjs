/**
 * Suite catalog (config/qa-suites.json) + lane-config builder shared by the
 * Quality Automation Testing page and scripts/run-suite-queue.mjs.
 */
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { laneConfigDir } from './sgap-run-paths.mjs';

const CATALOG_PATH = ['config', 'qa-suites.json'];
const SPECS_DIR = ['tests', 'specs'];

export function loadCatalog(cwd = process.cwd()) {
  return JSON.parse(readFileSync(path.join(cwd, ...CATALOG_PATH), 'utf8'));
}

export function findSuite(catalog, suiteId, cwd = process.cwd()) {
  const suite = catalog.suites.find((entry) => entry.id === suiteId);
  if (suite === undefined) {
    throw new Error(`Unknown suite "${suiteId}". Known: ${catalog.suites.map((entry) => entry.id).join(', ')}`);
  }
  if (!Array.isArray(suite.families)) {
    return suite;
  }
  const cases = familyCases(catalog, cwd);
  const requested = expandFamilies(catalog, suite.families);
  const familyIds = requested.filter((id) => cases[id].length > 0);
  return {
    ...suite,
    familyIds,
    manualOnly: requested.filter((id) => cases[id].length === 0),
    categories: familyIds,
    testMatch: familyIds.flatMap((id) => familyGlobs(catalog, id)),
  };
}

/** Spec globs (relative to tests/specs) for one family. */
export function familyGlobs(catalog, familyId) {
  const family = catalog.families[familyId];
  return Array.isArray(family.testMatch) ? family.testMatch : [`${family.folder}/**/*.spec.ts`];
}

/**
 * Family ids for a selection, in catalog order. `@regression` expands to the
 * regression group only, so PEN (group security) joins only when named.
 */
export function expandFamilies(catalog, tokens) {
  const families = catalog.families ?? {};
  const picked = new Set();
  for (const raw of tokens) {
    const token = String(raw).trim();
    if (token.length === 0) continue;
    if (token.startsWith('@')) {
      const group = token.slice(1).toLowerCase();
      const members = Object.keys(families).filter((id) => families[id].group === group);
      if (members.length === 0) {
        throw new Error(`Unknown family group "${token}". Known: ${Object.keys(catalog.familyGroups ?? {}).map((id) => `@${id}`).join(', ')}`);
      }
      members.forEach((id) => picked.add(id));
      continue;
    }
    const id = token.toUpperCase();
    if (families[id] === undefined) {
      throw new Error(`Unknown test family "${token}". Known: ${Object.keys(families).join(', ')}`);
    }
    picked.add(id);
  }
  return Object.keys(families).filter((id) => picked.has(id));
}

/** Case ids per family (spec basenames); a manual-only family has none. */
export function familyCases(catalog, cwd = process.cwd()) {
  const files = listSpecFiles(path.join(cwd, ...SPECS_DIR));
  return Object.fromEntries(
    Object.keys(catalog.families ?? {}).map((id) => {
      const patterns = familyGlobs(catalog, id).map(globToRegExp);
      const cases = files
        .filter((file) => patterns.some((pattern) => pattern.test(file)))
        .map((file) => path.basename(file, '.spec.ts'))
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
      return [id, cases];
    }),
  );
}

/**
 * Ad-hoc suite for the families a tester ticked. Families without automated
 * cases (manual only, e.g. AS) are reported and left out.
 */
export function selectionSuite(catalog, tokens, cwd = process.cwd()) {
  const requested = expandFamilies(catalog, tokens);
  const cases = familyCases(catalog, cwd);
  const manualOnly = requested.filter((id) => cases[id].length === 0);
  const familyIds = requested.filter((id) => cases[id].length > 0);
  if (familyIds.length === 0) {
    throw new Error(
      requested.length === 0
        ? 'Select at least one test family.'
        : `${manualOnly.join(', ')} has no automated cases (manual only).`,
    );
  }
  const regression = Object.keys(catalog.families).filter(
    (id) => catalog.families[id].group === 'regression' && cases[id].length > 0,
  );
  const allRegression = regression.every((id) => familyIds.includes(id));
  const named = allRegression
    ? ['REGRESSION', ...familyIds.filter((id) => !regression.includes(id))]
    : familyIds;
  return {
    id: 'custom',
    label: `Selected — ${allRegression ? `All Regression${named.length > 1 ? ` + ${named.slice(1).join(', ')}` : ''}` : familyIds.join(', ')}`,
    description: `Families ${familyIds.join(', ')}.`,
    category: named.length <= 4 ? named.join('+') : `SEL${familyIds.length}`,
    categories: familyIds,
    familyIds,
    manualOnly,
    testMatch: familyIds.flatMap((id) => familyGlobs(catalog, id)),
    playerSuffix: 'SEL1',
    defaultPackages: ['1'],
  };
}

/** Package id of a game, from catalog.packages. */
export function packageOfGame(catalog, gameId) {
  return Object.keys(catalog.packages).find((pkg) => catalog.packages[pkg].includes(gameId));
}

/** STG / staging / LOCAL → launcher mode. */
export function launcherModeFor(catalog, environment) {
  if (environment === undefined || String(environment).trim().length === 0) {
    return undefined;
  }
  const raw = String(environment).trim();
  const aliases = catalog.environments ?? {};
  const byAlias = aliases[raw.toUpperCase()];
  const mode = byAlias ?? raw.toLowerCase();
  if (!Object.values(aliases).includes(mode)) {
    throw new Error(`Unknown environment "${raw}". Known: ${Object.keys(aliases).join(', ')}`);
  }
  return mode;
}

export function loadManifests(cwd = process.cwd()) {
  const dir = path.join(cwd, 'config', 'manifests');
  return new Map(
    readdirSync(dir)
      .filter((file) => file.endsWith('.json'))
      .map((file) => {
        try {
          return JSON.parse(readFileSync(path.join(dir, file), 'utf8'));
        } catch {
          return undefined;
        }
      })
      .filter((manifest) => manifest?.gameId)
      .map((manifest) => [manifest.gameId, manifest]),
  );
}

/** Minimal glob → RegExp for lane testMatch patterns (`**`, `*`, `[..]`). */
function globToRegExp(glob) {
  let source = '';
  for (let i = 0; i < glob.length; i += 1) {
    const ch = glob[i];
    if (ch === '*' && glob[i + 1] === '*') {
      source += '(?:.*/)?';
      i += glob[i + 2] === '/' ? 2 : 1;
    } else if (ch === '*') {
      source += '[^/]*';
    } else if (ch === '[') {
      const end = glob.indexOf(']', i);
      source += glob.slice(i, end + 1);
      i = end;
    } else {
      source += ch.replace(/[.+^${}()|\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${source}$`);
}

function listSpecFiles(dir, base = dir) {
  return readdirSync(dir).flatMap((name) => {
    const abs = path.join(dir, name);
    if (statSync(abs).isDirectory()) {
      return name === 'tmp' ? [] : listSpecFiles(abs, base);
    }
    return name.endsWith('.spec.ts') ? [path.relative(base, abs).replace(/\\/g, '/')] : [];
  });
}

/** Case ids (spec file basenames) a suite would run, e.g. ["SCG-001", ...]. */
export function suiteCases(suite, cwd = process.cwd()) {
  const patterns = suite.testMatch.map(globToRegExp);
  return listSpecFiles(path.join(cwd, ...SPECS_DIR))
    .filter((file) => patterns.some((pattern) => pattern.test(file)))
    .map((file) => path.basename(file, '.spec.ts'))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

export function laneConfigPath(suite, pkg, caseId, cwd = process.cwd()) {
  const suffix = caseId ? `-${caseId.toLowerCase()}` : '';
  const file = path.join(laneConfigDir(), `parallel-workers-${suite.id}-pkg${pkg}${suffix}.json`);
  const rel = path.relative(cwd, file);
  return (rel.startsWith('..') || path.isAbsolute(rel) ? file : rel).replace(/\\/g, '/');
}

/** Family scope for a testMatch glob (`pen/**`) or case glob (`**\/PEN-051.spec.ts`). Defaults to game. */
export function scopeForGlob(catalog, glob) {
  const families = Object.entries(catalog.families ?? {});
  const folder = glob.split('/')[0];
  const byFolder = families.find(([, family]) => family.folder === folder);
  if (byFolder !== undefined) {
    return byFolder[1].scope;
  }
  const caseFamily = path.basename(glob).match(/^([A-Z]+)-\d+/)?.[1];
  const byCase = families.find(([id]) => id === caseFamily);
  return byCase?.[1].scope ?? 'game';
}

/**
 * The globs one lane runs: game-scope families on every game, package-scope
 * families on the first game of the package, environment-scope families only on
 * the first lane of the first package in a queue.
 */
export function laneTestMatch(catalog, globs, { laneIndex, includeEnvironment }) {
  return globs.filter((glob) => {
    const scope = scopeForGlob(catalog, glob);
    if (scope === 'environment') return includeEnvironment && laneIndex === 0;
    if (scope === 'package') return laneIndex === 0;
    return true;
  });
}

/**
 * Writes the worker-monitor lane config for one package and returns its
 * repo-relative path, or undefined when no selected game has a case to run.
 * `games` narrows the package to the tester's selected games.
 */
export function writeLaneConfig({
  catalog,
  suite,
  pkg,
  caseId,
  games,
  includeEnvironment = true,
  cwd = process.cwd(),
  manifests = loadManifests(cwd),
}) {
  const packageGames = catalog.packages[pkg];
  if (packageGames === undefined) {
    throw new Error(`Unknown package "${pkg}". Known: ${Object.keys(catalog.packages).join(', ')}`);
  }
  const gameIds = games === undefined ? packageGames : packageGames.filter((gameId) => games.includes(gameId));
  if (gameIds.length === 0) {
    return undefined;
  }
  const suiteGlobs = caseId ? [`**/${caseId}.spec.ts`] : suite.testMatch;
  const lanes = gameIds.flatMap((gameId, index) => {
    const testMatch = laneTestMatch(catalog, suiteGlobs, { laneIndex: index, includeEnvironment });
    if (testMatch.length === 0) {
      return [];
    }
    const manifest = manifests.get(gameId);
    if (manifest === undefined) {
      throw new Error(`No manifest for gameId "${gameId}" (package ${pkg}).`);
    }
    const gameName = manifest.displayName ?? gameId;
    const quadrant = index % 4;
    return [{
      id: index + 1,
      category: suite.category,
      categories: suite.categories,
      gameId,
      gameName,
      packageId: String(pkg),
      testMatch,
      playerId: `${gameName}_${suite.playerSuffix}`,
      monitor: Math.floor(quadrant / 2),
      slot: quadrant % 2,
      col: quadrant % 2,
      row: Math.floor(quadrant / 2),
    }];
  });
  if (lanes.length === 0) {
    return undefined;
  }
  const config = {
    workers: Math.min(lanes.length, 4),
    layout: '1 2 | 3 4',
    notes: `${suite.label} for package ${pkg}${caseId ? ` (${caseId} only)` : ''}: ${gameIds.join(', ')}. Generated by scripts/lib/qa-suites.mjs.`,
    defaultBalance: 15000,
    defaultBetLimit: 15000,
    minimumBetBalance: 100,
    lanes,
  };
  const rel = laneConfigPath(suite, pkg, caseId, cwd);
  mkdirSync(path.dirname(path.resolve(cwd, rel)), { recursive: true });
  writeFileSync(path.resolve(cwd, rel), `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  return rel;
}
