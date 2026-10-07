import path from 'node:path';

/**
 * Output root of the current execution. Runs started by the execution manager set
 * SGAP_RUN_DIR (runs/RUN-0007/) so concurrent runs never share artifacts; otherwise
 * the classic test-results/ folder. Mirror of scripts/lib/sgap-run-paths.mjs.
 */
export function resultsRoot(): string {
  const dir = process.env.SGAP_RUN_DIR?.trim();
  return dir ? path.resolve(dir) : path.join(process.cwd(), 'test-results');
}
