/**
 * Capabilities layer — which features the current game supports (manifest-driven).
 */

export {
  FEATURE_CAPABILITIES,
  NOT_APPLICABLE_PREFIX,
  NOT_CONFIGURED_PREFIX,
  capabilityStatus,
  isNotApplicableReason,
  isNotConfiguredReason,
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
  classifyRequirements,
  formatEligibilitySummary,
  type EligibilityRow,
  type EligibilityStatus,
} from './eligibility.js';
export {
  clearPackageProfileCache,
  freeSpinRetriggerRulesFor,
  packageProfileFor,
  packagesDir,
  parseFreeSpinRetriggerRules,
  type FreeSpinAwardKind,
  type FreeSpinRetriggerRules,
  type PackageProfile,
} from './package-profile.js';
