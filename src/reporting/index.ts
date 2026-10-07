/**
 * Reporting layer — Execution Tracker and report outputs.
 * Never overwrites the manual Google Sheet source of truth.
 */
export const REPORTING_LAYER = 'reporting' as const;

export {
  InMemoryExecutionTracker,
} from './in-memory-execution-tracker.js';
export {
  JsonFileReporter,
  type JsonFileReporterOptions,
} from './json-file-reporter.js';
export {
  SheetAppendReporter,
  type SheetAppendReporterOptions,
} from './sheet-append-reporter.js';
export {
  CompositeReporter,
} from './composite-reporter.js';
export {
  createDefaultExecutionReporters,
} from './create-default-reporters.js';
export {
  loadSheetExecutionConfig,
  defaultSheetExecutionConfigPath,
  type SheetExecutionConfig,
} from './sheet-execution-config.js';
export {
  confidenceFor,
  formatInteractions,
  recordInteraction,
  summarizeInteractions,
  takeInteractions,
  type InteractionEntry,
  type InteractionSummary,
  type LocatorConfidence,
  type LocatorStrategy,
} from './interaction-journal.js';
export {
  toSheetExecutionRows,
  rowsToCsv,
  type SheetExecutionRow,
} from './sheet-execution-rows.js';
