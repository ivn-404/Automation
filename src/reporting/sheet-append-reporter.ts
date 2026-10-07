/**
 * Append-only sheet execution reporter.
 *
 * - Always appends to a local CSV (offline / CI artifact).
 * - Optionally appends to a Google Sheet *execution* tab when env is set.
 * - Refuses to target the configured manual tab name.
 */

import { access, appendFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { IReporter } from '../core/contracts/index.js';
import type { ExecutionRecord } from '../core/models/index.js';
import {
  defaultSheetExecutionConfigPath,
  loadSheetExecutionConfig,
  type SheetExecutionConfig,
} from './sheet-execution-config.js';
import {
  rowValuesInOrder,
  rowsToCsv,
  toSheetExecutionRows,
} from './sheet-execution-rows.js';

export interface SheetAppendReporterOptions {
  readonly configPath?: string;
  /** Override config (tests / smoke). */
  readonly config?: SheetExecutionConfig;
  /** Inject Google append for tests. */
  readonly googleAppend?: (range: string, values: string[][]) => Promise<void>;
}

export class SheetAppendReporter implements IReporter {
  private readonly options: SheetAppendReporterOptions;

  constructor(options: SheetAppendReporterOptions = {}) {
    this.options = options;
  }

  async publish(records: readonly ExecutionRecord[]): Promise<void> {
    if (records.length === 0) {
      return;
    }

    const config =
      this.options.config ??
      (await loadSheetExecutionConfig(
        this.options.configPath ?? defaultSheetExecutionConfigPath(),
      ));

    this.assertNotManualTab(config);

    const rows = toSheetExecutionRows(records, config.columns);
    await this.appendLocalCsv(config, rows);
    await this.appendGoogleSheetIfConfigured(config, rows);
  }

  private assertNotManualTab(config: SheetExecutionConfig): void {
    if (config.executionTabName.trim() === config.manualTabName.trim()) {
      throw new Error(
        `Refusing to publish: execution tab "${config.executionTabName}" collides with manual tab`,
      );
    }
  }

  private async appendLocalCsv(
    config: SheetExecutionConfig,
    rows: ReturnType<typeof toSheetExecutionRows>,
  ): Promise<void> {
    const csvPath = path.isAbsolute(config.localCsvPath)
      ? config.localCsvPath
      : path.join(process.cwd(), config.localCsvPath);

    await mkdir(path.dirname(csvPath), { recursive: true });

    const exists = await access(csvPath).then(() => true).catch(() => false);
    if (!exists) {
      await writeFile(csvPath, rowsToCsv(config.columns, rows), 'utf8');
      return;
    }

    const dataLines = rows
      .map((row) =>
        config.columns
          .map((column) => {
            const value = row[column] ?? '';
            if (/[",\n\r]/u.test(value)) {
              return `"${value.replace(/"/gu, '""')}"`;
            }
            return value;
          })
          .join(','),
      )
      .join('\n');

    await appendFile(csvPath, `${dataLines}\n`, 'utf8');
  }

  private async appendGoogleSheetIfConfigured(
    config: SheetExecutionConfig,
    rows: ReturnType<typeof toSheetExecutionRows>,
  ): Promise<void> {
    const spreadsheetId =
      process.env.SGAP_SHEETS_SPREADSHEET_ID ??
      config.metadata?.spreadsheetId;
    const accessToken = process.env.SGAP_SHEETS_ACCESS_TOKEN;

    const values = rows.map((row) => rowValuesInOrder(config.columns, row));
    const range = `'${config.executionTabName}'!A:Z`;

    if (this.options.googleAppend !== undefined) {
      await this.options.googleAppend(range, values);
      return;
    }

    if (!spreadsheetId || !accessToken) {
      return;
    }

    const url = new URL(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}:append`,
    );
    url.searchParams.set('valueInputOption', 'USER_ENTERED');
    url.searchParams.set('insertDataOption', 'INSERT_ROWS');

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ values }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(
        `Google Sheet append failed (${response.status}) on tab "${config.executionTabName}": ${body}`,
      );
    }
  }
}
