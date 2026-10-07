/**
 * Stop leftover SGAP Playwright Chromium and recorded worker PIDs.
 * Uses tasklist window titles (Chrome for Testing) — no WMIC/PowerShell.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';

import { liveManagedRuns } from './lib/sgap-process-guard.mjs';

const LOCKFILE = path.join(process.cwd(), 'test-results', 'sgap-parallel.lock.json');

function taskkill(args) {
  return spawnSync('taskkill', args, {
    windowsHide: true,
    timeout: 12_000,
    encoding: 'utf8',
  });
}

function killPidTree(pid) {
  const n = Number(pid);
  if (!Number.isInteger(n) || n <= 0 || n === process.pid) {
    return false;
  }
  const result = taskkill(['/F', '/T', '/PID', String(n)]);
  return result.status === 0;
}

function listChromeForTestingPids() {
  const result = spawnSync(
    'tasklist',
    ['/V', '/FI', 'IMAGENAME eq chrome.exe', '/FO', 'CSV'],
    { windowsHide: true, timeout: 20_000, encoding: 'utf8' },
  );
  const text = result.stdout ?? '';
  const pids = new Set();
  for (const line of text.split(/\r?\n/)) {
    if (!line.includes('Chrome for Testing') && !line.includes('[Worker ') && !line.includes('SGAP Worker Monitor')) {
      continue;
    }
    const match = line.match(/"chrome.exe","(\d+)"/i);
    if (match) {
      pids.add(Number(match[1]));
    }
  }
  return [...pids];
}

let killed = 0;

if (existsSync(LOCKFILE)) {
  try {
    const data = JSON.parse(readFileSync(LOCKFILE, 'utf8'));
    for (const pid of [...(data.children ?? []), data.parent]) {
      if (killPidTree(pid)) {
        killed += 1;
      }
    }
  } catch {
    // ignore malformed lock
  }
  rmSync(LOCKFILE, { force: true });
}

if (liveManagedRuns().length > 0) {
  console.error('SGAP: control panel runs are live on this host; leaving their browsers alone (stop them from the panel)');
} else {
  for (const pid of listChromeForTestingPids()) {
    if (killPidTree(pid)) {
      killed += 1;
    }
  }
}

console.error(
  killed > 0
    ? `SGAP: terminated ${killed} Playwright Chrome for Testing / worker process tree(s)`
    : 'SGAP: no Chrome for Testing worker windows found',
);
process.stdout.write('{}\n');
