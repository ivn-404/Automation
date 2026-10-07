/**
 * Prefix Playwright output with [Worker N][CAT][player] for parallel lanes
 * and stream live pass/fail events to the SGAP worker monitor.
 */

import type {
  FullConfig,
  FullResult,
  Reporter,
  Suite,
  TestCase,
  TestResult,
} from '@playwright/test/reporter';

import { laneFromProjectMetadata, workerTag } from './parallel-lanes.js';
import {
  lanePayloadFromTest,
  laneTagFromTest,
  postMonitorEvent,
  testPayloadFromCase,
} from './worker-monitor-client.js';

export default class ParallelLaneReporter implements Reporter {
  printsToStdio(): boolean {
    return false;
  }

  onBegin(config: FullConfig, suite: Suite): void {
    const laneProjects = config.projects.filter(
      (project) => laneFromProjectMetadata(project.metadata as Record<string, unknown> | undefined) !== undefined,
    );
    if (laneProjects.length === 0) {
      return;
    }
    console.log('');
    console.log('SGAP parallel lanes');
    for (const project of laneProjects) {
      const lane = laneFromProjectMetadata(project.metadata as Record<string, unknown> | undefined);
      if (lane === undefined) {
        continue;
      }
      const categories =
        typeof project.metadata?.sgapCategories === 'string'
          ? project.metadata.sgapCategories
          : lane.category;
      console.log(
        `  ${workerTag(lane)}  project=${project.name}  ${categories}  dir=${project.testDir}`,
      );
    }
    console.log('');

    const tests = suite.allTests();
    const first = tests[0];
    if (first === undefined) {
      return;
    }
    void postMonitorEvent({
      type: 'roster',
      ...lanePayloadFromTest(first),
      tests: tests.map((test) => testPayloadFromCase(test)),
    });
  }

  onTestBegin(test: TestCase, result: TestResult): void | Promise<void> {
    console.log(`${laneTagFromTest(test)} START ${test.title}`);
    return postMonitorEvent({
      type: 'start',
      ...lanePayloadFromTest(test),
      test: { ...testPayloadFromCase(test, result), status: 'running' },
    });
  }

  onTestEnd(test: TestCase, result: TestResult): void | Promise<void> {
    const status = result.status.toUpperCase();
    console.log(`${laneTagFromTest(test)} ${status} ${test.title} (${Math.round(result.duration / 1000)}s)`);
    return postMonitorEvent({
      type: 'end',
      ...lanePayloadFromTest(test),
      test: testPayloadFromCase(test, result),
    });
  }

  onEnd(_result: FullResult): void | Promise<void> {
    const workerId = Number(process.env.SGAP_WORKER_ID);
    if (!Number.isFinite(workerId) || workerId <= 0) {
      return;
    }
    // Await so the process does not exit before the lane clears "running".
    return postMonitorEvent({ type: 'lane-end', id: workerId, workerId });
  }
}
