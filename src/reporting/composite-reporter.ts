/**
 * Publishes to multiple reporters (JSON + sheet append, etc.).
 */

import type { IReporter } from '../core/contracts/index.js';
import type { ExecutionRecord } from '../core/models/index.js';

export class CompositeReporter implements IReporter {
  private readonly reporters: readonly IReporter[];

  constructor(reporters: readonly IReporter[]) {
    this.reporters = reporters;
  }

  async publish(records: readonly ExecutionRecord[]): Promise<void> {
    for (const reporter of this.reporters) {
      await reporter.publish(records);
    }
  }
}
