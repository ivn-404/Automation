/**
 * Spec-side capability gate: call inside `test.describe`.
 *
 * - A capability the manifest declares disabled → N/A skip, decided before launch.
 * - A capability the manifest does not declare at all → the case fails as NOT CONFIGURED,
 *   so a partially mapped manifest cannot hide real features behind N/A.
 */

import { test } from '../fixtures/index.js';
import {
  NOT_APPLICABLE_PREFIX,
  assessmentSkipReason,
  notConfiguredMessage,
  unmappedCapabilities,
  unsupportedCapabilities,
  type Capability,
} from '../../src/capabilities/index.js';
import { applyNotConfiguredOutcome } from './sgap-allure.js';

export function requireCapabilities(...capabilities: readonly Capability[]): void {
  test.beforeEach(({ sgapManifest }, testInfo) => {
    const notReady = assessmentSkipReason(sgapManifest, capabilities);
    if (notReady !== undefined) testInfo.skip(true, notReady);
  });
  test.skip(
    ({ sgapManifest }) =>
      assessmentSkipReason(sgapManifest, capabilities) === undefined &&
      unsupportedCapabilities(sgapManifest, capabilities).length > 0,
    `${NOT_APPLICABLE_PREFIX} — game does not support ${capabilities.join(' + ')}`,
  );
  test.beforeEach(async ({ sgapManifest }, testInfo) => {
    if (unmappedCapabilities(sgapManifest, capabilities).length > 0) {
      const message = notConfiguredMessage(sgapManifest, capabilities);
      await applyNotConfiguredOutcome(testInfo, message);
      throw new Error(message);
    }
  });
}
