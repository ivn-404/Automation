/**
 * Smoke: capability-gate classification and Allure matching, no browser.
 * node --import ./scripts/lib/ts-from-js-loader.mjs src/capabilities/smoke-eligibility.ts
 */
import { FileGameManifestLoader, defaultManifestsDir } from '../platform/manifest/file-game-manifest-loader.js';
import { classifyRequirements } from './eligibility.js';
import { isNotApplicableReason, isNotConfiguredReason, NOT_CONFIGURED_PREFIX } from './game-capabilities.js';

const fail = (message: string): never => {
  throw new Error(message);
};

/** JS equivalent of Allure's Java regex `(?s).*NOT CONFIGURED —.*`. */
const ALLURE_NOT_CONFIGURED = /NOT CONFIGURED —/u;

async function main(): Promise<void> {
  const loader = new FileGameManifestLoader({ manifestsDir: defaultManifestsDir() });
  const blitz = await loader.load('blockchain-blitz');
  const joker = await loader.load('joker-ace');
  const fruit = await loader.load('fruit-attack');
  const sugar = await loader.load('sugar-wonderland');

  const blitzCsf = classifyRequirements(blitz, ['spin', 'bet']);
  if (blitzCsf.status !== 'unmapped') fail(`Blockchain Blitz CSF expected unmapped, got ${blitzCsf.status}`);
  if (blitzCsf.missing.join(',') !== 'spin,bet') fail(`Blockchain Blitz missing ${blitzCsf.missing.join(',')}`);

  const jokerAt = classifyRequirements(joker, ['spin', 'bet']);
  if (jokerAt.status !== 'unmapped') fail(`Joker Ace AT expected unmapped, got ${jokerAt.status}`);

  const fruitBf = classifyRequirements(fruit, ['spin', 'bet', 'buyFeature']);
  if (fruitBf.status !== 'unsupported') fail(`Fruit Attack BF expected unsupported, got ${fruitBf.status}`);
  if (fruitBf.missing.join(',') !== 'buyFeature') fail(`Fruit Attack missing ${fruitBf.missing.join(',')}`);

  const sugarCsf = classifyRequirements(sugar, ['spin', 'bet']);
  if (sugarCsf.status !== 'eligible') fail(`Sugar CSF expected eligible, got ${sugarCsf.status}`);
  if (sugarCsf.missing.length !== 0) fail('Sugar CSF should have no missing capabilities');

  const gateError = `Error: ${NOT_CONFIGURED_PREFIX} Joker Ace does not declare spin, bet (add a controllers[] entry)`;
  if (!isNotConfiguredReason(gateError)) fail('gate error should match isNotConfiguredReason');
  if (!ALLURE_NOT_CONFIGURED.test(gateError)) fail('gate error should match Allure NOT CONFIGURED regex');

  const assertion = 'Error: HUD balance not refunded after the failed bet\nexpect(received).toBe(expected)';
  if (isNotConfiguredReason(assertion)) fail('assertion failure must not be NOT CONFIGURED');
  if (ALLURE_NOT_CONFIGURED.test(assertion)) fail('assertion failure must not match Allure NOT CONFIGURED');

  const na = 'N/A — Fruit Attack does not support buyFeature';
  if (isNotConfiguredReason(na)) fail('N/A must not be NOT CONFIGURED');
  if (!isNotApplicableReason(na)) fail('N/A reason should remain N/A');

  const blocked = 'BLOCKED — no discovery profile for this game';
  if (isNotConfiguredReason(blocked)) fail('BLOCKED must not be NOT CONFIGURED');

  console.log('eligibility smoke ok');
}

await main();
