/**
 * Offline Allure historyId check for F7-C1. No browser, no wallet, no /bet.
 * node --import ./scripts/lib/register-ts-loader.mjs src/verification/smoke-at003-historyid.ts
 */
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const requireFromAllure = createRequire(
  path.join(
    process.cwd(),
    'node_modules',
    '.pnpm',
    'allure-playwright@3.10.2_@playwright+test@1.62.1',
    'node_modules',
    'allure-playwright',
    'package.json',
  ),
);
const { getTestResultHistoryId } = requireFromAllure('allure-js-commons/sdk/reporter') as {
  readonly getTestResultHistoryId: (result: SyntheticResult) => string;
};

interface Parameter {
  readonly name: string;
  readonly value: string;
  readonly excluded?: boolean;
}

interface SyntheticResult {
  readonly uuid: string;
  readonly name: string;
  readonly statusDetails: Record<string, never>;
  readonly stage: string;
  readonly steps: readonly unknown[];
  readonly attachments: readonly unknown[];
  readonly parameters: Parameter[];
  readonly labels: readonly { readonly name: string; readonly value?: string }[];
  readonly links: readonly unknown[];
  readonly fullName: string;
  readonly historyId?: string;
}

function fail(message: string): never {
  throw new Error(message);
}

const AT003_FULL_NAME = 'at/AT-003.spec.ts:90:7';
const HISTORICAL_SUGAR = path.join(
  process.cwd(),
  'allure-results',
  'queue-regression',
  'pkg1',
  'w1',
  'd96e8491-4d62-4d93-981f-162052b0617b-result.json',
);

const DIAGNOSTIC_NAMES = [
  'at003.server',
  'at003.hud',
  'at003.dialog',
  'at003.overall',
  'at003.injectedReachedStaging',
] as const;

function diagnosticParameters(outcome: {
  readonly server: string;
  readonly hud: string;
  readonly dialog: string;
  readonly overall: string;
}): Parameter[] {
  return [
    { name: 'at003.server', value: outcome.server, excluded: true },
    { name: 'at003.hud', value: outcome.hud, excluded: true },
    { name: 'at003.dialog', value: outcome.dialog, excluded: true },
    { name: 'at003.overall', value: outcome.overall, excluded: true },
    { name: 'at003.injectedReachedStaging', value: 'false', excluded: true },
  ];
}

function syntheticResult(parameters: readonly Parameter[], fullName = AT003_FULL_NAME): SyntheticResult {
  return {
    uuid: 'synthetic',
    name: 'AT-003 failed bet is refunded to the balance',
    statusDetails: {},
    stage: 'finished',
    steps: [],
    attachments: [],
    parameters: [...parameters],
    labels: [],
    links: [],
    fullName,
  };
}

function identityOf(gameId: string, outcome: Parameters<typeof diagnosticParameters>[0]): SyntheticResult {
  return syntheticResult([
    { name: 'gameId', value: gameId },
    ...diagnosticParameters(outcome),
  ]);
}

function main(): void {
  const sugarPass = identityOf('sugar-wonderland', {
    server: 'SERVER_CONTINUITY_OK',
    hud: 'HUD_RESTORED',
    dialog: 'DIALOG_RECOVERED',
    overall: 'PASS',
  });
  const sugarFail = identityOf('sugar-wonderland', {
    server: 'SERVER_CONTINUITY_OK',
    hud: 'HUD_STALE_AFTER_FAILURE',
    dialog: 'DIALOG_RECOVERED',
    overall: 'FAIL',
  });
  const beelzeFail = identityOf('beelze-bop', {
    server: 'SERVER_CONTINUITY_OK',
    hud: 'HUD_STALE_AFTER_FAILURE',
    dialog: 'DIALOG_RECOVERED',
    overall: 'FAIL',
  });

  const sugarPassId = getTestResultHistoryId(sugarPass);
  const sugarFailId = getTestResultHistoryId(sugarFail);
  const beelzeFailId = getTestResultHistoryId(beelzeFail);

  if (sugarPassId !== sugarFailId) {
    fail(`same game, different contracts must share historyId: pass=${sugarPassId} fail=${sugarFailId}`);
  }
  if (sugarPassId === beelzeFailId) {
    fail(`Sugar and Beelze must not share historyId: ${sugarPassId}`);
  }

  for (const param of sugarPass.parameters) {
    if (param.name === 'gameId') {
      if (param.excluded === true) {
        fail('F9-A gameId must remain non-excluded');
      }
      continue;
    }
    if (DIAGNOSTIC_NAMES.includes(param.name as (typeof DIAGNOSTIC_NAMES)[number])) {
      if (param.excluded !== true) {
        fail(`${param.name} must be excluded`);
      }
    }
  }

  const uncorrectedPass = syntheticResult([
    { name: 'gameId', value: 'sugar-wonderland' },
    { name: 'at003.overall', value: 'PASS' },
  ]);
  const uncorrectedFail = syntheticResult([
    { name: 'gameId', value: 'sugar-wonderland' },
    { name: 'at003.overall', value: 'FAIL' },
  ]);
  if (getTestResultHistoryId(uncorrectedPass) === getTestResultHistoryId(uncorrectedFail)) {
    fail('control: non-excluded outcome parameters must change historyId');
  }

  const historical = JSON.parse(readFileSync(HISTORICAL_SUGAR, 'utf8')) as SyntheticResult & {
    readonly testCaseId?: string;
  };
  const storedId = historical.historyId;
  const recomputed = getTestResultHistoryId({
    ...historical,
    steps: [],
    attachments: [],
  });
  if (storedId === undefined || storedId.length === 0) {
    fail('historical Sugar AT-003 has no historyId');
  }
  if (recomputed !== storedId) {
    fail(`SDK historyId ${recomputed} !== stored ${storedId}`);
  }

  const historicalWithExcluded = getTestResultHistoryId({
    ...historical,
    steps: [],
    attachments: [],
    parameters: [...(historical.parameters ?? []), ...diagnosticParameters({
      server: 'SERVER_CONTINUITY_OK',
      hud: 'HUD_RESTORED',
      dialog: 'DIALOG_RECOVERED',
      overall: 'PASS',
    })],
  });
  if (historicalWithExcluded !== storedId) {
    fail(`excluded diagnostics must not change historical Sugar historyId: ${historicalWithExcluded} vs ${storedId}`);
  }

  const historicalHasGameIdParam = (historical.parameters ?? []).some((param) => param.name === 'gameId');
  const historicalGameIdLabel = (historical.labels ?? []).find((label) => label.name === 'gameId')?.value;

  console.log(
    JSON.stringify(
      {
        sugarPassFailShared: sugarPassId,
        beelzeDistinct: beelzeFailId,
        historicalSugar: storedId,
        historicalFullName: historical.fullName,
        currentFullName: AT003_FULL_NAME,
        historicalParameters: historical.parameters,
        historicalGameIdLabel,
        historicalHasGameIdParam,
        matchesHistoricalStoredId: sugarPassId === storedId,
        f9aGameIdNonExcluded: true,
        diagnosticsExcluded: true,
      },
      null,
      2,
    ),
  );
  console.log('at003 historyId smoke ok');
}

main();
