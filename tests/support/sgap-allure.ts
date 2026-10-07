/**
 * Maps SGAP manual test metadata to Allure labels.
 * @see https://allurereport.org/docs/playwright/
 */

import { allure } from 'allure-playwright';
import type { TestInfo } from '@playwright/test';

import { getLauncherMode } from '../fixtures/local-launcher-html.js';
import { isNotApplicableReason } from '../../src/capabilities/index.js';
import {
  formatInteractions,
  summarizeInteractions,
  type InteractionEntry,
} from '../../src/reporting/interaction-journal.js';
import {
  CATEGORY_LABELS,
  findCatalogCase,
  AUTOMATED_REGRESSION_IDS,
} from './test-catalog.js';

const MANUAL_TEST_ID_RE =
  /^(CSF|BC|TM|AP|BF|MN|AT|FS|UIDS|AS|SM|ES|CP|WD|SCG|PEN)-\d{3}/;

export async function applySgapAllureMetadata(
  testInfo: TestInfo,
  gameId: string,
): Promise<void> {
  const manualFromAnnotation = testInfo.annotations.find(
    (entry) => entry.type === 'manualTestId',
  )?.description;
  const manualFromTitle = testInfo.title.match(MANUAL_TEST_ID_RE)?.[0];
  const manualTestId = manualFromAnnotation ?? manualFromTitle;

  await allure.epic('SGAP');
  await allure.label('framework', 'sgap');
  await allure.label('gameId', gameId);
  await allure.label('launcherMode', getLauncherMode());
  await allure.label('browserProject', testInfo.project.name);
  const packageId = testInfo.project.metadata?.sgapPackageId;
  if (typeof packageId === 'string' && packageId.length > 0) {
    await allure.label('packageId', packageId);
  }

  if (manualTestId === undefined) {
    await allure.parentSuite('Fixture Smoke');
    await allure.feature('Fixture Smoke');
    return;
  }

  const categoryCode = manualTestId.split('-')[0] ?? 'SGAP';
  const catalog = findCatalogCase('regression', manualTestId);
  const feature = catalog?.categoryName ?? CATEGORY_LABELS[categoryCode] ?? categoryCode;
  const inRegression = catalog !== undefined || AUTOMATED_REGRESSION_IDS.has(manualTestId);

  await allure.label('manualTestId', manualTestId);
  await allure.feature(feature);
  await allure.story(manualTestId);
  await allure.displayName(
    catalog !== undefined ? `${manualTestId} - ${catalog.title}` : manualTestId,
  );
  if (catalog !== undefined) {
    await allure.description(catalog.title);
  }

  if (inRegression) {
    await allure.parentSuite('Regression');
    await allure.suite(feature);
    await allure.label('suite', 'Regression');
    await allure.tag('regression');
    await allure.label('automationStatus', 'automated');
    await allure.tag('automated');
  } else if (categoryCode === 'PEN') {
    await allure.parentSuite('Security / Pentesting');
    await allure.suite(feature);
    await allure.tag('security');
  } else {
    await allure.parentSuite('Other');
    await allure.suite(feature);
  }
}

/**
 * After the test: how every input was located. A pass that needed fallbacks is
 * labelled `selfHealing=healed`, so it can be filtered apart from a clean pass.
 */
export async function applySgapInteractionMetadata(
  testInfo: TestInfo,
  entries: readonly InteractionEntry[],
): Promise<void> {
  if (entries.length === 0) {
    return;
  }
  const summary = summarizeInteractions(entries);
  const strategies = Object.entries(summary.byStrategy)
    .map(([strategy, count]) => `${strategy}×${count}`)
    .join(' ');
  const healing = summary.fallbacks > 0 ? `${summary.fallbacks} fallback input(s)` : 'none';
  testInfo.annotations.push(
    { type: 'locatorStrategy', description: strategies },
    { type: 'selfHealing', description: healing },
    { type: 'lowestConfidence', description: summary.lowestConfidence ?? 'n/a' },
  );
  await testInfo.attach('interactions.txt', {
    body: formatInteractions(entries),
    contentType: 'text/plain',
  });
  await testInfo.attach('interactions.json', {
    body: JSON.stringify({ summary, entries }, null, 2),
    contentType: 'application/json',
  });
  await allure.label('selfHealing', summary.fallbacks > 0 ? 'healed' : 'clean');
  await allure.label('lowestConfidence', summary.lowestConfidence ?? 'n/a');
}

/**
 * After the test: a skip whose reason starts with `N/A` means the game does not
 * support the feature, which is a result of its own — not a pending or broken case.
 */
export async function applySgapOutcomeMetadata(testInfo: TestInfo): Promise<void> {
  if (testInfo.status !== 'skipped') {
    return;
  }
  const reason = testInfo.annotations.find((entry) => entry.type === 'skip')?.description;
  if (!isNotApplicableReason(reason)) {
    return;
  }
  testInfo.annotations.push({ type: 'outcome', description: 'N/A' });
  await allure.label('outcome', 'N/A');
  await allure.tag('N/A');
  await allure.description(reason!);
}
