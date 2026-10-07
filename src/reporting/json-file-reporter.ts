/**
 * JSON file reporter — writes execution records for CI / Sheet sync consumers.
 * Never writes to the manual Google Sheet.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { IReporter } from '../core/contracts/index.js';
import type { ExecutionRecord } from '../core/models/index.js';

export interface JsonFileReporterOptions {
  /** Absolute or cwd-relative output path. Default: test-results/execution-report.json */
  readonly outputPath?: string;
}

export class JsonFileReporter implements IReporter {
  private readonly outputPath: string;

  constructor(options?: JsonFileReporterOptions) {
    this.outputPath =
      options?.outputPath ?? path.join(process.cwd(), 'test-results', 'execution-report.json');
  }

  async publish(records: readonly ExecutionRecord[]): Promise<void> {
    await mkdir(path.dirname(this.outputPath), { recursive: true });
    const body = {
      schemaVersion: '1.0.0',
      generatedAt: new Date().toISOString(),
      /** Manual Sheet is source of truth — this file is an execution report only. */
      overwritesManualSheet: false,
      records,
    };
    await writeFile(this.outputPath, `${JSON.stringify(body, null, 2)}\n`, 'utf8');
  }
}
