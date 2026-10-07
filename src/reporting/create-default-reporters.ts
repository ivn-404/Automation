/**
 * Default CSF publish path: JSON summary + append-only sheet/CSV log.
 */

import { CompositeReporter } from './composite-reporter.js';
import { JsonFileReporter } from './json-file-reporter.js';
import { SheetAppendReporter } from './sheet-append-reporter.js';

export function createDefaultExecutionReporters(): CompositeReporter {
  return new CompositeReporter([
    new JsonFileReporter(),
    new SheetAppendReporter(),
  ]);
}
