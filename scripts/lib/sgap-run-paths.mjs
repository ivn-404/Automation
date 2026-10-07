/**
 * Where one execution writes its outputs.
 *
 * A run started by the execution manager (scripts/lib/execution-manager.mjs) gets
 * SGAP_RUN_ID and SGAP_RUN_DIR (runs/RUN-0007/), so concurrent runs never share
 * results, Allure input, lane configs, the lockfile or the backend-reader store.
 * Without SGAP_RUN_DIR (a run started by hand) the classic repo-level folders are used.
 *
 * Mirror for test code: src/shared/run-paths.ts.
 */
import path from 'node:path';

export function runDir(env = process.env) {
  const dir = env.SGAP_RUN_DIR?.trim();
  return dir ? path.resolve(dir) : undefined;
}

export function runId(env = process.env) {
  return env.SGAP_RUN_ID?.trim() || undefined;
}

/** A run owned by the execution manager: other runs may be live on this host. */
export function isManagedRun(env = process.env) {
  return runId(env) !== undefined && runDir(env) !== undefined;
}

/** test-results/ equivalent. */
export function resultsRoot(env = process.env) {
  return runDir(env) ?? path.join(process.cwd(), 'test-results');
}

/** allure-results/ equivalent (lanes write <root>/w<laneId>). */
export function allureResultsRoot(env = process.env) {
  const dir = runDir(env);
  return dir ? path.join(dir, 'allure-results') : path.join(process.cwd(), 'allure-results');
}

/** Folder for generated lane configs (repo-relative when possible, forward slashes). */
export function laneConfigDir(env = process.env) {
  const dir = runDir(env);
  return dir ? path.join(dir, 'lanes') : path.join(process.cwd(), 'config', 'generated');
}
