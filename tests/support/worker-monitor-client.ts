/**
 * Shared client for the SGAP worker monitor HTTP API.
 * Used by the Playwright lane reporter and fixtures (early end before reader teardown).
 */

import path from 'node:path';

import type { TestInfo } from '@playwright/test';
import type { TestCase, TestResult } from '@playwright/test/reporter';

import { laneFromProjectMetadata, workerTag } from './parallel-lanes.js';

export async function postMonitorEvent(payload: Record<string, unknown>): Promise<void> {
  const base = process.env.SGAP_MONITOR_URL;
  if (base === undefined || base.length === 0) {
    return;
  }
  try {
    await fetch(`${base.replace(/\/$/, '')}/api/event`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch {
    // Monitor is optional.
  }
}

export function testCodeFromTitle(title: string, file?: string): string {
  const fromTitle = title.match(/\b([A-Z]{2,}-\d{3})\b/);
  if (fromTitle?.[1] !== undefined) {
    return fromTitle[1];
  }
  if (file !== undefined) {
    const fromFile = path.basename(file).match(/^([A-Z]{2,}-\d{3})/);
    if (fromFile?.[1] !== undefined) {
      return fromFile[1];
    }
  }
  return title.slice(0, 16);
}

function relativeSpecFile(file: string): string {
  const needle = `${path.sep}tests${path.sep}specs${path.sep}`;
  const index = file.replaceAll('/', path.sep).lastIndexOf(needle);
  if (index >= 0) {
    return file.slice(index + needle.length).replaceAll('\\', '/');
  }
  return path.basename(file);
}

function errorText(result: TestResult): string | undefined {
  const message = result.error?.message ?? result.errors[0]?.message;
  if (message === undefined || message.length === 0) {
    return undefined;
  }
  return message.replace(/\u001b\[[0-9;]*m/g, '').split('\n')[0]?.slice(0, 240);
}

export function lanePayloadFromTest(test: TestCase): Record<string, unknown> {
  const project = test.parent.project();
  const lane = laneFromProjectMetadata(project?.metadata as Record<string, unknown> | undefined);
  return {
    id: lane?.id,
    workerId: lane?.id,
    category: lane?.category ?? project?.name,
    playerId: lane?.playerId,
    project: project?.name,
    categories: project?.metadata?.sgapCategories,
  };
}

export function testPayloadFromCase(test: TestCase, result?: TestResult): Record<string, unknown> {
  return {
    key: test.id,
    id: testCodeFromTitle(test.title, test.location.file),
    title: test.title,
    file: relativeSpecFile(test.location.file),
    retry: result?.retry ?? 0,
    durationMs: result?.duration,
    status: result?.status,
    error: result === undefined ? undefined : errorText(result),
    startedAt: result?.startTime ? new Date(result.startTime).getTime() : Date.now(),
  };
}

export function laneTagFromTest(test: TestCase): string {
  const project = test.parent.project();
  const lane = laneFromProjectMetadata(project?.metadata as Record<string, unknown> | undefined);
  if (lane === undefined) {
    return `[${project?.name ?? 'project'}]`;
  }
  return workerTag(lane);
}

/**
 * Push pass/fail to the monitor as soon as the test body finishes — before
 * Backend Reader teardown (which can wait minutes and otherwise leaves the
 * HUD stuck on "running").
 *
 * Key must match Playwright `test.id` / `testInfo.testId` so the start row updates.
 */
export async function reportFixtureTestEnd(testInfo: TestInfo): Promise<void> {
  if (process.env.SGAP_MONITOR_URL === undefined || process.env.SGAP_MONITOR_URL.length === 0) {
    return;
  }

  const status = testInfo.status;
  if (
    status !== 'passed' &&
    status !== 'failed' &&
    status !== 'timedOut' &&
    status !== 'skipped' &&
    status !== 'interrupted'
  ) {
    return;
  }

  const lane = laneFromProjectMetadata(
    testInfo.project.metadata as Record<string, unknown> | undefined,
  );
  const id = testCodeFromTitle(testInfo.title, testInfo.file);
  const error =
    testInfo.errors.length > 0
      ? String(testInfo.errors[0]?.message ?? testInfo.errors[0])
          .replace(/\u001b\[[0-9;]*m/g, '')
          .split('\n')[0]
          ?.slice(0, 240)
      : undefined;

  await postMonitorEvent({
    type: 'end',
    id: lane?.id,
    workerId: lane?.id,
    category: lane?.category ?? testInfo.project.name,
    playerId: lane?.playerId,
    project: testInfo.project.name,
    categories: testInfo.project.metadata?.sgapCategories,
    test: {
      key: testInfo.testId,
      id,
      title: testInfo.title,
      file: relativeSpecFile(testInfo.file),
      retry: testInfo.retry,
      durationMs: testInfo.duration,
      status,
      error,
      startedAt: Date.now() - (testInfo.duration || 0),
    },
  });
}
