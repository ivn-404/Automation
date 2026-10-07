/**
 * Smoke: sheet execution config + CSV append (never touches manual tab).
 * Run: node dist/reporting/smoke-sheet-append.js
 */

import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { loadSheetExecutionConfig } from './sheet-execution-config.js';
import { SheetAppendReporter } from './sheet-append-reporter.js';
import { toSheetExecutionRows } from './sheet-execution-rows.js';
import type { ExecutionRecord } from '../core/models/index.js';

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

async function main(): Promise<void> {
  const config = await loadSheetExecutionConfig();
  assert(config.executionTabName !== config.manualTabName, 'tabs must differ');
  assert(config.columns.includes('manualTestId'), 'manualTestId column required');

  const record: ExecutionRecord = {
    manualTestId: 'CSF-001',
    status: 'passed',
    startedAt: '2026-01-01T00:00:00.000Z',
    finishedAt: '2026-01-01T00:00:01.000Z',
    browserProject: 'chromium',
    verificationResults: [
      { kind: 'bet', passed: true, message: 'ok' },
    ],
  };

  const rows = toSheetExecutionRows([record], config.columns);
  assert(rows[0]?.manualTestId === 'CSF-001', 'row mapping failed');

  const tmp = await mkdtemp(path.join(os.tmpdir(), 'sgap-sheet-'));
  const csvPath = path.join(tmp, 'append.csv');
  let googleCalls = 0;

  try {
    const reporter = new SheetAppendReporter({
      config: {
        ...config,
        localCsvPath: csvPath,
      },
      googleAppend: async () => {
        googleCalls += 1;
      },
    });

    await reporter.publish([record]);
    await reporter.publish([record]);

    const csv = await readFile(csvPath, 'utf8');
    const lines = csv.trim().split(/\r?\n/u);
    assert(lines.length === 3, `expected header + 2 data rows, got ${lines.length}`);
    assert(lines[0]?.startsWith('manualTestId') === true, 'missing header');
    assert(googleCalls === 2, 'googleAppend should run when injected');

    let refused = false;
    try {
      await new SheetAppendReporter({
        config: {
          ...config,
          executionTabName: config.manualTabName,
          localCsvPath: path.join(tmp, 'bad.csv'),
        },
      }).publish([record]);
    } catch {
      refused = true;
    }
    assert(refused, 'must refuse publishing when execution tab equals manual tab');

    console.log('sheet append smoke OK');
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
