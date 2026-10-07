/**
 * Network, UI Registry, Manifest, Reporting, and Traceability contracts.
 */

import type {
  ExecutionRecord,
  GameManifest,
  LocatorRef,
  NetworkRequestRecord,
  ObservableWaitOptions,
  TraceabilityEntry,
} from '../models/index.js';
import type { ExecutionStatus } from '../constants/index.js';

export interface INetworkCapture {
  start(): Promise<void>;
  stop(): Promise<void>;
  getRequests(): Promise<readonly NetworkRequestRecord[]>;
  waitForRequest(
    predicate: (request: NetworkRequestRecord) => boolean,
    options?: ObservableWaitOptions,
  ): Promise<NetworkRequestRecord>;
}

/**
 * UI Registry — resolve logical locator keys to selectors via manifest.
 */
export interface IUiRegistry {
  resolve(locatorKey: string): LocatorRef & { selector: string };
  has(locatorKey: string): boolean;
  listKeys(): readonly string[];
}

/** Loads game manifests from configuration (not framework code). */
export interface IGameManifestLoader {
  load(gameId: string): Promise<GameManifest>;
  listGameIds(): Promise<readonly string[]>;
}

/**
 * Execution Tracker — records results against original manual test IDs.
 */
export interface IExecutionTracker {
  start(manualTestId: string, browserProject?: string): Promise<void>;
  finish(manualTestId: string, status: ExecutionStatus, errorMessage?: string): Promise<void>;
  record(record: ExecutionRecord): Promise<void>;
  get(manualTestId: string): Promise<ExecutionRecord | undefined>;
  list(): Promise<readonly ExecutionRecord[]>;
}

/**
 * Reporting outputs. Implementations must never overwrite the manual Google Sheet.
 */
export interface IReporter {
  publish(records: readonly ExecutionRecord[]): Promise<void>;
}

export interface ITraceabilityService {
  map(manualTestId: string, automationPath: string): Promise<void>;
  get(manualTestId: string): Promise<TraceabilityEntry | undefined>;
  list(): Promise<readonly TraceabilityEntry[]>;
  updateStatus(manualTestId: string, status: ExecutionStatus): Promise<void>;
}
