export const EYE_LAYER = 'eye' as const;

export { loadEyeCatalog, eyeRootDir } from './catalog.js';
export {
  clearInterferingScreens,
  intentFromAction,
  isEyeEnabled,
  isReadyForIntent,
  type ClearInterferingScreensOptions,
} from './eye.js';
export {
  classifyCanvasPng,
  clickDialogButton,
  DIALOG_BUTTON_TEXT,
  readHudState,
  settleHudState,
  type HudState,
  clearCanvasBlockers,
  closeBuyPanel,
  detectCanvasBlocker,
  dismissCanvasBlocker,
  findSessionContinueInPng,
  isBuyConfirmPill,
  isDismissableBlocker,
  SESSION_CONTINUE_SIGNATURE,
  type CanvasBlocker,
  type CanvasBlockerKind,
} from './canvas-blocker.js';
export {
  gateCanvasIntent,
  observationAllowsIntent,
  IntentNotReadyError,
} from './intent-gate.js';
export { consumeHealedRatio, forgetHealedRatio, recallHealedRatio, rememberHealedRatio } from './learned-ratios.js';
export type {
  EyeCatalog,
  EyeIntent,
  EyeLayer,
  EyeObservation,
  EyePolicy,
  EyeScreenDefinition,
} from './types.js';
