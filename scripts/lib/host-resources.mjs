/**
 * Host capacity for the execution manager. Concurrency is bounded by what this
 * machine can carry (cores, RAM, an optional operator cap), never by a user count.
 *
 * Limits: config/qa-server.json, overridden per host by .sgap/qa-server.json.
 *   maxConcurrentRuns   "auto" (no run cap; browsers decide) | number
 *   maxBrowsers         "auto" (min of the CPU and RAM limits) | number
 *   memoryPerBrowserMB  RAM one game browser + its Playwright worker needs
 *   reserveMemoryMB     RAM kept free for the OS, the panel and Allure
 *   cpuCoresPerBrowser  cores one game browser needs
 *   whenFull            "queue" (wait for capacity) | "reject"
 */
import { existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DEFAULTS = {
  maxConcurrentRuns: 'auto',
  maxBrowsers: 'auto',
  memoryPerBrowserMB: 900,
  reserveMemoryMB: 2048,
  cpuCoresPerBrowser: 1,
  whenFull: 'queue',
  keepFinishedRuns: 200,
  sessionHours: 12,
};

function readJson(file) {
  if (!existsSync(file)) return {};
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(`${file}: ${error.message}`);
  }
}

export function loadServerConfig(cwd = process.cwd()) {
  const { $comment, ...shared } = readJson(path.join(cwd, 'config', 'qa-server.json'));
  const { $comment: _, ...local } = readJson(path.join(cwd, '.sgap', 'qa-server.json'));
  return { ...DEFAULTS, ...shared, ...local };
}

function cap(value) {
  const n = Number(value);
  return value === 'auto' || value === undefined || !Number.isFinite(n) || n <= 0 ? Infinity : Math.floor(n);
}

const gb = (mb) => `${(mb / 1024).toFixed(1)} GB`;

/** What this host can run right now, given the browsers already in use. */
export function hostCapacity(config, inUse = { runs: 0, browsers: 0 }) {
  const cores = typeof os.availableParallelism === 'function' ? os.availableParallelism() : os.cpus().length;
  const totalMB = Math.round(os.totalmem() / 1048576);
  const freeMB = Math.round(os.freemem() / 1048576);
  const perBrowser = Math.max(1, Number(config.memoryPerBrowserMB) || DEFAULTS.memoryPerBrowserMB);
  const reserve = Math.max(0, Number(config.reserveMemoryMB) || 0);
  const coresPer = Math.max(0.25, Number(config.cpuCoresPerBrowser) || 1);

  const limits = [
    { by: 'cpu', browsers: Math.floor(cores / coresPer), detail: `${cores} CPU cores at ${coresPer} per browser` },
    { by: 'memory', browsers: Math.floor((totalMB - reserve) / perBrowser), detail: `${gb(totalMB)} RAM, ${gb(reserve)} reserved, ${perBrowser} MB per browser` },
  ];
  const configured = cap(config.maxBrowsers);
  if (configured !== Infinity) limits.push({ by: 'config', browsers: configured, detail: `maxBrowsers = ${configured}` });
  const binding = limits.reduce((low, entry) => (entry.browsers < low.browsers ? entry : low));
  const maxBrowsers = Math.max(1, binding.browsers);
  const maxRuns = cap(config.maxConcurrentRuns);

  return {
    cores,
    totalMB,
    freeMB,
    memoryPerBrowserMB: perBrowser,
    reserveMemoryMB: reserve,
    maxBrowsers,
    limitedBy: binding,
    maxRuns: maxRuns === Infinity ? null : maxRuns,
    runsActive: inUse.runs,
    browsersInUse: inUse.browsers,
    browsersFree: Math.max(0, maxBrowsers - inUse.browsers),
  };
}

/**
 * Can a run that needs `need` browsers at once start now?
 * { ok: true } | { ok: false, permanent, reason }  (permanent = will never fit on this host)
 */
export function admit(config, need, inUse) {
  const host = hostCapacity(config, inUse);
  if (need > host.maxBrowsers) {
    return {
      ok: false,
      permanent: true,
      reason: `Needs ${need} browsers at once; this host fits at most ${host.maxBrowsers} (${host.limitedBy.detail}). Select fewer games per package or raise the limit in .sgap/qa-server.json.`,
      host,
    };
  }
  if (host.maxRuns !== null && inUse.runs >= host.maxRuns) {
    return { ok: false, reason: `${inUse.runs} of ${host.maxRuns} concurrent runs in use (maxConcurrentRuns).`, host };
  }
  if (inUse.browsers + need > host.maxBrowsers) {
    return {
      ok: false,
      reason: `Needs ${need} browser${need === 1 ? '' : 's'}; ${host.browsersFree} of ${host.maxBrowsers} free (${host.limitedBy.detail}).`,
      host,
    };
  }
  const neededMB = host.reserveMemoryMB + need * host.memoryPerBrowserMB;
  if (host.freeMB < neededMB) {
    return {
      ok: false,
      reason: `Needs ${gb(need * host.memoryPerBrowserMB)} RAM plus ${gb(host.reserveMemoryMB)} reserve; ${gb(host.freeMB)} free right now.`,
      host,
    };
  }
  return { ok: true, host };
}
