/**
 * Sheet execution reporting config (append-only; never the manual case sheet).
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';

export interface SheetExecutionConfig {
  readonly schemaVersion: string;
  readonly executionTabName: string;
  readonly manualTabName: string;
  readonly localCsvPath: string;
  readonly columns: readonly string[];
  readonly metadata?: Readonly<Record<string, string>>;
}

export function defaultSheetExecutionConfigPath(): string {
  return path.join(process.cwd(), 'config', 'reporting', 'sheet-execution.json');
}

export async function loadSheetExecutionConfig(
  configPath: string = defaultSheetExecutionConfigPath(),
): Promise<SheetExecutionConfig> {
  const raw = JSON.parse(await readFile(configPath, 'utf8')) as Record<string, unknown>;

  const executionTabName = requireNonEmptyString(raw.executionTabName, 'executionTabName');
  const manualTabName = requireNonEmptyString(raw.manualTabName, 'manualTabName');

  if (executionTabName === manualTabName) {
    throw new Error(
      'sheet-execution config invalid: executionTabName must differ from manualTabName',
    );
  }

  const columns = raw.columns;
  if (!Array.isArray(columns) || columns.length === 0) {
    throw new Error('sheet-execution config invalid: columns must be a non-empty array');
  }

  return {
    schemaVersion: requireNonEmptyString(raw.schemaVersion, 'schemaVersion'),
    executionTabName,
    manualTabName,
    localCsvPath: requireNonEmptyString(raw.localCsvPath, 'localCsvPath'),
    columns: columns.map((column, index) => {
      if (typeof column !== 'string' || column.trim() === '') {
        throw new Error(`sheet-execution config invalid: columns[${index}]`);
      }
      return column;
    }),
    ...(raw.metadata !== undefined && typeof raw.metadata === 'object' && raw.metadata !== null
      ? { metadata: raw.metadata as Record<string, string> }
      : {}),
  };
}

function requireNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`sheet-execution config invalid: ${field}`);
  }
  return value;
}
