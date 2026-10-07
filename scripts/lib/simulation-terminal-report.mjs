/**
 * Detailed terminal output for SGAP staging / package simulations.
 * Parses Playwright JSON (test-results/results.json) after each wave.
 */
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const RESULTS_JSON = path.join(process.cwd(), 'test-results', 'results.json');

const GAME_LABEL = {
  'game:sugar-wonderland': 'Sugar Wonderland',
  'game:felice-in-space': 'Felice in Space',
  'game:beelze-bop': 'Beelze-Bop',
  'game:mars-triumph': 'Mars Triumph',
  chromium: 'Sugar Wonderland (chromium)',
  chrome: 'Chrome',
  edge: 'Edge',
};

function line(char = '=', width = 80) {
  return char.repeat(width);
}

function formatDuration(ms) {
  if (ms < 1000) return `${ms}ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}m ${rem}s`;
}

function stripAnsi(text) {
  return text.replace(/\u001b\[[0-9;]*m/g, '');
}

function firstLineError(error) {
  if (!error?.message) return 'unknown error';
  return stripAnsi(error.message).split('\n')[0].slice(0, 120);
}

function specIdFromFile(file) {
  const base = path.basename(file ?? '', path.extname(file ?? ''));
  return /^[A-Z]+-\d{3}$/u.test(base) ? base : undefined;
}

function walkTests(suites, visit, ancestors = []) {
  if (!Array.isArray(suites)) return;
  for (const suite of suites) {
    const chain = [...ancestors, suite.title].filter(Boolean);
    if (Array.isArray(suite.specs)) {
      for (const spec of suite.specs) {
        const file = spec.file ?? spec.title;
        const specId = specIdFromFile(file) ?? spec.title;
        for (const test of spec.tests ?? []) {
          visit({ chain, specId, file, test });
        }
      }
    }
    walkTests(suite.suites, visit, chain);
  }
}

export function loadPlaywrightResults(resultsPath = RESULTS_JSON) {
  if (!existsSync(resultsPath)) {
    return { rows: [], stats: { passed: 0, failed: 0, skipped: 0, total: 0 } };
  }

  let report;
  try {
    report = JSON.parse(readFileSync(resultsPath, 'utf8'));
  } catch {
    return { rows: [], stats: { passed: 0, failed: 0, skipped: 0, total: 0 } };
  }

  const rows = [];
  walkTests(report.suites, ({ chain, specId, file, test }) => {
    const result = test.results?.[0];
    if (!result) return;

    const status = result.status ?? 'unknown';
    const project = test.projectName ?? 'unknown';
    const manualId =
      result.annotations?.find((a) => a.type === 'manualTestId')?.description ?? specId;
    const playerId =
      result.annotations?.find((a) => a.type === 'launcherPlayerId')?.description;

    rows.push({
      project,
      gameLabel: GAME_LABEL[project] ?? project,
      manualId,
      title: test.title,
      file,
      status,
      durationMs: result.duration ?? 0,
      error: status === 'failed' ? firstLineError(result.error) : undefined,
      playerId,
      suite: chain.join(' › '),
    });
  });

  const stats = {
    passed: rows.filter((r) => r.status === 'passed').length,
    failed: rows.filter((r) => r.status === 'failed').length,
    skipped: rows.filter((r) => r.status === 'skipped').length,
    total: rows.length,
  };

  return { rows, stats, report };
}

export function printSimulationHeader({
  title,
  subtitle,
  games = [],
  workers,
  headed,
  launcherMode,
  gameId,
  waves = [],
}) {
  const now = new Date();
  console.log(`\n${line()}`);
  console.log(` SGAP SIMULATION — ${title}`);
  if (subtitle) console.log(` ${subtitle}`);
  console.log(line('-'));
  console.log(` Started : ${now.toISOString()} (${now.toLocaleString()})`);
  if (launcherMode) console.log(` Mode    : ${launcherMode}`);
  if (gameId) console.log(` Game ID : ${gameId}`);
  if (games.length) console.log(` Games   : ${games.join(', ')}`);
  if (workers !== undefined) console.log(` Workers : ${workers}`);
  if (headed !== undefined) console.log(` Headed  : ${headed ? 'yes' : 'no'}`);
  if (waves.length) {
    console.log(` Waves   :`);
    for (const w of waves) console.log(`           - ${w}`);
  }
  console.log(` Results : test-results/results.json`);
  console.log(` Report  : playwright-report/index.html`);
  console.log(`${line()}\n`);
}

export function printWaveStart({ name, detail, index, total }) {
  const prefix = total ? `[Wave ${index}/${total}]` : '[Wave]';
  console.log(`\n${line('-', 72)}`);
  console.log(`${prefix} ${name}`);
  if (detail) console.log(`         ${detail}`);
  console.log(`${line('-', 72)}\n`);
}

export function printWaveSummary({ waveName, exitCode, startedAt, resultsPath = RESULTS_JSON }) {
  const elapsed = Date.now() - startedAt;
  const { rows, stats } = loadPlaywrightResults(resultsPath);

  console.log(`\n${line('-', 72)}`);
  console.log(` WAVE SUMMARY — ${waveName}`);
  console.log(line('-', 72));
  console.log(
    ` Duration: ${formatDuration(elapsed)} | Exit: ${exitCode === 0 ? 'PASS' : 'FAIL'} (${exitCode})`,
  );
  console.log(
    ` Tests   : ${stats.passed} passed, ${stats.failed} failed, ${stats.skipped} skipped (${stats.total} total in JSON)`,
  );

  if (rows.length === 0) {
    console.log(' (no rows in results.json — wave may have been interrupted)\n');
    return { rows, stats };
  }

  const byProject = new Map();
  for (const row of rows) {
    if (!byProject.has(row.project)) byProject.set(row.project, []);
    byProject.get(row.project).push(row);
  }

  console.log('\n By game / project:');
  for (const [project, gameRows] of [...byProject.entries()].sort((a, b) =>
    a[0].localeCompare(b[0]),
  )) {
    const label = GAME_LABEL[project] ?? project;
    const passed = gameRows.filter((r) => r.status === 'passed').length;
    const failed = gameRows.filter((r) => r.status === 'failed').length;
    const mark = failed === 0 ? 'OK' : 'FAIL';
    console.log(`   [${mark}] ${label.padEnd(22)} ${passed}/${gameRows.length} passed`);
  }

  const failures = rows.filter((r) => r.status === 'failed');
  if (failures.length) {
    console.log('\n Failures (this JSON snapshot):');
    for (const f of failures) {
      console.log(`   ✗ [${f.gameLabel}] ${f.manualId} — ${f.error ?? 'failed'}`);
      if (f.playerId) console.log(`       player: ${f.playerId}`);
    }
  }

  const passes = rows.filter((r) => r.status === 'passed');
  if (passes.length && passes.length <= 24) {
    console.log('\n Passed:');
    for (const p of passes) {
      console.log(`   ✓ [${p.gameLabel}] ${p.manualId} (${formatDuration(p.durationMs)})`);
    }
  } else if (passes.length) {
    console.log(`\n Passed: ${passes.length} tests (list omitted — open HTML report for full detail)`);
  }

  console.log('');
  return { rows, stats };
}

export function printSimulationFooter({ waveResults, startedAt }) {
  const elapsed = Date.now() - startedAt;
  const totals = waveResults.reduce(
    (acc, w) => {
      acc.passed += w.stats?.passed ?? 0;
      acc.failed += w.stats?.failed ?? 0;
      acc.skipped += w.stats?.skipped ?? 0;
      acc.total += w.stats?.total ?? 0;
      acc.exit |= w.exitCode ?? 0;
      return acc;
    },
    { passed: 0, failed: 0, skipped: 0, total: 0, exit: 0 },
  );

  console.log(line());
  console.log(' SGAP SIMULATION — FINAL ROLLUP');
  console.log(line('-'));
  console.log(` Finished : ${new Date().toISOString()}`);
  console.log(` Duration : ${formatDuration(elapsed)}`);
  console.log(
    ` Totals   : ${totals.passed} passed, ${totals.failed} failed, ${totals.skipped} skipped`,
  );

  for (const w of waveResults) {
    const s = w.stats ?? { passed: 0, failed: 0, total: 0 };
    const mark = w.exitCode === 0 ? 'OK' : 'FAIL';
    console.log(
      `   [${mark}] ${w.name.padEnd(28)} exit=${w.exitCode}  (${s.passed}/${s.total} passed in snapshot)`,
    );
  }

  console.log(line('-'));
  console.log(` Overall  : ${totals.exit === 0 ? 'PASS' : 'FAIL'} (exit ${totals.exit})`);
  console.log(` Report   : playwright-report/index.html`);
  console.log(`${line()}\n`);

  return totals.exit;
}

/** Run Playwright and print wave bookends; returns exit code. */
export function runPlaywrightWave({
  spawnSync,
  npxArgs,
  env,
  waveName,
  waveDetail,
  waveIndex,
  waveTotal,
}) {
  printWaveStart({ name: waveName, detail: waveDetail, index: waveIndex, total: waveTotal });
  const startedAt = Date.now();
  const result = spawnSync('npx', npxArgs, {
    stdio: 'inherit',
    shell: true,
    env,
  });
  const exitCode = result.status ?? 1;
  const { stats } = printWaveSummary({ waveName, exitCode, startedAt });
  return { exitCode, stats, startedAt };
}
