/**
 * Streams observations to the worker monitor (`POST /api/observe`) in small
 * batches so the Monitor Worker tab updates live while the test runs.
 */

import type { Observation, ObservationSessionMeta } from './types.js';

const FLUSH_MS = 1_000;
const MAX_BATCH = 400;

export class MonitorSink {
  private readonly endpoint: string;
  private readonly session: ObservationSessionMeta;
  private queue: Observation[] = [];
  private timer: NodeJS.Timeout | undefined;
  private inflight: Promise<void> = Promise.resolve();
  private status: string | undefined;

  constructor(monitorUrl: string, session: ObservationSessionMeta) {
    this.endpoint = `${monitorUrl.replace(/\/$/u, '')}/api/observe`;
    this.session = session;
  }

  start(): void {
    this.post([], 'running');
    this.timer = setInterval(() => this.flush(), FLUSH_MS);
    this.timer.unref?.();
  }

  push(observation: Observation): void {
    this.queue.push(observation);
    if (this.queue.length >= MAX_BATCH) {
      this.flush();
    }
  }

  async close(status: string): Promise<void> {
    if (this.timer !== undefined) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    this.status = status;
    this.flush();
    await this.inflight;
  }

  private flush(): void {
    if (this.queue.length === 0 && this.status === undefined) {
      return;
    }
    const batch = this.queue.splice(0, this.queue.length);
    const status = this.status;
    this.status = undefined;
    this.post(batch, status);
  }

  private post(observations: readonly Observation[], status: string | undefined): void {
    const body = JSON.stringify({ session: this.session, status, observations });
    this.inflight = this.inflight.then(async () => {
      try {
        await fetch(this.endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
          signal: AbortSignal.timeout(5_000),
        });
      } catch {
        // Monitor is optional.
      }
    });
  }
}

export function monitorUrlFromEnv(): string | undefined {
  const url = process.env.SGAP_MONITOR_URL;
  return url !== undefined && url.length > 0 ? url : undefined;
}
