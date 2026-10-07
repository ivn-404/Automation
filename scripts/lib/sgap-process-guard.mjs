/**
 * Stop leftover SGAP Playwright processes so a re-run never stacks extra Chromes.
 *
 * Kills:
 * - PIDs recorded in test-results/sgap-parallel.lock.json
 * - chrome.exe launched from ms-playwright (not Google Chrome)
 * - node Playwright test / run-parallel-workers processes for this repo
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export const LOCKFILE = path.join(process.cwd(), 'test-results', 'sgap-parallel.lock.json');

function asPid(value) {
  const pid = Number(value);
  return Number.isInteger(pid) && pid > 0 ? pid : undefined;
}

export function killPidTree(pid) {
  const target = asPid(pid);
  if (target === undefined || target === process.pid) {
    return false;
  }
  if (process.platform === 'win32') {
    const result = spawnSync('taskkill', ['/PID', String(target), '/T', '/F'], {
      encoding: 'utf8',
      windowsHide: true,
    });
    return result.status === 0;
  }
  try {
    process.kill(target, 'SIGTERM');
  } catch {
    // already gone
  }
  try {
    process.kill(target, 'SIGKILL');
  } catch {
    // already gone
  }
  return true;
}

export function writeLockfile(childPids) {
  mkdirSync(path.dirname(LOCKFILE), { recursive: true });
  writeFileSync(
    LOCKFILE,
    JSON.stringify(
      {
        parent: process.pid,
        children: (childPids ?? []).map(asPid).filter(Boolean),
        cwd: process.cwd(),
        startedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
}

export function clearLockfile() {
  rmSync(LOCKFILE, { force: true });
}

export function killLockfileProcesses() {
  if (!existsSync(LOCKFILE)) {
    return 0;
  }
  let data;
  try {
    data = JSON.parse(readFileSync(LOCKFILE, 'utf8'));
  } catch {
    clearLockfile();
    return 0;
  }
  const pids = [...(data.children ?? []), data.parent];
  let killed = 0;
  for (const pid of pids) {
    if (killPidTree(pid)) {
      killed += 1;
    }
  }
  clearLockfile();
  return killed;
}

function collectWindowsLeftoverPids(_excludePid) {
  const titles = ['[Worker*', '*[Worker *', '*Gamename1*', '*Gamename2*', '*Gamename3*', '*Gamename4*', '*SGAP Worker Monitor*'];
  for (const title of titles) {
    spawnSync('taskkill', ['/F', '/FI', `WINDOWTITLE eq ${title}`], {
      windowsHide: true,
      timeout: 2_000,
      encoding: 'utf8',
    });
  }
  return [];
}

function collectUnixLeftoverPids(excludePid) {
  const cwd = process.cwd();
  const result = spawnSync('ps', ['-eo', 'pid,command'], { encoding: 'utf8' });
  const pids = [];
  for (const line of (result.stdout ?? '').split('\n')) {
    const match = line.trim().match(/^(\d+)\s+(.+)$/);
    if (match === null) {
      continue;
    }
    const pid = asPid(match[1]);
    const command = match[2] ?? '';
    if (pid === undefined || pid === process.pid || pid === excludePid) {
      continue;
    }
    const playwrightChrome = command.includes('ms-playwright') && command.includes('chrome');
    const repoPlaywright =
      command.includes(cwd) &&
      (command.includes('run-parallel-workers') || command.includes('playwright/test/cli'));
    if (playwrightChrome || repoPlaywright) {
      pids.push(pid);
    }
  }
  return pids;
}

export function sweepPlaywrightLeftovers(options = {}) {
  const excludePid = asPid(options.excludePid) ?? process.pid;
  const pids =
    process.platform === 'win32'
      ? collectWindowsLeftoverPids(excludePid)
      : collectUnixLeftoverPids(excludePid);
  let killed = 0;
  for (const pid of pids) {
    if (pid === process.pid || pid === excludePid) {
      continue;
    }
    if (killPidTree(pid)) {
      killed += 1;
    }
  }
  return killed;
}

export function stopSgapLeftovers(options = {}) {
  const fromLock = killLockfileProcesses();
  const fromSweep = sweepPlaywrightLeftovers(options);
  return { fromLock, fromSweep, killed: fromLock + fromSweep };
}
