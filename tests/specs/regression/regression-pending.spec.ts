/**
 * Emits one Allure row per RegressionTestCases.md entry that is not yet automated.
 * Automated IDs are covered by real specs under tests/specs/{csf,bc,bf,ap,tm}.
 */

import { test } from '@playwright/test';
import { allure } from 'allure-playwright';

import {
  AUTOMATED_REGRESSION_IDS,
  loadTestCatalog,
} from '../../support/test-catalog.js';
import { getLauncherMode } from '../../fixtures/local-launcher-html.js';

const pending = loadTestCatalog('regression').filter(
  (entry) => !AUTOMATED_REGRESSION_IDS.has(entry.id),
);

test.describe('Regression — pending catalog', () => {
  for (const entry of pending) {
    test(`${entry.id} - ${entry.title}`, async ({}, testInfo) => {
      testInfo.annotations.push(
        { type: 'manualTestId', description: entry.id },
        { type: 'category', description: entry.categoryCode },
        { type: 'suite', description: 'Regression' },
        { type: 'automationStatus', description: 'pending' },
      );

      await allure.epic('SGAP');
      await allure.parentSuite('Regression');
      await allure.suite(entry.categoryName);
      await allure.feature(entry.categoryName);
      await allure.story(entry.id);
      await allure.displayName(`${entry.id} - ${entry.title}`);
      await allure.description(entry.title);
      await allure.label('manualTestId', entry.id);
      await allure.label('suite', 'Regression');
      await allure.label('automationStatus', 'pending');
      await allure.label('framework', 'sgap');
      await allure.label('gameId', process.env.SGAP_GAME_ID ?? 'sugar-wonderland');
      await allure.label('launcherMode', getLauncherMode());
      await allure.label('browserProject', testInfo.project.name);
      await allure.tag('regression');
      await allure.tag('pending');

      test.skip(true, 'Not yet automated — listed in docs/RegressionTestCases.md');
    });
  }
});
