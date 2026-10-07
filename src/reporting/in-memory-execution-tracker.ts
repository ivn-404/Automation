/**
 * In-memory Execution Tracker — records results by manual test ID.
 */

import type { IExecutionTracker } from '../core/contracts/index.js';
import type { ExecutionStatus } from '../core/constants/index.js';
import type { ExecutionRecord } from '../core/models/index.js';

export class InMemoryExecutionTracker implements IExecutionTracker {
  private readonly records = new Map<string, ExecutionRecord>();

  async start(manualTestId: string, browserProject?: string): Promise<void> {
    this.records.set(manualTestId, {
      manualTestId,
      status: 'notRun',
      startedAt: new Date().toISOString(),
      ...(browserProject !== undefined ? { browserProject } : {}),
    });
  }

  async finish(manualTestId: string, status: ExecutionStatus, errorMessage?: string): Promise<void> {
    const existing = this.records.get(manualTestId);
    const startedAt = existing?.startedAt ?? new Date().toISOString();
    this.records.set(manualTestId, {
      manualTestId,
      status,
      startedAt,
      finishedAt: new Date().toISOString(),
      ...(existing?.browserProject !== undefined ? { browserProject: existing.browserProject } : {}),
      ...(errorMessage !== undefined ? { errorMessage } : {}),
      ...(existing?.verificationResults !== undefined
        ? { verificationResults: existing.verificationResults }
        : {}),
    });
  }

  async record(record: ExecutionRecord): Promise<void> {
    this.records.set(record.manualTestId, record);
  }

  async get(manualTestId: string): Promise<ExecutionRecord | undefined> {
    return this.records.get(manualTestId);
  }

  async list(): Promise<readonly ExecutionRecord[]> {
    return [...this.records.values()];
  }
}
