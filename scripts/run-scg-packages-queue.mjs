/**
 * Run the SCG (scratch) suite for a QUEUE of packages, back-to-back and unattended,
 * each through the worker monitor (4 games at a time). Per-package Allure is generated
 * (no browser popups mid-queue); at the very end one combined report across every
 * queued package is generated and opened.
 *
 * Usage:
 *   node scripts/run-scg-packages-queue.mjs            # default queue: 3 4 5 6 7 8 11
 *   node scripts/run-scg-packages-queue.mjs 3 4 5      # custom queue
 *   SGAP_SCG_SPEC=SCG-024 node scripts/run-scg-packages-queue.mjs 1 2 3   # one case only
 */
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';

import { publishAllureReport } from './generate-allure-report.mjs';

const cwd = process.cwd();
const DEFAULT_QUEUE = ['3', '4', '5', '6', '7', '8', '11'];
const queue = process.argv.slice(2).length > 0 ? process.argv.slice(2) : DEFAULT_QUEUE;
const spec = process.env.SGAP_SCG_SPEC?.trim() || undefined;
const configSuffix = spec !== undefined ? `-${spec.toLowerCase()}` : '';

function hasResults(dir) {
  try {
    return readdirSync(dir).some((name) => name.endsWith('-result.json'));
  } catch {
    return false;
  }
}

console.log('');
console.log('SGAP SCG package queue');
console.log('────────────────────────────────────────');
console.log(` queue : packages ${queue.join(', ')}`);
console.log(` each  : ${spec ?? 'full SCG suite'}, 4 games at a time, via worker monitor`);
console.log('────────────────────────────────────────');

const accumRoot = path.join('allure-results', `scg-queue${configSuffix}`);
rmSync(path.join(cwd, accumRoot), { recursive: true, force: true });
mkdirSync(path.join(cwd, accumRoot), { recursive: true });

const combinedSources = [];
const summary = [];
const startedAt = Date.now();

for (const [index, pkg] of queue.entries()) {
  console.log(`\n######## [${index + 1}/${queue.length}] Package ${pkg} ########`);

  const genArgs = ['scripts/gen-scg-lane-config.mjs', '--package', pkg, ...(spec !== undefined ? ['--spec', spec] : [])];
  const gen = spawnSync(process.execPath, genArgs, {
    cwd,
    stdio: 'inherit',
  });
  if (gen.status !== 0) {
    console.error(`Package ${pkg}: config generation failed; skipping.`);
    summary.push({ pkg, exit: gen.status ?? -1, note: 'config gen failed' });
    continue;
  }

  const configPath = `config/parallel-workers-scg-pkg${pkg}${configSuffix}.json`;
  const run = spawnSync(process.execPath, ['scripts/run-parallel-workers.mjs'], {
    cwd,
    stdio: 'inherit',
    env: {
      ...process.env,
      SGAP_PARALLEL_CONFIG: configPath,
      // Generate per-package Allure but do not pop the browser mid-queue.
      SGAP_SKIP_ALLURE_OPEN: '1',
    },
  });
  summary.push({ pkg, exit: run.status ?? -1 });

  // Preserve this package's per-worker results for the final combined report before
  // the next package resets allure-results/w1..w4.
  for (const id of [1, 2, 3, 4]) {
    const src = path.join(cwd, 'allure-results', `w${id}`);
    if (existsSync(src) && hasResults(src)) {
      const dest = path.join(cwd, accumRoot, `pkg${pkg}`, `w${id}`);
      mkdirSync(dest, { recursive: true });
      cpSync(src, dest, { recursive: true });
      combinedSources.push(path.join(accumRoot, `pkg${pkg}`, `w${id}`));
    }
  }
}

const elapsedMin = Math.round((Date.now() - startedAt) / 60000);
console.log('\nQueue summary');
console.log('────────────────────────────────────────');
for (const row of summary) {
  console.log(`  Package ${String(row.pkg).padEnd(3)} exit=${row.exit}${row.note ? ` (${row.note})` : ''}`);
}
console.log('────────────────────────────────────────');
console.log(`  ${queue.length} packages in ${elapsedMin}m`);

if (combinedSources.length > 0) {
  console.log(`\nAllure: building ONE combined report across packages ${queue.join(', ')}`);
  // Final combined report DOES open the history index.
  delete process.env.SGAP_SKIP_ALLURE_OPEN;
  await publishAllureReport({ sources: combinedSources });
} else {
  console.log('Allure: no results accumulated to publish.');
}

process.exit(summary.some((row) => row.exit !== 0) ? 1 : 0);
