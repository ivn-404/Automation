/**
 * Controllers layer — reusable action APIs.
 */

export const CONTROLLERS_LAYER = 'controllers' as const;

export * from './registry/index.js';
export { NO_HEAL, type ActionHealer, type HealableAction } from './strategy/action-healer.js';
export { clickCanvasControl } from './strategy/click-control.js';
export { SpinController, type SpinControllerOptions } from './spin-controller.js';
export { BetController, type BetControllerOptions } from './bet-controller.js';
export { TurboController, type TurboControllerOptions } from './turbo-controller.js';
export { AutoplayController, type AutoplayControllerOptions } from './autoplay-controller.js';
export { BuyFeatureController, type BuyFeatureControllerOptions } from './buy-feature-controller.js';
export { MenuController, type MenuControllerOptions } from './menu-controller.js';
export { AmplifyBetController, type AmplifyBetControllerOptions } from './amplify-bet-controller.js';
export { SettingsController, type SettingsControllerOptions } from './settings-controller.js';
export { FullscreenController, type FullscreenControllerOptions } from './fullscreen-controller.js';
export {
  ScratchCardController,
  type ScratchCardControllerOptions,
  type ScratchDrawerText,
  type ScratchGridSize,
} from './scratch-card-controller.js';
