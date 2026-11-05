export {
  assessCapabilities,
  closestLayout,
  sharedScratchDrawer,
  type SharedScratchDrawer,
  findStartControl,
  identifyControls,
  isStartScene,
  LAYOUT_FAMILY_DISTANCE,
  learnedFile,
  learnedManifest,
  loadDiscoveryPatterns,
  loadLearnedDecisions,
  loadPersistedProfile,
  persistLearnedProfile,
  stripLearnedSecrets,
  overallReadiness,
  readHudTexts,
  type CalibrationStatus,
  type CapabilityAssessment,
  type Confidence,
  type DiscoveredControl,
  type DiscoveryPatterns,
  type LayoutMatch,
  type LearnedDecisions,
  type QaDecision,
  type Readiness,
} from './assess.js';
export { checkAutoplayPanel, checkBuyPanel, checkMenuPanel, checkScratchDrawer, type PanelCheck } from './panel-checks.js';
export { isPressAnywhereText, learnBySpinning, type LearnSpinsResult } from './learn-spins.js';
export { learnPayload, type PayloadLearning } from './payload-learn.js';
export { browserMetrics, idleFrameTiming, loadTiming, type IdleDiagnostics, type LoadDiagnostics } from './diagnostics.js';
export { frameTree, inspectRuntime, renderFrame, type DomControl, type FrameNode, type RuntimeSnapshot, type SceneObject, type SceneText } from './inspect.js';
