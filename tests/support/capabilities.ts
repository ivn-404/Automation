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
  notConfiguredMessage,
  unmappedCapabilities,
  unsupportedCapabilities,
  type Capability,
} from '../../src/capabilities/index.js';

export function requireCapabilities(...capabilities: readonly Capability[]): void {
  test.skip(
    ({ sgapManifest }) => unsupportedCapabilities(sgapManifest, capabilities).length > 0,
    `${NOT_APPLICABLE_PREFIX} — game does not support ${capabilities.join(' + ')}`,
  );
  test.beforeEach(({ sgapManifest }) => {
    if (unmappedCapabilities(sgapManifest, capabilities).length > 0) {
      throw new Error(notConfiguredMessage(sgapManifest, capabilities));
    }
  });
}
