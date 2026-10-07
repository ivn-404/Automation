/**
 * Test families from config/qa-suites.json: where each tests/specs/<folder> runs
 * (scope) and the baseline capabilities every case in it needs (requires).
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';

import type { Capability } from '../../src/capabilities/index.js';

export type FamilyScope = 'game' | 'package' | 'environment';

export interface TestFamily {
  readonly id: string;
  readonly folder: string;
  readonly scope: FamilyScope;
  readonly requires: readonly Capability[];
}

interface RawFamily {
  readonly folder?: string;
  readonly scope?: string;
  readonly requires?: readonly string[];
}

const SCOPES: readonly FamilyScope[] = ['game', 'package', 'environment'];

let families: readonly TestFamily[] | undefined;

function loadFamilies(): readonly TestFamily[] {
  const file = path.join(process.cwd(), 'config', 'qa-suites.json');
  const raw = JSON.parse(readFileSync(file, 'utf8')) as {
    families?: Readonly<Record<string, RawFamily>>;
  };
  return Object.entries(raw.families ?? {}).map(([id, family]) => {
    const scope = family.scope as FamilyScope;
    if (family.folder === undefined || !SCOPES.includes(scope)) {
      throw new Error(`config/qa-suites.json families.${id} needs a folder and a scope (${SCOPES.join(' | ')})`);
    }
    return {
      id,
      folder: family.folder,
      scope,
      requires: (family.requires ?? []) as Capability[],
    };
  });
}

export function testFamilies(): readonly TestFamily[] {
  families ??= loadFamilies();
  return families;
}

/** Family of a spec file, from its folder under tests/specs. Undefined for tooling specs. */
export function familyForSpec(specFile: string): TestFamily | undefined {
  const normalized = specFile.replace(/\\/g, '/');
  const marker = '/tests/specs/';
  const at = normalized.lastIndexOf(marker);
  if (at < 0) {
    return undefined;
  }
  const folder = normalized.slice(at + marker.length).split('/')[0];
  return testFamilies().find((family) => family.folder === folder);
}
