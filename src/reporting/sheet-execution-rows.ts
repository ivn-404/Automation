/**
 * Maps ExecutionRecord → append-only sheet rows.
 */

import type { ExecutionRecord } from '../core/models/index.js';

export type SheetExecutionRow = Readonly<Record<string, string>>;

export function toSheetExecutionRows(
  records: readonly ExecutionRecord[],
  columns: readonly string[],
): SheetExecutionRow[] {
  return records.map((record) => {
    const verificationSummary = (record.verificationResults ?? [])
      .map((result) => `${result.kind}:${result.passed ? 'pass' : 'fail'}`)
      .join(';');

    const values: Record<string, string> = {
      manualTestId: record.manualTestId,
      status: record.status,
      startedAt: record.startedAt,
      finishedAt: record.finishedAt ?? '',
      browserProject: record.browserProject ?? '',
      errorMessage: record.errorMessage ?? '',
      verificationSummary,
    };

    const row: Record<string, string> = {};
    for (const column of columns) {
      row[column] = values[column] ?? '';
    }
    return row;
  });
}

export function rowsToCsv(columns: readonly string[], rows: readonly SheetExecutionRow[]): string {
  const escape = (value: string): string => {
    if (/[",\n\r]/u.test(value)) {
      return `"${value.replace(/"/gu, '""')}"`;
    }
    return value;
  };

  const lines = [
    columns.map(escape).join(','),
    ...rows.map((row) => columns.map((column) => escape(row[column] ?? '')).join(',')),
  ];
  return `${lines.join('\n')}\n`;
}

export function rowValuesInOrder(
  columns: readonly string[],
  row: SheetExecutionRow,
): string[] {
  return columns.map((column) => row[column] ?? '');
}
