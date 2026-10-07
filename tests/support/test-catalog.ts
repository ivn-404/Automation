/**
 * Parses QA source-of-truth test-case markdown into structured catalog entries.
 * Docs under docs/RegressionTestCases.md and docs/SmokeTestingTestCases.md must not be edited here.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';

export type TestSuiteKind = 'regression' | 'smoke';

export interface CatalogCase {
  readonly id: string;
  readonly title: string;
  readonly categoryCode: string;
  readonly categoryName: string;
  readonly suite: TestSuiteKind;
}

export const CATEGORY_LABELS: Record<string, string> = {
  CSF: 'Core Spin Flow',
  AT: 'Additional Test',
  BC: 'Bet Control',
  BF: 'Buy Feature',
  AP: 'Autoplay',
  TM: 'Turbo Mode',
  FS: 'Feature / Free Spins',
  UIDS: 'UI & Display Sync',
  AS: 'Audio & Settings',
  SM: 'State Management',
  ES: 'Edge & Stability',
  CP: 'Currency Precision',
  WD: 'Wilds',
  MN: 'Menu',
  SCG: 'Scratch Game',
  PEN: 'Pentesting',
};

/** Specs that already execute against Sugar Wonderland (regression wave). */
export const AUTOMATED_REGRESSION_IDS = new Set([
  'CSF-001',
  'CSF-002',
  'CSF-003',
  'CSF-004',
  'CSF-005',
  'CSF-007',
  'CSF-008',
  'CSF-011',
  'CSF-012',
  'AT-001',
  'AT-002',
  'AT-003',
  'AT-004',
  'AT-005',
  'AT-006',
  'AT-007',
  'AT-008',
  'AT-009',
  'AT-010',
  'BC-001',
  'BC-002',
  'BC-003',
  'BC-004',
  'BC-005',
  'BC-006',
  'BC-007',
  'BF-001',
  'BF-002',
  'BF-003',
  'BF-004',
  'BF-005',
  'BF-006',
  'BF-007',
  'BF-010',
  'AP-001',
  'AP-002',
  'AP-003',
  'AP-004',
  'AP-005',
  'AP-006',
  'AP-008',
  'AP-009',
  'AP-010',
  'TM-001',
  'TM-003',
  'TM-004',
  'MN-001',
  'UIDS-003',
  'UIDS-004',
  'UIDS-005',
  'UIDS-006',
  'UIDS-012',
  'SM-001',
  'SM-002',
  'SM-003',
  'SM-004',
  'SM-005',
  'SM-006',
  'CP-001',
  'CP-002',
  'ES-001',
  'ES-003',
  'ES-004',
  'ES-005',
  'ES-006',
  'ES-007',
  'ES-008',
  'ES-009',
  'ES-010',
  'ES-011',
  'ES-012',
  'ES-013',
  'FS-001',
  'FS-002',
  'FS-003',
  'FS-004',
  'FS-005',
  'FS-006',
  'FS-007',
  'FS-008',
  'FS-009',
  'BF-008',
  'SCG-001',
  'SCG-002',
  'SCG-003',
  'SCG-004',
  'SCG-005',
  'SCG-006',
  'SCG-007',
  'SCG-008',
  'SCG-009',
  'SCG-010',
  'SCG-011',
  'SCG-012',
  'SCG-013',
  'SCG-014',
  'SCG-015',
  'SCG-016',
  'SCG-017',
  'SCG-018',
  'SCG-019',
  'SCG-020',
  'SCG-021',
  'SCG-022',
  'SCG-023',
]);

const CASE_RE = /^(([A-Z]+)-\d{3})\s+(?:-\s+)?(.+)$/;
const CATEGORY_RE = /^([A-Z]+)\s+-\s+(.+)$/;

export function parseTestCasesMarkdown(
  content: string,
  suite: TestSuiteKind,
): CatalogCase[] {
  const cases: CatalogCase[] = [];
  let categoryCode = '';
  let categoryName = '';

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith('*') || line.startsWith('/')) {
      continue;
    }

    const caseMatch = line.match(CASE_RE);
    if (caseMatch !== null) {
      const id = caseMatch[1] ?? '';
      const code = caseMatch[2] ?? categoryCode;
      const title = caseMatch[3]?.trim() ?? '';
      cases.push({
        id,
        title,
        categoryCode: code,
        categoryName: CATEGORY_LABELS[code] ?? (categoryName || code),
        suite,
      });
      continue;
    }

    const categoryMatch = line.match(CATEGORY_RE);
    if (categoryMatch !== null) {
      categoryCode = categoryMatch[1] ?? '';
      categoryName = categoryMatch[2]?.trim() ?? categoryCode;
    }
  }

  return cases;
}

function catalogPath(suite: TestSuiteKind): string {
  const file =
    suite === 'regression' ? 'RegressionTestCases.md' : 'SmokeTestingTestCases.md';
  return path.join(process.cwd(), 'docs', file);
}

const catalogCache = new Map<TestSuiteKind, CatalogCase[]>();

export function loadTestCatalog(suite: TestSuiteKind): CatalogCase[] {
  const cached = catalogCache.get(suite);
  if (cached !== undefined) {
    return cached;
  }
  const content = readFileSync(catalogPath(suite), 'utf8');
  const parsed = parseTestCasesMarkdown(content, suite);
  catalogCache.set(suite, parsed);
  return parsed;
}

export function findCatalogCase(
  suite: TestSuiteKind,
  manualTestId: string,
): CatalogCase | undefined {
  return loadTestCatalog(suite).find((entry) => entry.id === manualTestId);
}
