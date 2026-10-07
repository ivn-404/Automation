/**
 * Per-PC tester name, so several QA machines can run the same lanes against
 * staging without sharing a player (wallet, session, free-spin state).
 *
 * Set once per PC, either as an environment variable or in the git-ignored
 * `.env` at the repo root:
 *
 *   SGAP_TESTER=Ana
 *
 * Lane player ids then become `<Game Name>_<SUFFIX>_<Tester>`.
 * Only SGAP_TESTER is read from `.env`; other keys there are left alone.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export function sanitizeTester(raw) {
  return String(raw ?? '').replace(/[^A-Za-z0-9]/gu, '').slice(0, 16);
}

function testerFromDotEnv(root) {
  const file = path.join(root, '.env');
  if (!existsSync(file)) return '';
  const match = readFileSync(file, 'utf8').match(/^\s*SGAP_TESTER\s*=\s*["']?([^"'\r\n#]*)/mu);
  return match ? match[1].trim() : '';
}

/** Resolves the tester name and publishes it as SGAP_TESTER for child processes. */
export function resolveTester(env = process.env, root = ROOT) {
  const tester = sanitizeTester(env.SGAP_TESTER?.trim() || testerFromDotEnv(root));
  if (tester.length > 0) env.SGAP_TESTER = tester;
  else delete env.SGAP_TESTER;
  return tester;
}

export function testerPlayerId(playerId, tester) {
  if (!tester || !playerId || playerId.endsWith(`_${tester}`)) return playerId;
  return `${playerId}_${tester}`;
}
