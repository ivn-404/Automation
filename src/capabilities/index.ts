/**
 * Capabilities layer — which features the current game supports (manifest-driven).
 */

export {
  FEATURE_CAPABILITIES,
  NOT_APPLICABLE_PREFIX,
  capabilityStatus,
  isNotApplicableReason,
  listCapabilities,
  missingCapabilities,
  notApplicableReason,
  notConfiguredMessage,
  supportsCapability,
  unmappedCapabilities,
  unsupportedCapabilities,
  type Capability,
  type CapabilityStatus,
  type FeatureCapability,
} from './game-capabilities.js';
export { BLOCKED_PREFIX, CALIBRATION_PREFIX, assessmentSkipReason, isDiscoveredManifest } from './assessment.js';
export {
  clearPackageProfileCache,
  packageProfileFor,
  packagesDir,
  type PackageProfile,
} from './package-profile.js';
