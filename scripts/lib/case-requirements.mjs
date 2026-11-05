/**
 * What each case needs from a game: its family baseline (config/qa-suites.json `requires`)
 * plus the `requireCapabilities(...)` calls in its spec — the same two gates the fixture and
 * tests/support/capabilities.ts apply at run time. Used to show a Game URL run's discovery
 * assessment per selected case before (and next to) the results.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const SPECS = ['tests', 'specs'];

function specFiles(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'tmp' ? [] : specFiles(abs);
    return entry.name.endsWith('.spec.ts') ? [abs] : [];
  });
}

/** caseId → { family, requires[] } */
export function caseRequirements(catalog, cwd = process.cwd()) {
  const out = new Map();
  for (const [familyId, family] of Object.entries(catalog.families ?? {})) {
    if (!family.folder) continue;
    for (const file of specFiles(path.join(cwd, ...SPECS, family.folder))) {
      const caseId = path.basename(file, '.spec.ts');
      const text = readFileSync(file, 'utf8');
      const fromSpec = [...text.matchAll(/requireCapabilities\(([^)]*)\)/gu)].flatMap((match) =>
        [...match[1].matchAll(/['"]([A-Za-z]+)['"]/gu)].map((literal) => literal[1]),
      );
      out.set(caseId, { family: familyId, requires: [...new Set([...(family.requires ?? []), ...fromSpec])] });
    }
  }
  return out;
}

const ORDER = { blocked: 0, calibration: 1, unsupported: 2, ready: 3 };

/**
 * Per-case readiness from discovery's capability assessment, in the runtime gate's order:
 * blocked, then calibration, then unsupported (N/A); ready only when every requirement is.
 */
export function assessCases(caseIds, requirements, capabilities) {
  const byCap = new Map(capabilities.map((entry) => [entry.capability, entry]));
  return caseIds.map((caseId) => {
    const requires = requirements.get(caseId)?.requires ?? [];
    let worst = { status: 'ready', reason: requires.length ? `needs ${requires.join(', ')} — all verified` : 'needs no game capability' };
    for (const capability of requires) {
      const entry = byCap.get(capability) ?? { status: 'calibration', reason: 'not assessed' };
      if (ORDER[entry.status] < ORDER[worst.status]) worst = { status: entry.status, reason: `${capability}: ${entry.reason}` };
    }
    return { caseId, family: requirements.get(caseId)?.family, requires, ...worst };
  });
}
